/**
 * ササゲパス 業務ボード ②メール返信支援
 *
 * 顧客からの新着メールを検知し、Claude API で返信案を生成して
 * Gmail の下書きとして保存する。送信は必ず人が行う。自動送信は実装しない。
 */

const MAIL_LABEL_DONE = 'ササゲパス/返信案作成済';
const MAIL_PROP_API_KEY = 'ANTHROPIC_API_KEY';
const MAIL_MODEL = 'claude-sonnet-5';
const MAIL_LOOKBACK_DAYS = 30;
const MAIL_MAX_THREADS_PER_RUN = 5;
const MAIL_MAX_BODY_CHARS = 4000;
const MAIL_TRIGGER_MINUTES = 10;

// ------------------------------------------------------------
// メニューから呼ぶ操作
// ------------------------------------------------------------

function mailCheckNow() {
  const result = mailScan_();
  SpreadsheetApp.getUi().alert(
    result.drafted > 0
      ? result.drafted + ' 件の返信案を作成しました。Gmailの下書きをご確認ください。'
      : '新しく返信が必要なメールはありませんでした。' + (result.note ? '\n\n' + result.note : '')
  );
}

function mailStartAutoCheck() {
  mailStopAutoCheck_();
  ScriptApp.newTrigger('mailScanFromTrigger')
    .timeBased()
    .everyMinutes(MAIL_TRIGGER_MINUTES)
    .create();
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
// 本体
// ------------------------------------------------------------

function mailScan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = PropertiesService.getScriptProperties().getProperty(MAIL_PROP_API_KEY);
  if (!apiKey) {
    return { drafted: 0, note: 'Anthropic APIキーが未設定です。「ササゲパス」→「APIキーを登録する」から設定してください。' };
  }

  const customers = mailLoadCustomers_(ss);
  if (customers.length === 0) return { drafted: 0, note: '顧客タブに登録がありません。' };

  const label = mailGetLabel_();
  const settings = boardGetSettings_(ss);
  const knowledge = mailLoadKnowledge_(ss);
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
        mailDraftReply_(ss, thread, messages, customer, knowledge, settings, apiKey);
        thread.addLabel(label);
        drafted++;
      } catch (err) {
        boardLog_('②エラー', customer.email + ': ' + err.message);
      }
    }
  }

  if (drafted > 0) boardLog_('②返信案', drafted + ' 件の返信案を作成しました');
  return { drafted: drafted, note: '' };
}

function mailDraftReply_(ss, thread, messages, customer, knowledge, settings, apiKey) {
  const context = mailBuildThreadText_(messages);
  const caseInfo = mailFindCaseSummary_(ss, customer.customerId);
  const reply = mailAskClaude_(apiKey, {
    knowledge: knowledge,
    caseInfo: caseInfo,
    customer: customer,
    thread: context
  });

  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;
  thread.createDraftReply(reply, options);

  mailAppendHistory_(ss, {
    customerId: customer.customerId,
    from: customer.email,
    subject: thread.getFirstMessageSubject(),
    kind: 'AI下書き',
    summary: mailFirstLines_(messages[messages.length - 1].getPlainBody(), 3),
    reply: reply,
    status: '下書き済',
    threadId: thread.getId()
  });

  mailNotify_(settings, customer, thread, reply);
}

function mailAskClaude_(apiKey, ctx) {
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
    '- 冒頭は宛名から始める。'
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
    '以上を踏まえ、最新のお客様のメールに対する返信本文だけを出力してください。'
  ].join('\n');

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MAIL_MODEL,
      max_tokens: 2000,
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

function mailNotify_(settings, customer, thread, reply) {
  const to = String(settings['通知先メールアドレス'] || '').trim();
  if (!to) return;
  const link = 'https://mail.google.com/mail/u/0/#all/' + thread.getId();
  const body = [
    (customer.company || customer.name || customer.email) + ' 様から返信がありました。',
    '返信案を Gmail の下書きに保存しています。',
    '',
    '件名: ' + thread.getFirstMessageSubject(),
    'スレッドを開く: ' + link,
    '',
    '───────── 返信案 ─────────',
    reply,
    '─────────────────────────',
    '',
    '内容を確認し、必要に応じて修正のうえ送信してください。',
    'このメールから自動送信されることはありません。'
  ].join('\n');

  MailApp.sendEmail({
    to: to,
    subject: '【要対応】' + (customer.company || customer.name || customer.email) + ' ─ 返信案を作成しました',
    body: body,
    name: 'ササゲパス業務ボード'
  });
}

// ------------------------------------------------------------
// 読み込み・整形
// ------------------------------------------------------------

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
    new Date(), data.customerId, data.from, data.subject,
    data.kind, data.summary, data.reply, data.status, data.threadId
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
  const current = PropertiesService.getScriptProperties().getProperty(MAIL_PROP_API_KEY);
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
