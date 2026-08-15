/**
 * ササゲパス 業務ボード
 *
 * 既存の見積もりフォーム（code.js / Index.html）には一切手を触れず、
 * 同じスプレッドシート上に案件管理用のタブを追加する。
 * Config / Responses シートは読み取りのみ。書き込みは行わない。
 */

const BOARD_SHEET_CASES = '案件ボード';
const BOARD_SHEET_CUSTOMERS = '顧客';
const BOARD_SHEET_MAILS = 'メール履歴';
const BOARD_SHEET_TEMPLATES = 'テンプレ';
const BOARD_SHEET_KNOWLEDGE = 'ナレッジ';
const BOARD_SHEET_SETTINGS = '設定';
const BOARD_SHEET_LOGS = 'ログ';

const BOARD_SOURCE_SHEET = 'Responses';

const BOARD_STATUSES = ['問合せ', '返信済', '依頼確定', '手続き待ち', '発送待ち', '作業中', '返送済', '見送り'];

const BOARD_STATUS_COLORS = {
  '問合せ': '#FAEEDA',
  '返信済': '#FAEEDA',
  '依頼確定': '#EEEDFE',
  '手続き待ち': '#E6F1FB',
  '発送待ち': '#E1F5EE',
  '作業中': '#F1EFE8',
  '返送済': '#F1EFE8',
  '見送り': '#F1EFE8'
};

const BOARD_CASE_HEADERS = [
  '案件ID', 'ステータス', 'お客様', '点数', '受付開始日', '納期予定', '次にやること',
  '顧客ID', '依頼内容', '単価', '請求書URL', '請求書送付日', '署名・支払確認日',
  '追跡番号', '案内メール作成日', '最終連絡日', 'メモ', '元回答行'
];

const BOARD_CUSTOMER_HEADERS = [
  '顧客ID', '会社名・屋号', '担当者名', 'メールアドレス', '電話番号',
  '返送先 郵便番号', '返送先 住所', '返送先 宛名',
  '依頼内容', '月間予定数', '単価', '初回問い合わせ日', '最終更新日', 'メモ'
];

const BOARD_MAIL_HEADERS = ['日時', '顧客ID', '差出人', '件名', '種別', '要約', 'AI返信案', '状態', 'GmailスレッドID'];
const BOARD_TEMPLATE_HEADERS = ['ID', '名称', '件名', '本文', '備考'];
const BOARD_KNOWLEDGE_HEADERS = ['分類', '内容', '更新日'];
const BOARD_SETTINGS_HEADERS = ['項目', '値', '説明'];
const BOARD_LOG_HEADERS = ['日時', '種別', '内容'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ササゲパス')
    .addItem('案件を開く', 'boardOpenPanel')
    .addSeparator()
    .addItem('フォーム回答を取り込む', 'boardImportResponses')
    .addSeparator()
    .addItem('初期セットアップ', 'boardSetup')
    .addToUi();
}

// ------------------------------------------------------------
// 初期セットアップ
// ------------------------------------------------------------

function boardSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  boardSetupSheet_(ss, BOARD_SHEET_CASES, BOARD_CASE_HEADERS, [90, 100, 150, 55, 95, 95, 200]);
  boardSetupSheet_(ss, BOARD_SHEET_CUSTOMERS, BOARD_CUSTOMER_HEADERS, [80, 170, 120, 220, 130]);
  boardSetupSheet_(ss, BOARD_SHEET_MAILS, BOARD_MAIL_HEADERS, [140, 80, 200, 240]);
  boardSetupSheet_(ss, BOARD_SHEET_TEMPLATES, BOARD_TEMPLATE_HEADERS, [50, 200, 260, 460, 200]);
  boardSetupSheet_(ss, BOARD_SHEET_KNOWLEDGE, BOARD_KNOWLEDGE_HEADERS, [140, 560, 100]);
  boardSetupSheet_(ss, BOARD_SHEET_SETTINGS, BOARD_SETTINGS_HEADERS, [220, 300, 340]);
  boardSetupSheet_(ss, BOARD_SHEET_LOGS, BOARD_LOG_HEADERS, [150, 100, 500]);

  boardApplyCaseFormatting_(ss.getSheetByName(BOARD_SHEET_CASES));
  boardSeedSettings_(ss.getSheetByName(BOARD_SHEET_SETTINGS));
  boardSeedTemplates_(ss.getSheetByName(BOARD_SHEET_TEMPLATES));
  boardSeedKnowledge_(ss.getSheetByName(BOARD_SHEET_KNOWLEDGE));

  boardOrderSheets_(ss);
  boardHideSourceSheets_(ss);
  const imported = boardImportResponses_(ss);
  boardLog_('セットアップ', '初期セットアップを実行しました（取込 ' + imported + ' 件）');

  SpreadsheetApp.getUi().alert(
    'セットアップが完了しました。\n\n' +
    'フォーム回答の取り込み：' + imported + ' 件\n\n' +
    '「案件ボード」タブをご確認ください。'
  );
}

function boardSetupSheet_(ss, name, headers, widths) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#F1EFE8')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  if (widths) {
    for (let i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  }
  return sheet;
}

function boardApplyCaseFormatting_(sheet) {
  sheet.setFrozenColumns(3);

  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  const statusRange = sheet.getRange(2, 2, maxRows, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(BOARD_STATUSES, true)
    .setAllowInvalid(false)
    .build();
  statusRange.setDataValidation(rule);

  const rules = [];
  BOARD_STATUSES.forEach(function (status) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(BOARD_STATUS_COLORS[status])
      .setRanges([statusRange])
      .build());
  });

  const todoRange = sheet.getRange(2, 7, maxRows, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('日付を入れて')
    .setFontColor('#A32D2D')
    .setRanges([todoRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('経過')
    .setFontColor('#A32D2D')
    .setRanges([todoRange])
    .build());

  sheet.setConditionalFormatRules(rules);

  sheet.getRange(2, 5, maxRows, 2).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, 12, maxRows, 2).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, 15, maxRows, 2).setNumberFormat('yyyy/mm/dd');
}

function boardHideSourceSheets_(ss) {
  ['Config', BOARD_SOURCE_SHEET].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden() && ss.getSheets().length > 1) sheet.hideSheet();
  });
}

function boardOrderSheets_(ss) {
  const order = [BOARD_SHEET_CASES, BOARD_SHEET_CUSTOMERS, BOARD_SHEET_MAILS,
    BOARD_SHEET_TEMPLATES, BOARD_SHEET_KNOWLEDGE, BOARD_SHEET_SETTINGS, BOARD_SHEET_LOGS];
  order.forEach(function (name, index) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(index + 1);
  });
  ss.setActiveSheet(ss.getSheetByName(BOARD_SHEET_CASES));
}

// ------------------------------------------------------------
// 初期データ
// ------------------------------------------------------------

function boardSeedSettings_(sheet) {
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, 10, 3).setValues([
    ['通知先メールアドレス', 'sasagepass@gmail.com', '②の返信案ができたときの通知先'],
    ['送信元エイリアス', 'info@sasagepass.com', 'メール下書きの差出人。Gmailにエイリアス登録が必要'],
    ['営業所コード', '160652', '案内メールの発送先'],
    ['営業所名', '松原柴垣営業所', ''],
    ['発送先郵便番号', '580-0017', ''],
    ['発送先宛名', '合同会社ケセラセラ', ''],
    ['発送先TEL', '', 'ヤマト送り状に記載する電話番号。ここに入力してください'],
    ['品名', '衣類', ''],
    ['手続き待ちリマインド日数', 5, '署名・支払いが確認できないまま経過した日数'],
    ['発送待ちリマインド日数', 7, '追跡番号の連絡がないまま経過した日数']
  ]);
}

function boardSeedKnowledge_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const now = new Date();
  sheet.getRange(2, 1, 5, 3).setValues([
    ['回答方針', '撮影機材はスマートフォンでの撮影は行っていない。ミラーレスまたは一眼レフを使用。ただし商品画像は容量圧縮を行うため状況に応じて使い分けており、個別の機種・設定は答えない。品質は納品画像で確認いただく。', now],
    ['回答方針', 'クリーニングの洗剤・乾燥方法・アイロンの当て方は、素材や状態に応じて弊社判断で行う。一律の手順はないため個別工程の案内は控える。「この工程は不要」という指定には対応する。', now],
    ['回答方針', '破損・紛失の補償制度は設けていない。外部保険や金額を定めた補償の取り決めは難しい。弊社作業に起因すると判断できる場合は修理費用の負担など誠実に対応する。高額商品や破損リスクの高い商品は依頼を控えるか事前相談を依頼する。', now],
    ['回答方針', '弊社への発送はお客様負担、返送は弊社負担。発送方法・梱包に指定を設けていないのは、お客様が簡単に送れるようにするための配慮であり、発送時の送料をご負担いただいている理由の一つでもある。', now],
    ['回答方針', '数量割引は月間50点以上が対象。初回契約料・基本料金はなく、依頼のない月に費用は発生しない。', now]
  ]);
}

function boardSeedTemplates_(sheet) {
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, 2, 5).setValues([
    ['T2', '案内メール（依頼確定時）', '【ササゲパス】ご依頼を承りました（発送先・スケジュールのご案内）', boardDefaultGuideBody_(), '受付開始日と納期予定が未入力の場合は下書きを作成しない'],
    ['T4', '手続き完了のご連絡', '【ササゲパス】お手続きを確認いたしました', boardDefaultDoneBody_(), '署名・カード登録の確認後に送る']
  ]);
  sheet.getRange(2, 4, 2, 1).setWrap(true);
  sheet.setRowHeights(2, 2, 120);
}

function boardDefaultGuideBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    'このたびはご依頼をいただき、誠にありがとうございます。',
    '下記のとおりご案内いたしますので、ご確認をお願いいたします。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ ご依頼内容',
    '━━━━━━━━━━━━━━━━━━━━',
    '　ご依頼内容　：{{依頼内容}}',
    '　ご依頼点数　：{{点数}}点',
    '　単　　　価　：{{単価}}／点',
    '　受付開始日　：{{受付開始日}}',
    '　納期の目安　：{{納期予定}}',
    '　※納期は商品到着後の状況により前後する場合がございます。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ ご発送前のお手続き（お支払い方法のご登録）',
    '━━━━━━━━━━━━━━━━━━━━',
    '本メールとは別に、Square より',
    '「サービスご利用における決済情報のご登録とご署名に関するお願い」',
    'という件名で、220円（税込）のご請求書をお送りしております。',
    '',
    'こちらは毎月のご請求を自動化するための、',
    'カード情報のご登録と契約書へのご署名のお手続きです。',
    '恐れ入りますが、ご発送の前にお手続きをお願いいたします。',
    '手順は請求書メール内に記載しております。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ 発送先',
    '━━━━━━━━━━━━━━━━━━━━',
    'ヤマト運輸の「営業所止め」でご発送ください。',
    '',
    '　営業所コード　：{{営業所コード}}',
    '　営 業 所 名　：{{営業所名}}',
    '　〒{{発送先郵便番号}}　大阪府松原市',
    '　{{発送先宛名}}',
    '　電 話 番 号　：{{発送先TEL}}',
    '　品　　　名　：{{品名}}',
    '',
    '・ヤマト運輸のWeb集荷をご利用の場合は、上記の営業所コードをご入力ください。',
    '・手書きの送り状の場合は上記のとおりご記入のうえ、',
    '　伝票右下の「営業所受け取りサービス」へのチェックを必ずお願いいたします。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ 発送にあたってのお願い',
    '━━━━━━━━━━━━━━━━━━━━',
    '・梱包方法に指定はございません。ご都合のよい方法で結構です。',
    '・ご発送後、このメールにそのままご返信いただく形で、',
    '　送り状のお問い合わせ番号（追跡番号）またはお控えの写真をお送りください。',
    '・商品の状態に応じて、弊社判断で必要なメンテナンスを行います。',
    '　手を加えてほしくない商品がある場合は、',
    '　「メンテナンス不要」とわかる形でご発送ください。',
    '',
    'ご不明な点がございましたら、本メールへのご返信にてお気軽にご連絡ください。',
    '引き続きどうぞよろしくお願い申し上げます。'
  ].join('\n');
}

function boardDefaultDoneBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    '',
    '契約書へのご署名と決済情報のご登録を確認いたしました。',
    'ありがとうございます。',
    '',
    '商品のご発送をお願いいたします。発送先は前回のご案内のとおりです。',
    'ご発送後、本メールへのご返信にて、',
    '送り状のお問い合わせ番号またはお控えの写真をお送りいただけますと幸いです。',
    '',
    '　受付開始日　：{{受付開始日}}',
    '　納期の目安　：{{納期予定}}',
    '',
    'どうぞよろしくお願い申し上げます。'
  ].join('\n');
}

// ------------------------------------------------------------
// フォーム回答の取り込み
// ------------------------------------------------------------

function boardImportResponses() {
  const count = boardImportResponses_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(count > 0 ? count + ' 件の新しい回答を取り込みました。' : '新しい回答はありませんでした。');
}

function boardImportResponses_(ss) {
  const source = ss.getSheetByName(BOARD_SOURCE_SHEET);
  if (!source || source.getLastRow() < 2) return 0;

  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const customers = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!cases || !customers) return 0;

  const imported = {};
  if (cases.getLastRow() > 1) {
    cases.getRange(2, 18, cases.getLastRow() - 1, 1).getValues().forEach(function (row) {
      if (row[0]) imported[String(row[0])] = true;
    });
  }

  const rows = source.getRange(2, 1, source.getLastRow() - 1, 15).getValues();
  let added = 0;

  for (let i = 0; i < rows.length; i++) {
    const sourceRow = i + 2;
    if (imported[String(sourceRow)]) continue;

    const r = rows[i];
    const email = String(r[3] || '').trim();
    if (!email) continue;

    const customerId = boardUpsertCustomer_(customers, {
      company: String(r[1] || '').trim(),
      name: String(r[2] || '').trim(),
      email: email,
      tel: String(r[4] || '').trim(),
      detail: String(r[7] || '').trim(),
      monthly: r[5],
      unitPrice: r[10],
      date: r[0]
    });

    const caseRow = cases.getLastRow() + 1;
    const caseId = 'A' + boardPad_(caseRow - 1, 3);
    cases.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).setValues([[
      caseId, '問合せ', String(r[1] || '').trim() || String(r[2] || '').trim(), '', '', '', '',
      customerId, String(r[7] || '').trim(), r[10], '', '', '',
      '', '', r[0], '', sourceRow
    ]]);
    boardSetTodoFormula_(cases, caseRow);
    added++;
  }

  if (added > 0) boardLog_('取込', added + ' 件の回答を取り込みました');
  return added;
}

function boardUpsertCustomer_(sheet, data) {
  const last = sheet.getLastRow();
  if (last > 1) {
    const emails = sheet.getRange(2, 4, last - 1, 1).getValues();
    for (let i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).trim().toLowerCase() === data.email.toLowerCase()) {
        const row = i + 2;
        sheet.getRange(row, 13).setValue(new Date());
        if (data.detail) sheet.getRange(row, 9).setValue(data.detail);
        return sheet.getRange(row, 1).getValue();
      }
    }
  }

  const row = last + 1;
  const customerId = 'C' + boardPad_(row - 1, 3);
  sheet.getRange(row, 1, 1, BOARD_CUSTOMER_HEADERS.length).setValues([[
    customerId, data.company, data.name, data.email, data.tel,
    '', '', '',
    data.detail, data.monthly, data.unitPrice, data.date, new Date(), ''
  ]]);
  return customerId;
}

function boardSetTodoFormula_(sheet, row) {
  const b = '$B' + row;
  const e = '$E' + row;
  const f = '$F' + row;
  const o = '$O' + row;
  const elapsed = '" ("&TEXT(TODAY()-' + o + ',"0")&"日経過)"';
  const formula = '=IF($A' + row + '="","",IFS(' +
    b + '="問合せ","返信案を確認して返信",' +
    b + '="返信済","お客様の返信待ち",' +
    b + '="依頼確定",IF(OR(' + e + '="",' + f + '=""),"日付を入れて案内メール","案内メールを送る"),' +
    b + '="手続き待ち","署名・支払い待ち"&IF(' + o + '="","",' + elapsed + '),' +
    b + '="発送待ち","追跡番号の連絡待ち",' +
    b + '="作業中","作業"&IF(' + f + '="","","納期 "&TEXT(' + f + ',"m/d")),' +
    'TRUE,""))';
  sheet.getRange(row, 7).setFormula(formula);
}

function boardPad_(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

// ------------------------------------------------------------
// サイドパネル
// ------------------------------------------------------------

function boardOpenPanel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== BOARD_SHEET_CASES) {
    SpreadsheetApp.getUi().alert('「案件ボード」タブで、開きたい案件の行を選んでから実行してください。');
    return;
  }
  const row = sheet.getActiveRange().getRow();
  if (row < 2 || !sheet.getRange(row, 1).getValue()) {
    SpreadsheetApp.getUi().alert('案件の行を選んでから実行してください。');
    return;
  }
  PropertiesService.getUserProperties().setProperty('BOARD_ACTIVE_ROW', String(row));
  const html = HtmlService.createTemplateFromFile('Board').evaluate().setTitle('案件の詳細');
  SpreadsheetApp.getUi().showSidebar(html);
}

function boardGetActiveCase() {
  const row = Number(PropertiesService.getUserProperties().getProperty('BOARD_ACTIVE_ROW') || 0);
  if (!row) throw new Error('案件が選択されていません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  return {
    row: row,
    caseId: v[0],
    status: v[1],
    customer: v[2],
    qty: v[3],
    startDate: boardToInputDate_(v[4]),
    dueDate: boardToInputDate_(v[5]),
    todo: v[6],
    customerId: v[7],
    detail: v[8],
    unitPrice: v[9],
    invoiceUrl: v[10],
    email: boardFindCustomerEmail_(ss, v[7])
  };
}

function boardSaveCase(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(data.row);
  sheet.getRange(row, 4).setValue(data.qty === '' ? '' : Number(data.qty));
  sheet.getRange(row, 5).setValue(boardFromInputDate_(data.startDate));
  sheet.getRange(row, 6).setValue(boardFromInputDate_(data.dueDate));
  sheet.getRange(row, 11).setValue(data.invoiceUrl || '');
  if (data.status) sheet.getRange(row, 2).setValue(data.status);
  boardSetTodoFormula_(sheet, row);
  boardLog_('保存', data.caseId + ' を更新しました');
  return boardGetActiveCase();
}

function boardCreateGuideDraft(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(data.row);

  boardSaveCase(data);

  const v = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  if (!v[4] || !v[5]) throw new Error('受付開始日と納期予定を両方入力してください。');

  const customer = boardFindCustomer_(ss, v[7]);
  if (!customer || !customer.email) throw new Error('顧客のメールアドレスが見つかりません。「顧客」タブをご確認ください。');

  const tpl = boardFindTemplate_(ss, 'T2');
  if (!tpl) throw new Error('テンプレ T2 が見つかりません。「テンプレ」タブをご確認ください。');

  const settings = boardGetSettings_(ss);
  const vars = {
    '会社名': customer.company,
    '担当者名': customer.name,
    '依頼内容': v[8],
    '点数': v[3],
    '単価': v[9],
    '受付開始日': boardFormatDate_(v[4]),
    '納期予定': boardFormatDate_(v[5]),
    '営業所コード': settings['営業所コード'],
    '営業所名': settings['営業所名'],
    '発送先郵便番号': settings['発送先郵便番号'],
    '発送先宛名': settings['発送先宛名'],
    '発送先TEL': settings['発送先TEL'],
    '品名': settings['品名']
  };

  const subject = boardFill_(tpl.subject, vars);
  const body = boardFill_(tpl.body, vars);
  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  GmailApp.createDraft(customer.email, subject, body, options);

  sheet.getRange(row, 15).setValue(new Date());
  if (!sheet.getRange(row, 12).getValue()) sheet.getRange(row, 12).setValue(new Date());
  sheet.getRange(row, 2).setValue('手続き待ち');
  boardSetTodoFormula_(sheet, row);
  boardLog_('下書き作成', v[0] + ' の案内メール下書きを作成しました');

  return { message: 'Gmailの下書きを作成しました。内容を確認して送信してください。', to: customer.email };
}

function boardGmailSearchUrl(email) {
  return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(email);
}

// ------------------------------------------------------------
// ヘルパー
// ------------------------------------------------------------

function boardFindCustomer_(ss, customerId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(customerId)) {
      return { company: rows[i][1], name: rows[i][2], email: String(rows[i][3] || '').trim(), tel: rows[i][4] };
    }
  }
  return null;
}

function boardFindCustomerEmail_(ss, customerId) {
  const c = boardFindCustomer_(ss, customerId);
  return c ? c.email : '';
}

function boardFindTemplate_(ss, id) {
  const sheet = ss.getSheetByName(BOARD_SHEET_TEMPLATES);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_TEMPLATE_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return { subject: String(rows[i][2]), body: String(rows[i][3]) };
  }
  return null;
}

function boardGetSettings_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_SETTINGS);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (row) {
    if (row[0]) out[String(row[0]).trim()] = row[1];
  });
  return out;
}

function boardFill_(text, vars) {
  let out = String(text || '');
  Object.keys(vars).forEach(function (key) {
    const value = vars[key] === null || vars[key] === undefined ? '' : String(vars[key]);
    out = out.split('{{' + key + '}}').join(value);
  });
  return out;
}

function boardFormatDate_(value) {
  if (!value) return '';
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(value), tz, 'yyyy年M月d日');
}

function boardToInputDate_(value) {
  if (!value) return '';
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(value), tz, 'yyyy-MM-dd');
}

function boardFromInputDate_(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  if (parts.length !== 3) return '';
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function boardLog_(kind, message) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_LOGS);
  if (!sheet) return;
  sheet.appendRow([new Date(), kind, message]);
}
