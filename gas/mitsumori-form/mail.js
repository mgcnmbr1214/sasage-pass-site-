/**
 * ササゲパス 業務ボード ②メール返信支援
 *
 * 顧客からの新着メールを検知して「メール履歴」に保存し、届いた中身を通知する。
 * 返信案は検知の時点では作らない。「対応を選ぶ」で対応種別を選んでから Claude API で作る。
 * 確認・修正はスプレッドシート上の画面で行い、承認したものだけを Gmail の下書きにする。
 * 自動送信は実装しない。
 */

const MAIL_PROP_API_KEY = 'ANTHROPIC_API_KEY';
const MAIL_MODEL = 'claude-sonnet-5';
const MAIL_LOOKBACK_DAYS = 30;
const MAIL_MAX_THREADS_PER_RUN = 5;
/** 1回の実行で記録するメールの上限。1スレッドに複数通あるため、スレッド数とは別に持つ。 */
const MAIL_MAX_MESSAGES_PER_RUN = 10;
/** これより古いメールは、記録はするが通知はしない（過去分のまとめ取り込みで通知が溢れないように）。 */
const MAIL_NOTIFY_WITHIN_HOURS = 24;
/** 「過去のやりとり」でさかのぼる期間。 */
const MAIL_HISTORY_DAYS = 180;
const MAIL_MAX_BODY_CHARS = 4000;
const MAIL_TRIGGER_MINUTES = 10;
const MAIL_EXAMPLE_COUNT = 3;

/**
 * 状態は「そのメールに、こちらがどこまで返したか」を表す。
 * Gmailの開封状況とは無関係。
 */
const MAIL_STATUS_PENDING = '返信前';
const MAIL_STATUS_SENT = '返信済み';
const MAIL_STATUS_SKIP = '対応不要';

/** 状態の説明。プルダウンの説明文と設計ドキュメントで使う。 */
const MAIL_STATUS_HELP = [
  MAIL_STATUS_PENDING + '：まだ返していない（返信案の作成中・下書き保存済みもここ）',
  MAIL_STATUS_SENT + '：返信を送った',
  MAIL_STATUS_SKIP + '：返信しないと決めた'
].join('\n');

/**
 * 旧名称 → 新名称。初期セットアップで既存の値を書き換える。
 *
 * 途中の段階（返信案あり・下書きあり）は廃止した。
 * 文面がどこまでできているかは画面を見れば分かり、状態として分けても
 * 次にやることは変わらない。**送ったかどうかだけ**を持つ。
 */
const MAIL_STATUS_RENAMES = {
  '未確認': MAIL_STATUS_PENDING,
  '修正中': MAIL_STATUS_PENDING,
  '下書き保存済': MAIL_STATUS_PENDING,
  '下書きあり': MAIL_STATUS_PENDING,
  '返信案あり': MAIL_STATUS_PENDING,
  '送信済': MAIL_STATUS_SENT
};

const MAIL_STATUSES = [MAIL_STATUS_PENDING, MAIL_STATUS_SENT, MAIL_STATUS_SKIP];

/**
 * 受信本文・返信文面の先頭に付ける日時。
 *
 * 同じスレッドのメールは件名で見分けられないため、シート上で日時を添える。
 * ただしこの1行はメールの中身ではないので、
 * 画面へ渡すときと下書きを作るときは必ず mailUnstamp_ で外す。
 */
const MAIL_STAMP_PATTERN = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}\r?\n/;

function mailStamp_(when, text) {
  const body = mailUnstamp_(text);
  if (!body) return '';
  const at = when instanceof Date ? when : new Date();
  return Utilities.formatDate(at, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') + '\n' + body;
}

function mailUnstamp_(text) {
  return String(text || '').replace(MAIL_STAMP_PATTERN, '');
}

/** 確認画面に出し続ける状態。実際に送信するまでは一覧から消さない。 */
const MAIL_OPEN_STATUSES = [MAIL_STATUS_PENDING];

// ------------------------------------------------------------
// メニューから呼ぶ操作
// ------------------------------------------------------------

function mailOpenReviewPanel() {
  boardUseCurrentColumns_();
  const html = HtmlService.createTemplateFromFile('Reply').evaluate()
    .setWidth(920)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '対応を選ぶ');
}

/**
 * 手動での新着確認。フォーム回答の取り込みとメールの確認をまとめて行う。
 * 画面の前にいる操作なので、通知メールは送らずダイアログで結果を返す。
 */
function mailCheckNow() {
  boardUseCurrentColumns_();
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let imported = 0;
  try {
    imported = boardImportResponses_(ss);
  } catch (err) {
    ui.alert('フォーム回答の取り込みに失敗しました。\n\n' + err.message);
  }

  let refreshed = 0;
  try {
    refreshed = boardRefreshInquiries_(ss);
  } catch (err) {
    boardLog_('②エラー', '問い合わせ内容の更新に失敗: ' + err.message);
  }

  let completed = 0;
  try {
    completed = squareCheckCompletions();
  } catch (err) {
    boardLog_('②エラー', '支払い・署名の確認に失敗: ' + err.message);
  }

  let shipped = 0;
  try {
    shipped = shipCheckAll();
  } catch (err) {
    boardLog_('②エラー', '発送の確認に失敗: ' + err.message);
  }

  try {
    boardRefreshCustomerNotes_(ss);
  } catch (err) {
    boardLog_('②エラー', 'お客様欄のメモ更新に失敗: ' + err.message);
  }

  const result = mailScan_({ notify: false });
  const lines = [
    'フォームの新しい回答　：' + imported + ' 件',
    'お問い合わせ内容の更新：' + refreshed + ' 件',
    '新着のお客様メール　　：' + result.found + ' 件',
    '支払い・署名の完了確認：' + completed + ' 件',
    '発送の確認　　　　　　：' + shipped + ' 件'
  ];

  if (result.found > 0) {
    ui.alert(lines.join('\n') + '\n\n続けて「対応を選ぶ」画面を開きます。');
    mailOpenReviewPanel();
    return;
  }
  ui.alert(lines.join('\n') + (result.note ? '\n\n' + result.note : ''));
}

/** 新着確認まわりが今どう動いているかを一覧で表示する。 */
function mailShowStatus() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = boardGetSettings_(ss);
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'mailScanFromTrigger';
  });

  const customers = mailLoadCustomers_(ss);
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  let pending = 0;
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, BOARD_MAIL_COL.status, sheet.getLastRow() - 1, 1).getValues()
      .forEach(function (row) {
        if (MAIL_OPEN_STATUSES.indexOf(String(row[0] || '').trim()) >= 0) pending++;
      });
  }

  const switchOn = String(settings['新着メールの読み取り'] || 'オン').trim() !== 'オフ';
  const lines = [
    '■ 自動確認（フォーム回答の取り込みとメールの確認）',
    '　定期実行　：' + (triggers.length > 0 ? MAIL_TRIGGER_MINUTES + '分ごと（動作中）' : 'なし（停止中）'),
    '　設定の切替：' + (switchOn ? 'オン' : 'オフ（動作中でも新着を確認しません）'),
    '',
    '■ 通知（届いたメールの中身を知らせます。返信案は載せません）',
    '　通知先　　：' + (settings['通知先メールアドレス'] || '（未設定。通知は送られません）'),
    '　下書き差出人：' + (settings['送信元エイリアス'] || '（未設定）'),
    '',
    '■ 検知の対象',
    '　顧客タブの登録アドレス：' + customers.length + ' 件',
    '　さかのぼる期間　　　　：' + MAIL_LOOKBACK_DAYS + '日',
    '　1回に読み取る上限　　　：' + MAIL_MAX_THREADS_PER_RUN + ' 件',
    '',
    '■ 現在の状況',
    '　APIキー　　　：' + (mailGetApiKey_() ? '登録済み' : '未登録（返信案を作れません）'),
    '　対応待ちのメール：' + pending + ' 件',
    '　最後の実行　　：' + (mailLastRunLog_(ss) || '記録なし')
  ];

  SpreadsheetApp.getUi().alert('新着メール確認の状態', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function mailLastRunLog_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_LOGS);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1] || '').indexOf('②') !== 0) continue;
    const when = rows[i][0] instanceof Date
      ? Utilities.formatDate(rows[i][0], Session.getScriptTimeZone(), 'M/d HH:mm')
      : String(rows[i][0]);
    return when + '　' + rows[i][2];
  }
  return '';
}

function mailStartAutoCheck() {
  mailStopAutoCheck_();
  ScriptApp.newTrigger('mailScanFromTrigger').timeBased().everyMinutes(MAIL_TRIGGER_MINUTES).create();
  boardLog_('②自動チェック', MAIL_TRIGGER_MINUTES + '分ごとの自動チェックを開始しました');
  SpreadsheetApp.getUi().alert(
    MAIL_TRIGGER_MINUTES + '分ごとに新着メールを自動で確認します。\n' +
    'メールが届いたら、その中身が通知メールで届きます。'
  );
}

function mailStopAutoCheck() {
  const removed = mailStopAutoCheck_();
  boardLog_('②自動チェック', '自動チェックを停止しました');
  SpreadsheetApp.getUi().alert(removed > 0 ? '自動チェックを停止しました。' : '自動チェックは動いていませんでした。');
}

function mailStopAutoCheck_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'mailScanFromTrigger') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

function mailScanFromTrigger() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = boardGetSettings_(ss);
  if (String(settings['新着メールの読み取り'] || 'オン').trim() === 'オフ') return;

  try {
    boardImportResponses_(ss);
  } catch (err) {
    boardLog_('②エラー', 'フォーム回答の取り込みに失敗: ' + err.message);
  }
  try {
    boardRefreshInquiries_(ss);
  } catch (err) {
    boardLog_('②エラー', '問い合わせ内容の更新に失敗: ' + err.message);
  }
  try {
    squareCheckCompletions();
  } catch (err) {
    boardLog_('②エラー', '支払い・署名の確認に失敗: ' + err.message);
  }
  try {
    shipCheckAll();
  } catch (err) {
    boardLog_('②エラー', '発送の確認に失敗: ' + err.message);
  }
  try {
    boardRefreshCustomerNotes_(ss);
  } catch (err) {
    boardLog_('②エラー', 'お客様欄のメモ更新に失敗: ' + err.message);
  }
  mailScan_({ notify: true });
}

// ------------------------------------------------------------
// 新着検知と返信案の生成
// ------------------------------------------------------------

function mailScan_(options) {
  const notify = !options || options.notify !== false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const customers = mailLoadCustomers_(ss);
  if (customers.length === 0) return { found: 0, note: '顧客タブに登録がありません。' };

  // 記録済みのメールは「メール履歴」のメッセージIDで見分ける。
  // スレッド単位のラベルでは、同じスレッドに届いた2通目以降を取りこぼしていた
  mailBackfillMessageIds_(ss);
  const recorded = mailRecordedMessageIds_(ss);
  const settings = boardGetSettings_(ss);
  const fresh = new Date().getTime() - MAIL_NOTIFY_WITHIN_HOURS * 3600 * 1000;
  let found = 0;

  for (let i = 0; i < customers.length && found < MAIL_MAX_MESSAGES_PER_RUN; i++) {
    const customer = customers[i];
    let threads;
    try {
      threads = GmailApp.search(
        'from:' + customer.email + ' newer_than:' + MAIL_LOOKBACK_DAYS + 'd',
        0, MAIL_MAX_THREADS_PER_RUN
      );
    } catch (err) {
      boardLog_('②エラー', 'Gmail検索に失敗: ' + err.message);
      continue;
    }

    // 同じお客様の中では、届いた順に記録する
    const incoming = [];
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        if (String(message.getFrom() || '').indexOf(customer.email) < 0) return;
        if (recorded[message.getId()]) return;
        incoming.push({ thread: thread, message: message });
      });
    });
    incoming.sort(function (a, b) { return a.message.getDate() - b.message.getDate(); });

    for (let m = 0; m < incoming.length && found < MAIL_MAX_MESSAGES_PER_RUN; m++) {
      const thread = incoming[m].thread;
      const message = incoming[m].message;

      // 見積もり回答への返信であれば、請求先・返送先を顧客タブへ取り込む
      try {
        const raw = message.getPlainBody();
        boardApplyCustomerIntake_(ss, customer.email, boardExtractCustomerIntake_(raw));
        boardApplyCaseIntake_(ss, customer.customerId, boardExtractCaseIntake_(raw));
        boardReopenCase_(ss, customer.customerId);
      } catch (err) {
        boardLog_('②エラー', '顧客情報の取込に失敗: ' + err.message);
      }

      try {
        const body = mailPlainBody_(message).slice(0, MAIL_MAX_BODY_CHARS);

        // 返信案はここでは作らない。「対応を選ぶ」で対応種別を選んでから作る
        mailAppendHistory_(ss, {
          date: message.getDate(),
          customerId: customer.customerId,
          from: customer.email,
          subject: message.getSubject() || thread.getFirstMessageSubject(),
          summary: body,
          status: MAIL_STATUS_PENDING,
          threadId: thread.getId(),
          messageId: message.getId()
        });
        recorded[message.getId()] = true;

        // 取りこぼしていた過去のメールをまとめて記録する場合があるため、
        // 通知するのは届いたばかりのものだけにする
        if (notify && message.getDate().getTime() >= fresh) {
          mailNotify_(ss, settings, customer, message, body);
        }
        found++;
      } catch (err) {
        boardLog_('②エラー', customer.email + ': ' + err.message);
      }
    }
  }

  if (found > 0) boardLog_('②新着メール', found + ' 件の新着メールを記録しました');
  // 下書きを送ったかどうかは、画面を開かなくても分かるようにする。
  // ここを通さないと「対応を選ぶ」を開くまで「返信前」のまま残る
  mailRefreshSentStatus_(ss);
  mailSyncSentReplies_(ss);
  try {
    boardRefreshShipments_(ss);
  } catch (err) {
    boardLog_('②エラー', '返送の送信確認に失敗: ' + err.message);
  }
  try {
    squareRefreshInvoices(ss);
  } catch (err) {
    boardLog_('②エラー', '請求書の状態確認に失敗: ' + err.message);
  }
  // 顧客情報がそろったのに「情報不足」のまま残らないよう、毎回見直す。
  // 取り込みは新着のときしか走らないため、あとから埋めた分をここで拾う
  try {
    boardRefreshRegistration_(ss);
  } catch (err) {
    boardLog_('②エラー', 'お客様の登録状況の更新に失敗: ' + err.message);
  }
  boardRefreshUnreplied_(ss);
  boardRefreshUnbilled_(ss);
  return { found: found, note: '' };
}

/**
 * メッセージIDを持たない過去の行に、当時記録したであろうメールのIDを埋める。
 *
 * 以前はスレッド単位で記録していたため、どのメールを記録したかが残っていない。
 * 記録日時より前に届いた、そのお客様からの最後のメールを当時のものとみなす。
 * これをしないと、過去に確認済みのメールがすべて新着として出てきてしまう。
 */
function mailBackfillMessageIds_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  let filled = 0;

  rows.forEach(function (row, i) {
    if (String(row[BOARD_MAIL_COL.messageId - 1] || '').trim()) return;
    const threadId = String(row[BOARD_MAIL_COL.threadId - 1] || '').trim();
    if (!threadId) return;

    const from = String(row[BOARD_MAIL_COL.from - 1] || '').trim();
    const recordedAt = row[BOARD_MAIL_COL.date - 1];
    if (!from || !(recordedAt instanceof Date)) return;

    try {
      const thread = GmailApp.getThreadById(threadId);
      if (!thread) return;
      let hit = null;
      thread.getMessages().forEach(function (message) {
        if (String(message.getFrom() || '').indexOf(from) < 0) return;
        if (message.getDate() > recordedAt) return;
        if (!hit || message.getDate() > hit.getDate()) hit = message;
      });
      if (!hit) return;
      sheet.getRange(i + 2, BOARD_MAIL_COL.messageId).setValue(hit.getId());
      filled++;
    } catch (err) {
      boardLog_('②エラー', 'メッセージIDの補完に失敗: ' + err.message);
    }
  });

  if (filled > 0) boardLog_('移行', filled + ' 件のメール履歴にメッセージIDを補いました');
}

/** すでに記録したメールのメッセージID。 */
function mailRecordedMessageIds_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const ids = {};
  if (!sheet || sheet.getLastRow() < 2) return ids;
  sheet.getRange(2, BOARD_MAIL_COL.messageId, sheet.getLastRow() - 1, 1).getValues()
    .forEach(function (row) {
      const id = String(row[0] || '').trim();
      if (id) ids[id] = true;
    });
  return ids;
}

/** 新着を知らせる。返信案は載せず、届いたメールの中身だけを伝える。 */
function mailNotify_(ss, settings, customer, message, received) {
  const to = String(settings['通知先メールアドレス'] || '').trim();
  if (!to) return;
  const who = customer.company || customer.name || customer.email;
  const body = [
    who + ' 様からメールが届きました。',
    '',
    '差出人: ' + customer.email,
    '件名　: ' + message.getSubject(),
    '受信　: ' + Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'),
    '',
    '───────── 届いたメール ─────────',
    received,
    '────────────────────────────',
    '',
    '返信案はスプレッドシートで作ります:',
    ss.getUrl(),
    '　→ メニュー「ササゲパス」→「対応を選ぶ」'
  ].join('\n');

  MailApp.sendEmail({
    to: to,
    subject: '【要対応】' + who + ' ─ メールが届きました',
    body: body,
    name: 'ササゲパス業務ボード'
  });
}

// ------------------------------------------------------------
// 確認画面から呼ばれる操作
// ------------------------------------------------------------

function mailGetPendingList() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mailRefreshSentStatus_(ss);
  mailSyncSentReplies_(ss);
  // 画面は操作のたびに一覧を読み直すため、ここで案件ボードの未返信も合わせておく
  boardRefreshUnreplied_(ss);
  boardRefreshUnbilled_(ss);
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const active = mailActiveCustomers_(ss);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();

  // 進行中の案件があるお客様は、返信待ちが無くても全員出す。
  // こちらから続けて連絡する用があるため、一覧に居ないと開けない
  const best = {};
  const waiting = {};   // 返信待ちの行を1つでも持つお客様。並び順にだけ使う
  rows.forEach(function (row, i) {
    const customerId = String(row[BOARD_MAIL_COL.customerId - 1] || '').trim();
    if (!active[customerId]) return;

    const status = String(row[BOARD_MAIL_COL.status - 1] || '').trim();
    const when = row[BOARD_MAIL_COL.date - 1];
    const item = {
      row: i + 2,
      customerId: customerId,
      open: MAIL_OPEN_STATUSES.indexOf(status) >= 0,
      at: when instanceof Date ? when.getTime() : 0,
      customer: active[customerId].customer,
      date: boardFormatDate_(when),
      from: row[BOARD_MAIL_COL.from - 1],
      subject: row[BOARD_MAIL_COL.subject - 1],
      summary: mailUnstamp_(row[BOARD_MAIL_COL.summary - 1]),
      text: mailUnstamp_(row[BOARD_MAIL_COL.finalText - 1]) || row[BOARD_MAIL_COL.aiFirst - 1],
      instructions: row[BOARD_MAIL_COL.instructions - 1],
      threadId: row[BOARD_MAIL_COL.threadId - 1],
      responseType: row[BOARD_MAIL_COL.responseType - 1],
      status: status
    };

    if (item.open) waiting[customerId] = true;

    // お客様ごとに1件。**いちばん新しいものを出す。**
    // 返信待ちを優先すると、もっと新しいメールがあるのに古いフォーム回答が出てしまう
    const kept = best[customerId];
    if (!kept || item.at >= kept.at) best[customerId] = item;
  });

  // 一覧の並びは、返信待ちのあるお客様を上に、そのあとは新しい順
  return Object.keys(best).map(function (id) {
    return Object.assign({}, best[id], { waiting: !!waiting[id] });
  }).sort(function (a, b) {
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
    return b.at - a.at;
  });
}

/**
 * 「返信前」の行について、実際に返信が送られたかを Gmail 側で確認する。
 * スレッドの最新メールが自分から送られていれば返信済みとみなす。
 * 下書きを消しただけの場合は状態を変えないため、一覧から消えない。
 */
function mailRefreshSentStatus_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const ours = mailOwnAddresses_(ss);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const advanced = [];

  rows.forEach(function (row, i) {
    if (String(row[BOARD_MAIL_COL.status - 1] || '').trim() !== MAIL_STATUS_PENDING) return;
    const threadId = String(row[BOARD_MAIL_COL.threadId - 1] || '');

    // スレッドが無い行（フォームの回答）は mailSyncSentReplies_ が受け持つ。
    // 送信済みフォルダから返信を探し、文面と状態をまとめて入れる
    if (!threadId) return;

    try {
      const thread = GmailApp.getThreadById(threadId);
      if (!thread) return;
      const messages = thread.getMessages();
      const last = messages[messages.length - 1];
      // 下書きもスレッドの一員として返ってくる。まだ送っていないので進めない
      if (last.isDraft()) return;
      const from = String(last.getFrom() || '').toLowerCase();
      const sentByUs = ours.some(function (address) { return address && from.indexOf(address) >= 0; });
      if (sentByUs) {
        sheet.getRange(i + 2, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SENT);
        advanced.push(String(row[BOARD_MAIL_COL.from - 1] || ''));
      }
    } catch (err) {
      boardLog_('②状態確認', threadId + ': ' + err.message);
    }
  });

  if (advanced.length > 0) {
    boardLog_('②状態確認', advanced.length + ' 件を返信済みにしました（' + advanced.join('、') + '）');
  }
}

/**
 * 各行の「返信文面」を、実際に送ったメールに合わせる。
 *
 * その受信メールの**次にこちらが送った**メールを同じスレッドから探して入れる。
 * 以前は1スレッド1行だったため、画面に出ていた最新メールへの返信が、
 * 別の受信メールの行に保存されていた。その食い違いをここで直す。
 * Gmailから直接返信した場合も、これで記録に載る。
 *
 * 対応不要の行は、文面だけ記録して状態は動かさない。
 * 記録しないと「実際は返信したのに返信文面が空欄」のまま残る。
 */
function mailSyncSentReplies_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const ours = mailOwnAddresses_(ss);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const cache = {};
  let filled = 0;

  const sentByUs = function (message) {
    const from = String(message.getFrom() || '').toLowerCase();
    return ours.some(function (address) { return address && from.indexOf(address) >= 0; });
  };

  rows.forEach(function (row, i) {
    const status = String(row[BOARD_MAIL_COL.status - 1] || '').trim();
    // 対応不要の行も、実際に返していれば文面は記録する。
    // 記録しないと「返信したのに空欄」になる。ただし状態は動かさない
    const keepStatus = status === MAIL_STATUS_SKIP;

    const threadId = String(row[BOARD_MAIL_COL.threadId - 1] || '').trim();
    const messageId = String(row[BOARD_MAIL_COL.messageId - 1] || '').trim();

    // フォームの回答から作られた行。届いたのはメールではないのでスレッドが無く、
    // こちらの返信も「返信」ではなく新規メールとして送っている。
    // そのお客様へ、この回答が入ったあとに送ったメールを探す
    if (!messageId) {
      const sent = mailFirstSentAfter_(row[BOARD_MAIL_COL.from - 1], row[BOARD_MAIL_COL.date - 1]);
      if (!sent) return;
      const body = mailStamp_(sent.getDate(), mailPlainBody_(sent).slice(0, MAIL_MAX_BODY_CHARS));
      if (body === String(row[BOARD_MAIL_COL.finalText - 1] || '') && status !== MAIL_STATUS_PENDING) return;
      sheet.getRange(i + 2, BOARD_MAIL_COL.finalText).setValue(body);
      if (!keepStatus) sheet.getRange(i + 2, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SENT);
      filled++;
      return;
    }
    if (!threadId) return;

    if (!cache[threadId]) {
      try {
        const thread = GmailApp.getThreadById(threadId);
        cache[threadId] = thread ? thread.getMessages() : [];
      } catch (err) {
        cache[threadId] = [];
      }
    }
    const messages = cache[threadId];

    let at = -1;
    for (let m = 0; m < messages.length; m++) {
      if (messages[m].getId() === messageId) { at = m; break; }
    }
    if (at < 0) return;

    let reply = null;
    for (let m = at + 1; m < messages.length; m++) {
      if (sentByUs(messages[m])) { reply = messages[m]; break; }
    }
    if (!reply) return;

    const text = mailStamp_(reply.getDate(), mailPlainBody_(reply).slice(0, MAIL_MAX_BODY_CHARS));
    if (text === String(row[BOARD_MAIL_COL.finalText - 1] || '')) return;

    sheet.getRange(i + 2, BOARD_MAIL_COL.finalText).setValue(text);
    if (!keepStatus) sheet.getRange(i + 2, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SENT);
    filled++;
  });

  if (filled > 0) boardLog_('②返信の記録', filled + ' 件の返信文面を実際に送ったメールに合わせました');
  return filled;
}

/**
 * その日時より後に、そのアドレスへ最初に送ったメール。
 *
 * フォームの回答に対する返信は、返信ではなく新規メールとして送るため
 * スレッドを辿れない。送信済みフォルダから探すしかない。
 *
 * 下書きが残っているかどうかでは判断しない。
 * Gmailで直接書いて送った場合、こちらが作った下書きは残ったままになり、
 * いつまでも「返信前」から進まなくなる。
 */
function mailFirstSentAfter_(email, since) {
  const to = String(email || '').trim();
  if (!to || !(since instanceof Date)) return null;

  // Gmail の after: は日付単位。前日から探して取りこぼしを防ぐ
  const from = new Date(since.getTime() - 24 * 3600 * 1000);
  const query = 'in:sent to:' + to + ' after:' +
    Utilities.formatDate(from, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  let found = null;
  try {
    GmailApp.search(query, 0, 20).forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        if (String(message.getTo() || '').indexOf(to) < 0) return;
        if (message.getDate() < since) return;
        if (!found || message.getDate() < found.getDate()) found = message;
      });
    });
  } catch (err) {
    boardLog_('②状態確認', '送信済みの確認に失敗: ' + err.message);
  }
  return found;
}

function mailOwnAddresses_(ss) {
  const settings = boardGetSettings_(ss);
  const list = [String(settings['送信元エイリアス'] || '').trim().toLowerCase()];
  try {
    list.push(String(Session.getActiveUser().getEmail() || '').trim().toLowerCase());
  } catch (err) {
    // 取得できない環境では無視する
  }
  GmailApp.getAliases().forEach(function (alias) { list.push(String(alias).toLowerCase()); });
  return list.filter(function (a) { return a; });
}

/** 確認画面に表示する、お客様から届いたメールの全文。 */
/**
 * 確認画面に出す「お客様のメール」。
 *
 * その行のスレッドの中ではなく、**そのお客様から届いた最新のメール**を探す。
 * フォーム回答から作られた行のように、行そのものがメールでない場合もあるため。
 */
function mailGetCustomerMessage(row) {
  boardUseCurrentColumns_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const stored = mailUnstamp_(values[BOARD_MAIL_COL.summary - 1]);
  const when = values[BOARD_MAIL_COL.date - 1];
  const messageId = String(values[BOARD_MAIL_COL.messageId - 1] || '').trim();

  // メールではなくフォームの回答から作られた行。シートの内容がすべて
  if (!messageId) {
    const at = when instanceof Date
      ? Utilities.formatDate(when, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
      : '';
    return {
      text: (at ? at + '　' : '') + 'フォームからの回答\n' +
        '件名: ' + String(values[BOARD_MAIL_COL.subject - 1] || '') + '\n' +
        '────────────────────\n' +
        (stored || '(本文を取得できませんでした)')
    };
  }

  try {
    const message = GmailApp.getMessageById(messageId);
    if (!message) return { text: stored || '(本文を取得できませんでした)' };

    const body = message.getPlainBody().replace(/\n{3,}/g, '\n\n').trim();
    const header = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') +
      '　' + message.getFrom() + '\n' + '件名: ' + message.getSubject() + '\n' +
      '────────────────────\n';
    return { text: header + body };
  } catch (err) {
    return { text: stored || '(本文を取得できませんでした)' };
  }
}

/**
 * 対応リストに出してよいお客様。
 * 進行中の案件が1件でもある方だけを対象にする。
 * 見送りだけの方や、案件が1件も無い方は出さない。
 */
/**
 * 終わっていない案件を、顧客IDで引ける形にして返す。
 * 一覧にお客様の名前を出すため、案件IDとお客様名も一緒に持たせる。
 */
function mailActiveCustomers_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const active = {};
  if (!sheet || sheet.getLastRow() < 2) return active;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues()
    .forEach(function (row) {
      const id = String(row[BOARD_COL.customerId - 1] || '').trim();
      if (!id) return;
      if (BOARD_FINISHED_STATUSES.indexOf(String(row[BOARD_COL.status - 1] || '').trim()) >= 0) return;
      active[id] = { customer: String(row[BOARD_COL.customer - 1] || '').trim() };
    });
  return active;
}

/**
 * そのお客様との過去のやりとり。送受信をまとめて、新しい順に返す。
 *
 * シートの記録ではなく Gmail から直接組み立てる。
 * こちらから送ったメールもシートには残らないため、Gmail が唯一の全体像になる。
 */
function mailGetHistory(row) {
  boardUseCurrentColumns_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const email = String(values[BOARD_MAIL_COL.from - 1] || '').trim();
  if (!email) return [];

  let threads;
  try {
    threads = GmailApp.search(
      '(from:' + email + ' OR to:' + email + ') newer_than:' + MAIL_HISTORY_DAYS + 'd',
      0, 30
    );
  } catch (err) {
    boardLog_('②エラー', 'やりとりの取得に失敗: ' + err.message);
    return [];
  }

  const seen = {};
  const out = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      const id = message.getId();
      if (seen[id]) return;
      seen[id] = true;
      const incoming = String(message.getFrom() || '').indexOf(email) >= 0;
      out.push({
        at: message.getDate().getTime(),
        date: Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'),
        direction: incoming ? '受信' : '送信',
        incoming: incoming,
        subject: message.getSubject(),
        text: mailPlainBody_(message).slice(0, MAIL_MAX_BODY_CHARS)
      });
    });
  });

  // フォームの回答はメールではないため Gmail には無い。メール履歴から拾う
  const customerId = String(values[BOARD_MAIL_COL.customerId - 1] || '').trim();
  if (customerId) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues()
      .forEach(function (r) {
        if (String(r[BOARD_MAIL_COL.customerId - 1] || '').trim() !== customerId) return;
        if (String(r[BOARD_MAIL_COL.messageId - 1] || '').trim()) return;
        const when = r[BOARD_MAIL_COL.date - 1];
        if (!(when instanceof Date)) return;
        out.push({
          at: when.getTime(),
          date: Utilities.formatDate(when, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'),
          direction: 'フォーム',
          incoming: true,
          subject: String(r[BOARD_MAIL_COL.subject - 1] || ''),
          text: mailUnstamp_(r[BOARD_MAIL_COL.summary - 1])
        });
      });
  }

  out.sort(function (a, b) { return b.at - a.at; });
  return out;
}

/** 対応種別の一覧を画面に渡す。 */
function mailGetResponseTypes() {
  return BOARD_RESPONSE_TYPES.map(function (t) {
    return {
      id: t.id, name: t.name, status: t.status,
      fields: (t.fields || []).map(function (key) {
        return { key: key, label: BOARD_CASE_FIELDS[key].label, type: BOARD_CASE_FIELDS[key].type };
      }),
      invoice: !!t.invoice,
      forRegistration: t.forRegistration || '',
      requires: (t.requires || []).map(function (key) { return BOARD_CASE_FIELDS[key].label; }),
      requireKeys: t.requires || []
    };
  });
}

/** この返信に紐づく案件の、入力欄とSquare請求書の状態。 */
/**
 * 画面へ返す案件情報。
 *
 * **返り値はすべて文字列・数値・真偽値にそろえる。** セルの生の値をそのまま返すと、
 * 画面まで届かないことがある（画面には「応答がありません」としか出ず、原因が追えない）。
 * 何が起きても必ずオブジェクトを返し、失敗した理由は reason に入れて画面とログに出す。
 */
function mailGetCaseContext(row, expectedCustomerId) {
  try {
    return mailBuildCaseContext_(row, expectedCustomerId);
  } catch (err) {
    boardLog_('②画面', '案件情報の作成に失敗しました: ' + err.message);
    return { caseRow: 0, reason: err.message };
  }
}

function mailBuildCaseContext_(row, expectedCustomerId) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const customerId = String(values[BOARD_MAIL_COL.customerId - 1] || '').trim();

  // 画面は開いたときの行番号を持ち続ける。その間にメール履歴の行が増減すると、
  // 同じ行番号が別のお客様の行を指してしまう
  const expected = String(expectedCustomerId || '').trim();
  if (expected && expected !== customerId) {
    boardLog_('②画面', '一覧が古くなっています（' + expected + ' のはずが ' +
      (customerId || '空') + ' でした）');
    return { caseRow: 0, stale: true };
  }

  const caseRow = boardFindLatestCaseRow_(ss, customerId);
  if (!caseRow) {
    boardLog_('②画面', '案件が見つかりません（顧客ID ' + (customerId || '空') + '）');
    return { caseRow: 0, customerId: customerId };
  }

  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = cases.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  const settings = boardGetSettings_(ss);

  // Square は外部サービス。つながらなくても、日程の入力までは使えるようにする。
  // ここで例外が出ると画面が何も描けず、原因の分からないまま止まる
  let invoiceId = '';
  let invoice = null;
  let squareError = '';
  try {
    invoiceId = squareVerifyInvoiceId_(ss, caseRow);
    invoice = invoiceId ? squareGetInvoice_(invoiceId) : null;
  } catch (err) {
    squareError = err.message;
    boardLog_('②画面', 'Square の確認に失敗しました: ' + err.message);
  }

  // セルの生の値は返さない。日付や数値のまま返すと画面まで届かないことがある
  const text = function (value) { return String(value == null ? '' : value); };
  const missing = boardEvaluateReadiness_(ss, customerId).missing || [];

  return {
    caseRow: caseRow,
    caseId: text(v[BOARD_COL.caseId - 1]),
    caseStatus: text(v[BOARD_COL.status - 1]),
    registration: text(v[BOARD_COL.registration - 1]),
    repeatCustomer: boardIsRepeatCustomer_(v[BOARD_COL.registration - 1]),
    // 受付開始日が未入力なら、お客様が答えた初回ご依頼予定日を初期値にする
    startDate: text(v[BOARD_COL.startDate - 1]
      ? boardToInputDate_(v[BOARD_COL.startDate - 1])
      : boardToInputDate_(boardParseDate_(v[BOARD_COL.firstDate - 1]))),
    firstDate: text(boardFormatDate_(v[BOARD_COL.firstDate - 1]) || v[BOARD_COL.firstDate - 1]),
    dueFrom: text(boardToInputDate_(v[BOARD_COL.dueFrom - 1])),
    dueTo: text(boardToInputDate_(v[BOARD_COL.dueTo - 1])),
    // 予定点数が未入力なら、お客様が答えた初回ご依頼予定数を初期値にする
    qty: text(v[BOARD_COL.qty - 1] === '' || v[BOARD_COL.qty - 1] === null
      ? boardExtractCount_(v[BOARD_COL.firstQty - 1])
      : v[BOARD_COL.qty - 1]),
    firstQty: text(v[BOARD_COL.firstQty - 1]),
    missing: missing.map(function (m) { return String(m); }),
    signedAt: text(boardToInputDate_(v[BOARD_COL.signedAt - 1])),
    invoiceId: text(invoiceId),
    invoiceStatus: text(invoice ? invoice.status : ''),
    invoiceUrl: text(invoiceId ? squareDashboardUrl_(invoiceId) : ''),
    invoiceSteps: text(settings['請求書送信の手順']),
    squareError: text(squareError),
    sentAt: text(boardFormatDate_(v[BOARD_COL.invoiceSent - 1]))
  };
}

/** 対応種別に応じた入力欄の値を案件へ保存する。 */
function mailSaveCaseFields(caseRow, data) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(caseRow);

  Object.keys(data || {}).forEach(function (key) {
    const field = BOARD_CASE_FIELDS[key];
    if (!field || !field.col) return;   // 案件ボードに列が無い項目（返送の点数など）は保存しない
    const col = BOARD_COL[field.col];
    if (!col) return;
    const value = data[key];
    if (field.type === 'number') {
      sheet.getRange(row, col).setValue(value === '' ? '' : Number(value));
    } else if (field.type === 'date') {
      sheet.getRange(row, col).setValue(boardFromInputDate_(value));
    } else {
      sheet.getRange(row, col).setValue(value);
    }
  });

  boardSetTodoFormula_(sheet, row);
  boardLog_('保存', '案件 ' + sheet.getRange(row, BOARD_COL.caseId).getValue() + ' を更新しました');
  return { message: '案件の内容を保存しました。' };
}

/** 返送の入力欄を、テンプレートの差し込み名に置き換える。 */
function mailShipmentVars_(fields) {
  const data = fields || {};
  return {
    '返送点数': data.shipQty == null ? '' : data.shipQty,
    '返送追跡番号': data.shipTracking == null ? '' : data.shipTracking
  };
}

/** 対応種別を記録するだけ。文面は「この対応で返信案を作る」で生成する。 */
function mailApplyResponseType(row, typeId) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const type = boardFindResponseType_(typeId);
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  sheet.getRange(Number(row), BOARD_MAIL_COL.responseType).setValue(type ? type.name : '');
  return { status: type ? type.status : '' };
}

/**
 * 対応種別のテンプレートを土台に、お客様の問い合わせ内容へ合わせた返信案をAIが作る。
 * テンプレートが無い「通常の返信」では、方針と実例だけを頼りに書く。
 */
function mailComposeWithType(row, typeId, fields) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = mailGetApiKey_();
  if (!apiKey) throw new Error('Anthropic APIキーが未設定です。');

  const type = boardFindResponseType_(typeId);
  if (!type) throw new Error('対応種別を選んでください。');

  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const r = Number(row);
  const values = sheet.getRange(r, 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const customerId = values[BOARD_MAIL_COL.customerId - 1];

  let template = '';
  if (type.template) {
    const caseRow = boardFindLatestCaseRow_(ss, customerId);
    if (!caseRow) throw new Error('このお客様の案件が案件ボードに見つかりません。');
    // 画面で入力した内容を先に保存し、そのうえで文面へ差し込む
    if (fields && Object.keys(fields).length > 0) mailSaveCaseFields(caseRow, fields);
    template = boardBuildTemplateText_(ss, caseRow, type.template, mailShipmentVars_(fields)).body;
  }

  const found = boardFindCustomer_(ss, customerId);
  const customer = found || { company: '', name: '', email: values[BOARD_MAIL_COL.from - 1] };

  const reply = mailGenerateReply_(apiKey, {
    knowledge: mailLoadKnowledge_(ss),
    examples: mailLoadExamples_(ss),
    caseInfo: mailFindCaseSummary_(ss, customerId),
    customer: customer,
    thread: mailContextText_(values),
    template: template,
    instructions: String(values[BOARD_MAIL_COL.instructions - 1] || '')
  });

  sheet.getRange(r, BOARD_MAIL_COL.responseType).setValue(type.name);
  if (!String(values[BOARD_MAIL_COL.aiFirst - 1] || '').trim()) {
    sheet.getRange(r, BOARD_MAIL_COL.aiFirst).setValue(reply);
  }
  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(mailStamp_(new Date(), reply));
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  boardLog_('②返信案', values[BOARD_MAIL_COL.subject - 1] + '：' + type.name + ' の返信案を作成しました');

  return { text: reply, message: '返信案を作成しました。内容をご確認ください。' };
}

/**
 * この行で前に作った下書きを削除する。
 * 二重送信や、古い文面の下書きが残るのを防ぐ。
 */
function mailDiscardDraft_(sheet, row, values) {
  const draftId = String(values[BOARD_MAIL_COL.draftId - 1] || '').trim();
  if (!draftId) return false;
  try {
    const draft = GmailApp.getDraft(draftId);
    if (draft) draft.deleteDraft();
  } catch (err) {
    boardLog_('②下書き', '下書きの削除に失敗（すでに無い可能性）: ' + err.message);
    sheet.getRange(row, BOARD_MAIL_COL.draftId).setValue('');
    return false;
  }
  sheet.getRange(row, BOARD_MAIL_COL.draftId).setValue('');
  return true;
}

/** 新規メールの件名。対応種別のテンプレートに件名があればそれを使う。 */
function mailSubjectFor_(ss, values) {
  const type = boardFindResponseTypeByName_(values[BOARD_MAIL_COL.responseType - 1]);
  if (type && type.template) {
    const tpl = boardFindTemplate_(ss, type.template);
    if (tpl && tpl.subject) return tpl.subject;
  }
  return '【ササゲパス】お問い合わせいただきありがとうございます';
}

/** 返信案の materialとなる文章。メールのスレッド、無ければフォーム回答の内容。 */
function mailContextText_(values) {
  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  if (threadId) {
    try {
      const thread = GmailApp.getThreadById(threadId);
      if (thread) return mailBuildThreadText_(thread.getMessages());
    } catch (err) {
      boardLog_('②エラー', 'スレッドの取得に失敗: ' + err.message);
    }
  }
  return mailUnstamp_(values[BOARD_MAIL_COL.summary - 1]);
}

/** 画面で編集した本文をシートに保存する（下書きにはしない）。 */
function mailSaveText(row, text) {
  boardUseCurrentColumns_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  sheet.getRange(Number(row), BOARD_MAIL_COL.finalText).setValue(mailStamp_(new Date(), text));
  sheet.getRange(Number(row), BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  return { message: '保存しました。' };
}

/**
 * 返信案をゼロから作り直す。
 * 下書きを消してやり直したいときや、対応種別を変えたあとに使う。
 * これまでの修正指示は引き継いで生成する。
 */
function mailRegenerate(row) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = mailGetApiKey_();
  if (!apiKey) throw new Error('Anthropic APIキーが未設定です。');

  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const r = Number(row);
  const values = sheet.getRange(r, 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];

  const customerId = values[BOARD_MAIL_COL.customerId - 1];
  const found = boardFindCustomer_(ss, customerId);
  const customer = found || { company: '', name: '', email: values[BOARD_MAIL_COL.from - 1] };

  let template = '';
  const type = boardFindResponseTypeByName_(values[BOARD_MAIL_COL.responseType - 1]);
  if (type && type.template) {
    const caseRow = boardFindLatestCaseRow_(ss, customerId);
    if (caseRow) template = boardBuildTemplateText_(ss, caseRow, type.template).body;
  }

  const reply = mailGenerateReply_(apiKey, {
    knowledge: mailLoadKnowledge_(ss),
    examples: mailLoadExamples_(ss),
    caseInfo: mailFindCaseSummary_(ss, customerId),
    customer: customer,
    thread: mailContextText_(values),
    template: template,
    instructions: String(values[BOARD_MAIL_COL.instructions - 1] || '')
  });

  sheet.getRange(r, BOARD_MAIL_COL.aiFirst).setValue(reply);
  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(mailStamp_(new Date(), reply));
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  sheet.getRange(r, BOARD_MAIL_COL.savedAt).setValue('');
  boardLog_('②再生成', values[BOARD_MAIL_COL.subject - 1] + ' の返信案を作り直しました');

  return { text: reply, message: '返信案を作り直しました。' };
}

/** AIに修正を依頼する。指示は履歴として蓄積する。 */
function mailReviseText(row, text, instruction) {
  boardUseCurrentColumns_();
  const trimmed = String(instruction || '').trim();
  if (!trimmed) throw new Error('修正の指示を入力してください。');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = mailGetApiKey_();
  if (!apiKey) throw new Error('Anthropic APIキーが未設定です。');

  const revised = mailAskClaude_(apiKey, [
    'あなたは「ササゲパス」のメール担当者です。',
    '既存の返信文を、指示に従って書き直してください。',
    '指示された箇所以外の文体・構成はできるだけ変えないでください。',
    '書き直した返信文の本文だけを出力し、説明は加えないでください。',
    '',
    '【守るべき回答方針】',
    mailLoadKnowledge_(ss) || '（登録なし）'
  ].join('\n'), [
    '【現在の返信文】',
    text,
    '',
    '【修正の指示】',
    trimmed
  ].join('\n'));

  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const cell = sheet.getRange(Number(row), BOARD_MAIL_COL.instructions);
  const log = String(cell.getValue() || '');
  cell.setValue((log ? log + '\n' : '') +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd HH:mm') + ' ' + trimmed);
  sheet.getRange(Number(row), BOARD_MAIL_COL.finalText).setValue(mailStamp_(new Date(), revised));
  sheet.getRange(Number(row), BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  boardLog_('②修正依頼', trimmed);

  return { text: revised };
}

/**
 * 承認して Gmail の下書きに保存する。ここで学習用の記録も残す。
 * 送信はGmail側で人が行う。実際に送られたかは「最新の送信メール」で分かる。
 */
function mailApproveToDraft(row, text, fields) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const r = Number(row);
  const values = sheet.getRange(r, 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  if (!String(text || '').trim()) throw new Error('本文が空です。先に返信案を作成してください。');

  // 差し込みでは埋められない箇所が残ったまま送られるのを防ぐ
  const blank = String(text).match(BOARD_TEMPLATE_PLACEHOLDER);
  if (blank) {
    throw new Error('本文に「' + blank[0] + '」が残っています。\n書き換えてから保存してください。');
  }

  const settings = boardGetSettings_(ss);
  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  // 前に作った下書きは、送るときも作り直すときも先に片付ける。
  // 残しておくと、あとから下書きを送ってしまい二重送信になるため。
  const removed = mailDiscardDraft_(sheet, r, values);

  let draftId = '';
  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  if (threadId) {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) throw new Error('元のメールスレッドが見つかりません。');
    draftId = thread.createDraftReply(text, options).getId();
  } else {
    // フォーム回答が起点の場合は返信先のスレッドが無いため、新規メールとして作る
    const customer = boardFindCustomer_(ss, values[BOARD_MAIL_COL.customerId - 1]);
    const to = customer && boardIsEmail_(customer.email)
      ? customer.email : String(values[BOARD_MAIL_COL.from - 1] || '').trim();
    if (!boardIsEmail_(to)) throw new Error('送信先のメールアドレスが分かりません。「顧客」タブをご確認ください。');
    const subject = mailSubjectFor_(ss, values);
    draftId = GmailApp.createDraft(to, subject, text, options).getId();
  }

  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(mailStamp_(new Date(), text));
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  sheet.getRange(r, BOARD_MAIL_COL.savedAt).setValue(new Date());
  sheet.getRange(r, BOARD_MAIL_COL.draftId).setValue(draftId);

  mailRecordExample_(ss, {
    customer: values[BOARD_MAIL_COL.from - 1],
    subject: values[BOARD_MAIL_COL.subject - 1],
    aiFirst: values[BOARD_MAIL_COL.aiFirst - 1],
    instructions: values[BOARD_MAIL_COL.instructions - 1],
    finalText: text
  });

  const type = boardFindResponseTypeByName_(values[BOARD_MAIL_COL.responseType - 1]);
  let statusNote = '';
  if (type) {
    const caseRow = boardFindLatestCaseRow_(ss, values[BOARD_MAIL_COL.customerId - 1]);
    if (caseRow) {
      const cases = ss.getSheetByName(BOARD_SHEET_CASES);
      if (type.status) {
        cases.getRange(caseRow, BOARD_COL.status).setValue(type.status);
        statusNote = '\n案件のステータスを「' + type.status + '」に更新しました。';
      }
      // 送った日付を残す種別（案内メールなど）は、その列にも記録する
      if (type.stamp && BOARD_COL[type.stamp]) {
        const cell = cases.getRange(caseRow, BOARD_COL[type.stamp]);
        if (!cell.getValue()) cell.setValue(new Date());
      }
      cases.getRange(caseRow, BOARD_COL.lastContact).setValue(new Date());
      boardSetTodoFormula_(cases, caseRow);
      boardSetOwnerFormula_(cases, caseRow);

      // 返送のお知らせは、請求の根拠として返送履歴に残す。
      // 案件行は次の依頼で使い回すため、いまの依頼内容と単価をここで凍結する
      if (type.shipment) {
        boardRecordShipment_(ss, caseRow, fields, {
          subject: values[BOARD_MAIL_COL.subject - 1],
          body: text,
          threadId: threadId,
          draftId: draftId
        });
      }
    }
  }

  boardLog_('②下書き保存', values[BOARD_MAIL_COL.subject - 1] + ' の下書きを保存しました');
  return {
    message: 'Gmailの下書きに保存しました。内容を確認して送信してください。\n' +
      (removed ? '前に作った下書きは削除し、最新の内容に作り直しました。\n' : '') +
      '実際に送信するまでこの一覧には残ります（下書きを消してもやり直せます）。' + statusNote
  };
}

function mailDismiss(row) {
  boardUseCurrentColumns_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  sheet.getRange(Number(row), BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SKIP);
  return { message: '対応不要にしました。' };
}

// ------------------------------------------------------------
// 学習（修正内容の記録と方針の抽出）
// ------------------------------------------------------------

function mailRecordExample_(ss, data) {
  const sheet = ss.getSheetByName(BOARD_SHEET_EXAMPLES);
  if (!sheet) return;

  const changed = String(data.aiFirst || '').trim() !== String(data.finalText || '').trim();
  let lesson = '';
  if (changed) {
    try {
      lesson = mailExtractLesson_(data);
    } catch (err) {
      boardLog_('②学習', '方針の抽出に失敗: ' + err.message);
    }
  }

  sheet.appendRow([
    new Date(), data.customer, data.subject,
    data.aiFirst, data.instructions, data.finalText, lesson
  ]);

  if (lesson) mailAppendKnowledge_(ss, lesson);
}

/** 初回案と最終文面の差から、次回に活かせる方針を1〜2行で抽出する。 */
function mailExtractLesson_(data) {
  const apiKey = mailGetApiKey_();
  if (!apiKey) return '';
  const lesson = mailAskClaude_(apiKey, [
    'あなたはメール文面の編集ログを分析する担当者です。',
    'AIが作った返信案と、担当者が実際に採用した文面を比較し、',
    '次回以降のAI生成に活かせる指示を1〜2行で書いてください。',
    '',
    '守ること:',
    '- 「〜する」「〜しない」という行動指針の形にする。',
    '- この案件だけに当てはまる固有名詞や日付は含めない。一般化する。',
    '- 変更が誤字修正や些細な言い換えだけの場合は、何も出力せず「なし」とだけ書く。'
  ].join('\n'), [
    '【AIが作った案】',
    String(data.aiFirst || '').slice(0, 2000),
    '',
    '【担当者が出した修正指示】',
    String(data.instructions || '（指示なし。直接編集）'),
    '',
    '【採用された最終文面】',
    String(data.finalText || '').slice(0, 2000)
  ].join('\n'), 300);

  const text = String(lesson || '').trim();
  return (text === 'なし' || text === '') ? '' : text;
}

function mailAppendKnowledge_(ss, lesson) {
  const sheet = ss.getSheetByName(BOARD_SHEET_KNOWLEDGE);
  if (!sheet) return;
  sheet.appendRow(['学習（要確認）', lesson, new Date()]);
}

// ------------------------------------------------------------
// Claude API
// ------------------------------------------------------------

function mailGenerateReply_(apiKey, ctx) {
  const system = [
    'あなたは「ササゲパス」（古着・アパレルEC向けのささげ代行サービス。運営：合同会社ケセラセラ）の',
    'メール担当者です。お客様からのメールに対する返信文の下書きを作成してください。',
    '',
    '守ること:',
    '- 日本語のビジネスメールとして自然な文体。丁寧だが冗長にしない。',
    '- 与えられた「回答方針」と「案件状況」だけを根拠にする。書かれていない料金・納期・条件を創作しない。',
    '- 「回答方針」は事実確認のために参照するだけで、本文に必ず盛り込む必要はない。お客様の質問・要望や定型文の内容と関係のない方針は、聞かれていない限り本文に追加しないこと。',
    '- 判断がつかない点は断定せず、「確認のうえご連絡します」と書く。',
    '- 過度な謝罪や自己卑下をしない。言い訳を並べない。',
    '- 答えたくないと方針に書かれている内容は、角が立たない形でやんわりと返す。',
    '- 箇条書きを適度に使い、見出しは「■」を用いる。',
    '- 署名は不要（システム側で付与するため本文のみ）。',
    '- 冒頭は宛名から始める。',
    '',
    '【過去に採用された返信の例】文体と距離感の参考にすること。内容は流用しない。',
    ctx.examples || '（まだ例がありません）'
  ].join('\n');

  const user = [
    '【回答方針】',
    ctx.knowledge || '（登録なし）',
    '',
    '【このお客様の案件状況】',
    ctx.caseInfo || '（案件なし）',
    '',
    '【お客様情報】',
    '会社名: ' + (ctx.customer.company || '（未登録）'),
    '担当者名: ' + (ctx.customer.name || '（未登録）'),
    '',
    '【お客様からの内容（メールのやりとり、またはフォーム回答）】',
    ctx.thread,
    '',
    ctx.instructions ? '【担当者が過去に出した修正指示。今回も反映すること】\n' + ctx.instructions + '\n' : '',
    ctx.template ? [
      '【今回送る定型文（すでに案件の情報が差し込まれています）】',
      '━━━ ここから ━━━',
      ctx.template,
      '━━━ ここまで ━━━',
      '',
      'この定型文を、そのまま返信本文の土台として出力してください。',
      '守ること:',
      '- 見出し・箇条書き・並び順を変えないこと。',
      '- 日付・金額・点数・住所・電話番号・手続きの説明は一字一句そのまま残すこと。',
      '- お客様が触れていない項目でも、案内を削らないこと。',
      '- お客様に質問や要望があるときだけ、定型文の前か後ろに短い段落を足して答えること。',
      '- 定型文に書かれていない事実は足さないこと。',
      '- 「{{」で囲まれた文字が残っていたら、その行ごと削除すること。',
      '',
      '以上を踏まえ、送信できる状態の返信本文だけを出力してください。'
    ].join('\n') : '以上を踏まえ、最新のお客様のメールに対する返信本文だけを出力してください。'
  ].join('\n');

  return mailAskClaude_(apiKey, system, user);
}

function mailAskClaude_(apiKey, system, user, maxTokens) {
  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MAIL_MODEL,
      max_tokens: maxTokens || 2000,
      system: system,
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code !== 200) throw new Error('Claude APIエラー (' + code + '): ' + text.slice(0, 300));

  const data = JSON.parse(text);
  const parts = (data.content || []).filter(function (c) { return c.type === 'text'; });
  if (parts.length === 0) throw new Error('Claude APIから本文が返りませんでした。');
  return parts.map(function (c) { return c.text; }).join('\n').trim();
}

// ------------------------------------------------------------
// 読み込み・整形
// ------------------------------------------------------------

function mailGetApiKey_() {
  return PropertiesService.getScriptProperties().getProperty(MAIL_PROP_API_KEY);
}

function mailLoadCustomers_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues()
    .map(function (row) {
      return { customerId: row[0], company: row[1], name: row[2], email: String(row[3] || '').trim() };
    })
    .filter(function (c) { return boardIsEmail_(c.email); });
}

function mailLoadKnowledge_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_KNOWLEDGE);
  if (!sheet || sheet.getLastRow() < 2) return '';
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    .filter(function (row) { return row[1]; })
    .map(function (row) { return '・[' + (row[0] || 'メモ') + '] ' + row[1]; })
    .join('\n');
}

function mailLoadExamples_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_EXAMPLES);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const start = Math.max(2, sheet.getLastRow() - MAIL_EXAMPLE_COUNT + 1);
  return sheet.getRange(start, 6, sheet.getLastRow() - start + 1, 1).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) { return '---\n' + String(row[0]).slice(0, 1200); })
    .join('\n');
}

function mailFindCaseSummary_(ss, customerId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2 || !customerId) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const lines = [];
  rows.forEach(function (row) {
    if (String(row[BOARD_COL.customerId - 1]).trim() !== String(customerId).trim()) return;
    lines.push([
      row[BOARD_COL.caseId - 1],
      'ステータス: ' + row[BOARD_COL.status - 1],
      '依頼内容: ' + (row[BOARD_COL.detail - 1] || '未確定'),
      '受付開始日: ' + (boardFormatDate_(row[BOARD_COL.startDate - 1]) || '未定'),
      '納期: ' + (boardFormatDateRange_(row[BOARD_COL.dueFrom - 1], row[BOARD_COL.dueTo - 1]) || '未定')
    ].join(' / '));
  });
  return lines.join('\n');
}

function mailBuildThreadText_(messages) {
  const parts = [];
  messages.forEach(function (message) {
    const body = message.getPlainBody()
      .replace(/^>.*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    parts.push([
      '--- ' + Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'),
      '差出人: ' + message.getFrom(),
      body
    ].join('\n'));
  });
  const text = parts.join('\n\n');
  return text.length > MAIL_MAX_BODY_CHARS ? text.slice(text.length - MAIL_MAX_BODY_CHARS) : text;
}

/** 引用部分を落とした本文。案件ボードや要約に載せるために使う。 */
function mailPlainBody_(message) {
  return String(message.getPlainBody() || '')
    .replace(/^>.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mailFirstLines_(text, count) {
  return String(text || '').split('\n').filter(function (l) { return l.trim(); }).slice(0, count).join(' / ');
}

function mailAppendHistory_(ss, data) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet) return;
  // 日時は「メールが届いた日時」。記録した時刻を入れると、
  // 同じスレッドの何通目なのかが見分けられなくなる
  const when = data.date || new Date();
  sheet.appendRow([
    when, data.customerId, '', data.from, data.subject, mailStamp_(when, data.summary),
    data.aiFirst || '', '', mailStamp_(new Date(), data.finalText), data.status,
    data.threadId, '', data.responseType || '', '', data.messageId || ''
  ]);
  const row = sheet.getLastRow();
  boardSetMailCustomerFormula_(sheet, row);
  boardForceRowHeight_(sheet, row, 1);
}

// ------------------------------------------------------------
// APIキーの登録
// ------------------------------------------------------------

function mailSetApiKey() {
  const ui = SpreadsheetApp.getUi();
  const current = mailGetApiKey_();
  const response = ui.prompt(
    'Anthropic APIキーの登録',
    (current ? '現在登録済みです（先頭: ' + current.slice(0, 12) + '…）。\n変更する場合は新しいキーを、' : 'console.anthropic.com で発行したキーを') +
    '\n「sk-ant-」で始まる文字列を貼り付けてください。\n\n' +
    '※このキーはスプレッドシートには保存されず、スクリプトの非公開領域に保管されます。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const key = response.getResponseText().trim();
  if (!key) return;
  if (key.indexOf('sk-ant-') !== 0) {
    ui.alert('「sk-ant-」で始まるキーを入力してください。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(MAIL_PROP_API_KEY, key);
  boardLog_('②設定', 'Anthropic APIキーを登録しました');
  ui.alert('APIキーを登録しました。「返信案を今すぐ作る」でお試しください。');
}
