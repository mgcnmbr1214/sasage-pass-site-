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

function mailCheckNow() {
  const result = mailScan_();
  const ui = SpreadsheetApp.getUi();
  if (result.drafted > 0) {
    ui.alert(result.drafted + ' 件の返信案を作成しました。続けて確認画面を開きます。');
    mailOpenReviewPanel();
    return;
  }
  ui.alert('新しく返信が必要なメールはありませんでした。' + (result.note ? '\n\n' + result.note : ''));
}

function mailStartAutoCheck() {
  mailStopAutoCheck_();
  ScriptApp.newTrigger('mailScanFromTrigger').timeBased().everyMinutes(MAIL_TRIGGER_MINUTES).create();
  boardLog_('②自動チェック', MAIL_TRIGGER_MINUTES + '分ごとの自動チェックを開始しました');
  SpreadsheetApp.getUi().alert(MAIL_TRIGGER_MINUTES + '分ごとの自動チェックを開始しました。');
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
  const settings = boardGetSettings_(SpreadsheetApp.getActiveSpreadsheet());
  if (String(settings['返信案の自動チェック'] || 'オン').trim() === 'オフ') return;
  mailScan_();
}

// ------------------------------------------------------------
// 新着検知と返信案の生成
// ------------------------------------------------------------

function mailScan_() {
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
          summary: mailFirstLines_(last.getPlainBody(), 3),
          aiFirst: reply,
          finalText: reply,
          status: MAIL_STATUS_PENDING,
          threadId: thread.getId()
        });

        thread.addLabel(label);
        mailNotify_(ss, settings, customer, thread, reply);
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
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const status = String(rows[i][BOARD_MAIL_COL.status - 1] || '').trim();
    if (MAIL_OPEN_STATUSES.indexOf(status) < 0) continue;
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

/** 対応種別の一覧を画面に渡す。 */
function mailGetResponseTypes() {
  return BOARD_RESPONSE_TYPES.map(function (t) {
    return { id: t.id, name: t.name, status: t.status, tasks: t.tasks };
  });
}

/**
 * 対応種別を選んだときの本文を返す。
 * 通常返信ならAIの案、テンプレート指定なら案件情報を差し込んだ文面。
 */
function mailApplyResponseType(row, typeId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const type = boardFindResponseType_(typeId);
  if (!type) throw new Error('対応種別が不明です。');

  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  const values = sheet.getRange(Number(row), 1, 1, BOARD_MAIL_HEADERS.length).getValues()[0];
  sheet.getRange(Number(row), BOARD_MAIL_COL.responseType).setValue(type.name);

  if (!type.template) {
    return { text: values[BOARD_MAIL_COL.aiFirst - 1] || '', tasks: type.tasks, status: type.status };
  }

  const caseRow = boardFindLatestCaseRow_(ss, values[BOARD_MAIL_COL.customerId - 1]);
  if (!caseRow) throw new Error('このお客様の案件が案件ボードに見つかりません。');

  const built = boardBuildTemplateText_(ss, caseRow, type.template);
  return { text: built.body, tasks: type.tasks, status: type.status };
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

  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  if (!threadId) throw new Error('元のメールスレッドが見つかりません。');
  const thread = GmailApp.getThreadById(threadId);
  if (!thread) throw new Error('元のメールスレッドが見つかりません。');

  const customerId = values[BOARD_MAIL_COL.customerId - 1];
  const found = boardFindCustomer_(ss, customerId);
  const customer = found || { company: '', name: '', email: values[BOARD_MAIL_COL.from - 1] };

  const reply = mailGenerateReply_(apiKey, {
    knowledge: mailLoadKnowledge_(ss),
    examples: mailLoadExamples_(ss),
    caseInfo: mailFindCaseSummary_(ss, customerId),
    customer: customer,
    thread: mailBuildThreadText_(thread.getMessages()),
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
  const threadId = String(values[BOARD_MAIL_COL.threadId - 1] || '');
  if (!threadId) throw new Error('元のメールスレッドが見つかりません。');

  const thread = GmailApp.getThreadById(threadId);
  if (!thread) throw new Error('元のメールスレッドが見つかりません。');

  const settings = boardGetSettings_(ss);
  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;
  thread.createDraftReply(text, options);

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
      '実際に送信するまでこの一覧には残ります（下書きを消してもやり直せます）。' + statusNote,
    tasks: type ? type.tasks : []
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
    '【メールのやりとり（古い順）】',
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
