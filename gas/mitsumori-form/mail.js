/**
 * ササゲパス 業務ボード ②メール返信支援
 *
 * 顧客からの新着メールを検知し、Claude API で返信案を生成して「メール履歴」に保存する。
 * 確認・修正はスプレッドシート上の画面で行い、承認したものだけを Gmail の下書きにする。
 * 自動送信は実装しない。
 */

const MAIL_LABEL_DONE = 'ササゲパス/返信案作成済';
const MAIL_PROP_API_KEY = 'ANTHROPIC_API_KEY';
const MAIL_MODEL = 'claude-sonnet-5';
const MAIL_LOOKBACK_DAYS = 30;
const MAIL_MAX_THREADS_PER_RUN = 5;
const MAIL_MAX_BODY_CHARS = 4000;
const MAIL_TRIGGER_MINUTES = 10;
const MAIL_EXAMPLE_COUNT = 3;

const MAIL_STATUS_PENDING = '未確認';
const MAIL_STATUS_EDITING = '修正中';
const MAIL_STATUS_SAVED = '下書き保存済';
const MAIL_STATUS_SENT = '送信済';
const MAIL_STATUS_SKIP = '対応不要';

/** 確認画面に出し続ける状態。実際に送信するまでは一覧から消さない。 */
const MAIL_OPEN_STATUSES = [MAIL_STATUS_PENDING, MAIL_STATUS_EDITING, MAIL_STATUS_SAVED];

// ------------------------------------------------------------
// メニューから呼ぶ操作
// ------------------------------------------------------------

function mailOpenReviewPanel() {
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
    'メールの新しい返信案　：' + result.drafted + ' 件',
    '支払い・署名の完了確認：' + completed + ' 件',
    '発送の確認　　　　　　：' + shipped + ' 件'
  ];

  if (result.drafted > 0) {
    ui.alert(lines.join('\n') + '\n\n続けて「対応を選ぶ」画面を開きます。');
    mailOpenReviewPanel();
    return;
  }
  ui.alert(lines.join('\n') + (result.note ? '\n\n' + result.note : ''));
}

/** 新着確認まわりが今どう動いているかを一覧で表示する。 */
function mailShowStatus() {
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

  const switchOn = String(settings['返信案の自動チェック'] || 'オン').trim() !== 'オフ';
  const lines = [
    '■ 自動確認（フォーム回答の取り込みとメールの確認）',
    '　定期実行　：' + (triggers.length > 0 ? MAIL_TRIGGER_MINUTES + '分ごと（動作中）' : 'なし（停止中）'),
    '　設定の切替：' + (switchOn ? 'オン' : 'オフ（動作中でも返信案を作りません）'),
    '',
    '■ 通知',
    '　通知先　　：' + (settings['通知先メールアドレス'] || '（未設定。通知は送られません）'),
    '　下書き差出人：' + (settings['送信元エイリアス'] || '（未設定）'),
    '',
    '■ 検知の対象',
    '　顧客タブの登録アドレス：' + customers.length + ' 件',
    '　さかのぼる期間　　　　：' + MAIL_LOOKBACK_DAYS + '日',
    '　1回に作る返信案の上限　：' + MAIL_MAX_THREADS_PER_RUN + ' 件',
    '',
    '■ 現在の状況',
    '　APIキー　　　：' + (mailGetApiKey_() ? '登録済み' : '未登録（返信案を作れません）'),
    '　確認待ちの返信案：' + pending + ' 件',
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
    '返信案ができたら通知メールが届きます。'
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = boardGetSettings_(ss);
  if (String(settings['返信案の自動チェック'] || 'オン').trim() === 'オフ') return;

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
  const apiKey = mailGetApiKey_();
  if (!apiKey) {
    return { drafted: 0, note: 'Anthropic APIキーが未設定です。「メール返信支援の設定」→「APIキーを登録する」から設定してください。' };
  }

  const customers = mailLoadCustomers_(ss);
  if (customers.length === 0) return { drafted: 0, note: '顧客タブに登録がありません。' };

  const label = mailGetLabel_();
  const settings = boardGetSettings_(ss);
  const knowledge = mailLoadKnowledge_(ss);
  const examples = mailLoadExamples_(ss);
  let drafted = 0;

  for (let i = 0; i < customers.length && drafted < MAIL_MAX_THREADS_PER_RUN; i++) {
    const customer = customers[i];
    const query = 'from:' + customer.email +
      ' newer_than:' + MAIL_LOOKBACK_DAYS + 'd' +
      ' -label:' + MAIL_LABEL_DONE.replace(/\//g, '-');
    let threads;
    try {
      threads = GmailApp.search(query, 0, MAIL_MAX_THREADS_PER_RUN);
    } catch (err) {
      boardLog_('②エラー', 'Gmail検索に失敗: ' + err.message);
      continue;
    }

    for (let t = 0; t < threads.length && drafted < MAIL_MAX_THREADS_PER_RUN; t++) {
      const thread = threads[t];
      if (mailHasLabel_(thread, label)) continue;

      const messages = thread.getMessages();
      const last = messages[messages.length - 1];
      if (last.getFrom().indexOf(customer.email) < 0) continue;

      // 見積もり回答への返信であれば、請求先・返送先を顧客タブへ取り込む
      try {
        const body = last.getPlainBody();
        boardApplyCustomerIntake_(ss, customer.email, boardExtractCustomerIntake_(body));
        boardApplyCaseIntake_(ss, customer.customerId, boardExtractCaseIntake_(body));
        boardAdvanceOnReply_(ss, customer.customerId);
      } catch (err) {
        boardLog_('②エラー', '顧客情報の取込に失敗: ' + err.message);
      }

      try {
        const reply = mailGenerateReply_(apiKey, {
          knowledge: knowledge,
          examples: examples,
          caseInfo: mailFindCaseSummary_(ss, customer.customerId),
          customer: customer,
          thread: mailBuildThreadText_(messages)
        });

        mailAppendHistory_(ss, {
          customerId: customer.customerId,
          from: customer.email,
          subject: thread.getFirstMessageSubject(),
          summary: mailPlainBody_(last).slice(0, MAIL_MAX_BODY_CHARS),
          aiFirst: reply,
          finalText: reply,
          status: MAIL_STATUS_PENDING,
          threadId: thread.getId()
        });

        thread.addLabel(label);
        if (notify) mailNotify_(ss, settings, customer, thread, reply);
        drafted++;
      } catch (err) {
        boardLog_('②エラー', customer.email + ': ' + err.message);
      }
    }
  }

  if (drafted > 0) boardLog_('②返信案', drafted + ' 件の返信案を作成しました');
  return { drafted: drafted, note: '' };
}

function mailNotify_(ss, settings, customer, thread, reply) {
  const to = String(settings['通知先メールアドレス'] || '').trim();
  if (!to) return;
  const body = [
    (customer.company || customer.name || customer.email) + ' 様から返信がありました。',
    '返信案を作成しましたので、内容をご確認ください。',
    '',
    '件名: ' + thread.getFirstMessageSubject(),
    '',
    '確認・修正はスプレッドシートで行います:',
    ss.getUrl(),
    '　→ メニュー「ササゲパス」→「返信案を確認する」',
    '',
    '───────── 返信案 ─────────',
    reply,
    '─────────────────────────',
    '',
    'この案はまだ下書きにも保存されていません。',
    '確認画面で承認した時点で、Gmailの下書きに保存されます。'
  ].join('\n');

  MailApp.sendEmail({
    to: to,
    subject: '【要対応】' + (customer.company || customer.name || customer.email) + ' ─ 返信案ができました',
    body: body,
    name: 'ササゲパス業務ボード'
  });
}

// ------------------------------------------------------------
// 確認画面から呼ばれる操作
// ------------------------------------------------------------

function mailGetPendingList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  mailRefreshSentStatus_(ss);
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const closed = mailClosedCustomers_(ss);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const status = String(rows[i][BOARD_MAIL_COL.status - 1] || '').trim();
    if (MAIL_OPEN_STATUSES.indexOf(status) < 0) continue;
    if (closed[String(rows[i][BOARD_MAIL_COL.customerId - 1] || '').trim()]) continue;
    out.push({
      row: i + 2,
      date: boardFormatDate_(rows[i][BOARD_MAIL_COL.date - 1]),
      from: rows[i][BOARD_MAIL_COL.from - 1],
      subject: rows[i][BOARD_MAIL_COL.subject - 1],
      summary: rows[i][BOARD_MAIL_COL.summary - 1],
      text: rows[i][BOARD_MAIL_COL.finalText - 1] || rows[i][BOARD_MAIL_COL.aiFirst - 1],
      instructions: rows[i][BOARD_MAIL_COL.instructions - 1],
      threadId: rows[i][BOARD_MAIL_COL.threadId - 1],
      responseType: rows[i][BOARD_MAIL_COL.responseType - 1],
      status: status
    });
  }
  return out;
}

/**
 * 「下書き保存済」の行について、実際に返信が送られたかを Gmail 側で確認する。
 * スレッドの最新メールが自分から送られていれば送信済とみなす。
 * 下書きを消しただけの場合は状態を変えないため、一覧から消えない。
 */
function mailRefreshSentStatus_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const ours = mailOwnAddresses_(ss);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();

  rows.forEach(function (row, i) {
    if (String(row[BOARD_MAIL_COL.status - 1] || '').trim() !== MAIL_STATUS_SAVED) return;
    const threadId = String(row[BOARD_MAIL_COL.threadId - 1] || '');
    if (!threadId) return;
    try {
      const thread = GmailApp.getThreadById(threadId);
      if (!thread) return;
      const messages = thread.getMessages();
      const last = messages[messages.length - 1];
      const from = String(last.getFrom() || '').toLowerCase();
      const sentByUs = ours.some(function (address) { return address && from.indexOf(address) >= 0; });
      if (sentByUs) {
        sheet.getRange(i + 2, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SENT);
      }
    } catch (err) {
      boardLog_('②状態確認', threadId + ': ' + err.message);
    }
  });
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
function mailGetCustomerMessage(row) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  const fallback = String(values[BOARD_MAIL_COL.summary - 1] || '(本文を取得できませんでした)');
  if (!threadId) return { text: fallback };

  try {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) return { text: fallback };
    const from = String(values[BOARD_MAIL_COL.from - 1] || '').toLowerCase();
    const messages = thread.getMessages();

    let target = messages[messages.length - 1];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (String(messages[i].getFrom() || '').toLowerCase().indexOf(from) >= 0) {
        target = messages[i];
        break;
      }
    }

    const body = target.getPlainBody().replace(/\n{3,}/g, '\n\n').trim();
    const header = Utilities.formatDate(target.getDate(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') +
      '　' + target.getFrom() + '\n' + '件名: ' + target.getSubject() + '\n' +
      '────────────────────\n';
    return { text: header + body };
  } catch (err) {
    return { text: fallback };
  }
}

/** 見送りになったお客様。対応リストには出さない。 */
function mailClosedCustomers_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const closed = {};
  if (!sheet || sheet.getLastRow() < 2) return closed;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const active = {};
  rows.forEach(function (row) {
    const id = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (!id) return;
    if (String(row[BOARD_COL.status - 1] || '').trim() === BOARD_STATUS_CLOSED) closed[id] = true;
    else active[id] = true;
  });

  // 見送り以外の案件が1件でもあれば、そのお客様は対象に残す
  Object.keys(active).forEach(function (id) { delete closed[id]; });
  return closed;
}

/** 同じお客様の過去のお問い合わせ。新しい順に返す（表示中のものは除く）。 */
function mailGetHistory(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const r = Number(row);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const customerId = String(rows[r - 2][BOARD_MAIL_COL.customerId - 1] || '').trim();
  if (!customerId) return [];

  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (i + 2 === r) continue;
    if (String(rows[i][BOARD_MAIL_COL.customerId - 1] || '').trim() !== customerId) continue;
    out.push({
      date: boardFormatDate_(rows[i][BOARD_MAIL_COL.date - 1]),
      subject: rows[i][BOARD_MAIL_COL.subject - 1],
      responseType: rows[i][BOARD_MAIL_COL.responseType - 1],
      status: rows[i][BOARD_MAIL_COL.status - 1],
      text: rows[i][BOARD_MAIL_COL.summary - 1]
    });
  }
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
      requires: (t.requires || []).map(function (key) { return BOARD_CASE_FIELDS[key].label; }),
      requireKeys: t.requires || []
    };
  });
}

/** この返信に紐づく案件の、入力欄とSquare請求書の状態。 */
function mailGetCaseContext(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  const caseRow = boardFindLatestCaseRow_(ss, values[BOARD_MAIL_COL.customerId - 1]);
  if (!caseRow) return { caseRow: 0 };

  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = cases.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  const invoiceId = String(v[BOARD_COL.invoiceId - 1] || '').trim();
  const invoice = invoiceId ? squareGetInvoice_(invoiceId) : null;
  const settings = boardGetSettings_(ss);

  return {
    caseRow: caseRow,
    caseId: v[BOARD_COL.caseId - 1],
    caseStatus: v[BOARD_COL.status - 1],
    startDate: boardToInputDate_(v[BOARD_COL.startDate - 1]),
    dueFrom: boardToInputDate_(v[BOARD_COL.dueFrom - 1]),
    dueTo: boardToInputDate_(v[BOARD_COL.dueTo - 1]),
    // 予定点数が未入力なら、お客様が答えた初回ご依頼予定数を初期値にする
    qty: v[BOARD_COL.qty - 1] === '' || v[BOARD_COL.qty - 1] === null
      ? boardExtractCount_(v[BOARD_COL.firstQty - 1])
      : v[BOARD_COL.qty - 1],
    firstQty: v[BOARD_COL.firstQty - 1],
    missing: boardEvaluateReadiness_(ss, values[BOARD_MAIL_COL.customerId - 1]).missing,
    signedAt: boardToInputDate_(v[BOARD_COL.signedAt - 1]),
    invoiceId: invoiceId,
    invoiceStatus: invoice ? invoice.status : '',
    invoiceUrl: invoiceId ? squareDashboardUrl_(invoiceId) : '',
    invoiceSteps: String(settings['請求書送信の手順'] || ''),
    sentAt: boardFormatDate_(v[BOARD_COL.invoiceSent - 1])
  };
}

/** 対応種別に応じた入力欄の値を案件へ保存する。 */
function mailSaveCaseFields(caseRow, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(caseRow);

  Object.keys(data || {}).forEach(function (key) {
    const field = BOARD_CASE_FIELDS[key];
    if (!field) return;
    const col = BOARD_COL[field.col];
    const value = data[key];
    if (field.type === 'number') {
      sheet.getRange(row, col).setValue(value === '' ? '' : Number(value));
    } else {
      sheet.getRange(row, col).setValue(boardFromInputDate_(value));
    }
  });

  boardSetTodoFormula_(sheet, row);
  boardLog_('保存', '案件 ' + sheet.getRange(row, BOARD_COL.caseId).getValue() + ' を更新しました');
  return { message: '案件の内容を保存しました。' };
}

/** 対応種別を記録するだけ。文面は「この対応で返信案を作る」で生成する。 */
function mailApplyResponseType(row, typeId) {
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
function mailComposeWithType(row, typeId) {
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
    template = boardBuildTemplateText_(ss, caseRow, type.template).body;
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
  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(reply);
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_EDITING);
  boardLog_('②返信案', values[BOARD_MAIL_COL.subject - 1] + '：' + type.name + ' の返信案を作成しました');

  return { text: reply, message: '返信案を作成しました。内容をご確認ください。' };
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
  return String(values[BOARD_MAIL_COL.summary - 1] || '');
}

/** 画面で編集した本文をシートに保存する（下書きにはしない）。 */
function mailSaveText(row, text) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_MAILS);
  sheet.getRange(Number(row), BOARD_MAIL_COL.finalText).setValue(text);
  sheet.getRange(Number(row), BOARD_MAIL_COL.status).setValue(MAIL_STATUS_EDITING);
  return { message: '保存しました。' };
}

/**
 * 返信案をゼロから作り直す。
 * 下書きを消してやり直したいときや、対応種別を変えたあとに使う。
 * これまでの修正指示は引き継いで生成する。
 */
function mailRegenerate(row) {
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
  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(reply);
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_PENDING);
  sheet.getRange(r, BOARD_MAIL_COL.savedAt).setValue('');
  boardLog_('②再生成', values[BOARD_MAIL_COL.subject - 1] + ' の返信案を作り直しました');

  return { text: reply, message: '返信案を作り直しました。' };
}

/** AIに修正を依頼する。指示は履歴として蓄積する。 */
function mailReviseText(row, text, instruction) {
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
  sheet.getRange(Number(row), BOARD_MAIL_COL.finalText).setValue(revised);
  sheet.getRange(Number(row), BOARD_MAIL_COL.status).setValue(MAIL_STATUS_EDITING);
  boardLog_('②修正依頼', trimmed);

  return { text: revised };
}

/** 承認して Gmail の下書きに保存する。ここで学習用の記録も残す。 */
function mailApproveToDraft(row, text) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const r = Number(row);
  const values = sheet.getRange(r, 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  if (!String(text || '').trim()) throw new Error('本文が空です。先に返信案を作成してください。');

  const settings = boardGetSettings_(ss);
  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  if (threadId) {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) throw new Error('元のメールスレッドが見つかりません。');
    thread.createDraftReply(text, options);
  } else {
    // フォーム回答が起点の場合は返信先のスレッドが無いため、新規メールとして作る
    const customer = boardFindCustomer_(ss, values[BOARD_MAIL_COL.customerId - 1]);
    const to = customer && boardIsEmail_(customer.email)
      ? customer.email : String(values[BOARD_MAIL_COL.from - 1] || '').trim();
    if (!boardIsEmail_(to)) throw new Error('送信先のメールアドレスが分かりません。「顧客」タブをご確認ください。');
    GmailApp.createDraft(to, mailSubjectFor_(ss, values), text, options);
  }

  sheet.getRange(r, BOARD_MAIL_COL.finalText).setValue(text);
  sheet.getRange(r, BOARD_MAIL_COL.status).setValue(MAIL_STATUS_SAVED);
  sheet.getRange(r, BOARD_MAIL_COL.savedAt).setValue(new Date());

  mailRecordExample_(ss, {
    customer: values[BOARD_MAIL_COL.from - 1],
    subject: values[BOARD_MAIL_COL.subject - 1],
    aiFirst: values[BOARD_MAIL_COL.aiFirst - 1],
    instructions: values[BOARD_MAIL_COL.instructions - 1],
    finalText: text
  });

  const type = boardFindResponseTypeByName_(values[BOARD_MAIL_COL.responseType - 1]);
  let statusNote = '';
  if (type && type.status) {
    const caseRow = boardFindLatestCaseRow_(ss, values[BOARD_MAIL_COL.customerId - 1]);
    if (caseRow) {
      const cases = ss.getSheetByName(BOARD_SHEET_CASES);
      cases.getRange(caseRow, BOARD_COL.status).setValue(type.status);
      cases.getRange(caseRow, BOARD_COL.lastContact).setValue(new Date());
      boardSetTodoFormula_(cases, caseRow);
      statusNote = '\n案件のステータスを「' + type.status + '」に更新しました。';
    }
  }

  boardLog_('②下書き保存', values[BOARD_MAIL_COL.subject - 1] + ' の下書きを保存しました');
  return {
    message: 'Gmailの下書きに保存しました。内容を確認して送信してください。\n' +
      '実際に送信するまでこの一覧には残ります（下書きを消してもやり直せます）。' + statusNote
  };
}

function mailDismiss(row) {
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
    ctx.examples || '（まだ例がありません）',
    '',
    ctx.template ? [
      '【今回の土台となる定型文】',
      'この定型文を土台にしてください。',
      '- 料金・納期・住所・手続きなどの記載は、一字一句そのまま残すこと。',
      '- お客様が触れていない項目でも、定型文にある案内は削らないこと。',
      '- お客様の質問や要望に対しては、定型文の前後に必要な文を足して答えること。',
      '- 定型文に書かれていない事実は足さないこと。',
      '',
      ctx.template
    ].join('\n') : ''
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
    '以上を踏まえ、最新のお客様のメールに対する返信本文だけを出力してください。'
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
  sheet.appendRow([
    new Date(), data.customerId, data.from, data.subject, data.summary,
    data.aiFirst, '', data.finalText, data.status, data.threadId, ''
  ]);
}

function mailGetLabel_() {
  return GmailApp.getUserLabelByName(MAIL_LABEL_DONE) || GmailApp.createLabel(MAIL_LABEL_DONE);
}

function mailHasLabel_(thread, label) {
  const name = label.getName();
  return thread.getLabels().some(function (l) { return l.getName() === name; });
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
