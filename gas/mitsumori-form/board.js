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

const BOARD_STATUS_SIGNING = '支払い情報登録・契約書署名待ち';

const BOARD_STATUSES = ['問合せ', '返信済', '依頼確定', BOARD_STATUS_SIGNING, '発送待ち', '作業中', '返送済', '見送り'];

const BOARD_STATUS_COLORS = {
  '問合せ': '#FAEEDA',
  '返信済': '#FAEEDA',
  '依頼確定': '#EEEDFE',
  '支払い情報登録・契約書署名待ち': '#E6F1FB',
  '発送待ち': '#E1F5EE',
  '作業中': '#F1EFE8',
  '返送済': '#F1EFE8',
  '見送り': '#F1EFE8'
};

/** 旧名称 → 新名称。セットアップ時に既存の値を書き換える。 */
const BOARD_STATUS_RENAMES = { '手続き待ち': BOARD_STATUS_SIGNING };

/** 案件ボードの列。順序を変えたら docs/シート設計.md も更新すること。 */
const BOARD_CASE_HEADERS = [
  '案件ID', 'ステータス', 'お客様', '予定点数', '受付開始日', '納期予定（自）', '納期予定（至）', '次にやること',
  '顧客ID', '依頼内容', '単価', '請求書送付日', 'Square請求書ID', '署名・支払確認日',
  '追跡番号', '案内メール作成日', '最終連絡日', 'メモ', '元回答行'
];

const BOARD_COL = {
  caseId: 1, status: 2, customer: 3, qty: 4, startDate: 5, dueFrom: 6, dueTo: 7, todo: 8,
  customerId: 9, detail: 10, unitPrice: 11, invoiceSent: 12, invoiceId: 13,
  signedAt: 14, tracking: 15, guideDraftAt: 16, lastContact: 17, memo: 18, sourceRow: 19
};

const BOARD_CUSTOMER_HEADERS = [
  '顧客ID', '会社名・屋号', '担当者名', 'メールアドレス', '電話番号',
  'ストア名', '代表者名義', '請求先 郵便番号', '請求先 住所',
  '返送先 郵便番号', '返送先 住所', '返送先 宛名', '返送先 電話番号',
  '依頼内容', '月間予定数', '単価', '初回問い合わせ日', '最終更新日', 'メモ', 'Square顧客ID'
];

const BOARD_CUSTOMER_COL = {
  id: 1, company: 2, name: 3, email: 4, tel: 5,
  storeName: 6, representative: 7, billZip: 8, billAddress: 9,
  returnZip: 10, returnAddress: 11, returnName: 12, returnTel: 13,
  detail: 14, monthly: 15, unitPrice: 16, firstAt: 17, updatedAt: 18, memo: 19, squareId: 20
};

/**
 * 見積もり回答（T1）でお伺いする項目と、顧客タブの列の対応。
 * お客様の返信からこの見出しを探して自動で書き込む。
 */
const BOARD_CUSTOMER_INTAKE = [
  { label: 'ストア名', col: 'storeName' },
  { label: '会社名', col: 'company' },
  { label: '代表者名義', col: 'representative' },
  { label: '請求先郵便番号', col: 'billZip' },
  { label: '請求先住所', col: 'billAddress' },
  { label: '返送先郵便番号', col: 'returnZip' },
  { label: '返送先住所', col: 'returnAddress' },
  { label: '返送先電話番号', col: 'returnTel' },
  { label: '宛名', col: 'returnName' }
];

const BOARD_MAIL_HEADERS = [
  '日時', '顧客ID', '差出人', '件名', '要約',
  'AI初回案', '修正指示ログ', '最終文面', '状態', 'GmailスレッドID', '下書き保存日時', '対応種別'
];

const BOARD_MAIL_COL = {
  date: 1, customerId: 2, from: 3, subject: 4, summary: 5,
  aiFirst: 6, instructions: 7, finalText: 8, status: 9, threadId: 10, savedAt: 11, responseType: 12
};

/**
 * 対応の種類。どの状況での回答かによって、案件ステータスの変化と
 * メール以外に必要な処理が変わる。
 */
const BOARD_RESPONSE_TYPES = [
  {
    id: 'REPLY', name: '通常の返信（AIが問い合わせ内容に応じて回答します）',
    template: '', status: '返信済', fields: [], invoice: false, requires: []
  },
  {
    id: 'T1', name: '見積もり回答（料金・納期の目安・ご利用条件をお伝えします）',
    template: 'T1', status: '返信済', fields: [], invoice: false, requires: []
  },
  {
    id: 'T2', name: '依頼確定（受付開始日・納期を回答し、依頼内容・支払い・発送に関する事項を伝えます）',
    template: 'T2', status: BOARD_STATUS_SIGNING,
    fields: ['startDate', 'dueFrom', 'dueTo', 'qty'], invoice: true,
    requires: ['startDate', 'dueFrom']
  },
  {
    id: 'T4', name: '手続き完了（支払いと署名の確認をお伝えし、発送をご案内します）',
    template: 'T4', status: '発送待ち', fields: ['signedAt'], invoice: false, requires: []
  },
  {
    id: 'T5', name: '手続きの催促（支払い・署名がお済みでない方へご確認をお願いします）',
    template: 'T5', status: '', fields: [], invoice: false, requires: []
  },
  {
    id: 'T6', name: '発送の催促（発送状況の確認と、追跡番号のご連絡をお願いします）',
    template: 'T6', status: '', fields: [], invoice: false, requires: []
  },
  {
    id: 'T7', name: 'お預かり完了（商品の到着と点数をお知らせし、納期の目安を再度お伝えします）',
    template: 'T7', status: '作業中', fields: ['qty'], invoice: false, requires: []
  }
];

/** 対応種別ごとに出す入力欄の定義。 */
const BOARD_CASE_FIELDS = {
  startDate: { label: '受付開始日', type: 'date', col: 'startDate' },
  dueFrom: { label: '納期予定（自）', type: 'date', col: 'dueFrom' },
  dueTo: { label: '納期予定（至）', type: 'date', col: 'dueTo' },
  qty: { label: '予定点数', type: 'number', col: 'qty' },
  signedAt: { label: '署名・支払確認日', type: 'date', col: 'signedAt' }
};

function boardFindResponseTypeByName_(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  for (let i = 0; i < BOARD_RESPONSE_TYPES.length; i++) {
    if (BOARD_RESPONSE_TYPES[i].name === key) return BOARD_RESPONSE_TYPES[i];
  }
  return null;
}

function boardFindResponseType_(id) {
  for (let i = 0; i < BOARD_RESPONSE_TYPES.length; i++) {
    if (BOARD_RESPONSE_TYPES[i].id === id) return BOARD_RESPONSE_TYPES[i];
  }
  return null;
}

const BOARD_SHEET_EXAMPLES = '返信実例';
const BOARD_EXAMPLE_HEADERS = ['日時', '顧客', '件名', 'AI初回案', '修正指示', '最終文面', '抽出した方針'];
/**
 * テンプレシートは縦横を入れ替えた構成。
 * 1列目が項目名、2列目以降が1通ずつのメールになり、横に並べて見比べられる。
 *
 *        A      B         C         D …
 *   1  項目    T1        T2        T4
 *   2  名称    見積…      案内…      手続…
 *   3  件名    【ササ…    【ササ…    【ササ…
 *   4  本文    （高さ500px固定）
 *   5  備考
 */
const BOARD_TEMPLATE_ROWS = ['項目', '名称', '件名', '本文', '備考'];
const BOARD_TEMPLATE_ROW = { id: 1, name: 2, subject: 3, body: 4, note: 5 };
const BOARD_TEMPLATE_BODY_HEIGHT = 500;
const BOARD_TEMPLATE_COL_WIDTH = 360;
const BOARD_KNOWLEDGE_HEADERS = ['分類', '内容', '更新日'];
const BOARD_SETTINGS_HEADERS = ['項目', '値', '説明'];
const BOARD_LOG_HEADERS = ['日時', '種別', '内容'];

/** Responses シートの見出し候補。列の位置ではなく見出し名で解決する。 */
const BOARD_SOURCE_FIELDS = {
  date: ['送信日時', 'タイムスタンプ'],
  company: ['会社名', '会社名・屋号', '貴社名 / 屋号名'],
  name: ['お名前', 'ご担当者名', '担当者名'],
  email: ['メールアドレス', 'メール'],
  tel: ['電話番号', 'お電話番号'],
  monthly: ['月間予定数', '月間の依頼予定数量'],
  detail: ['選択内容'],
  unitPrice: ['概算単価'],
  inquiry: ['お問い合わせ・ご要望']
};

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ササゲパス')
    .addItem('対応を選ぶ', 'mailOpenReviewPanel')
    .addItem('新着を今すぐ確認する', 'mailCheckNow')
    .addSeparator()
    .addSubMenu(ui.createMenu('別途対応メニュー')
      .addItem('受付開始日・納期・点数だけを入力する', 'boardOpenPanel')
      .addItem('初回登録の請求書だけを作成・送信する', 'squareOpenFlow'))
    .addSubMenu(ui.createMenu('設定')
      .addItem('動作状況を確認する', 'mailShowStatus')
      .addItem('初期セットアップ', 'boardSetup')
      .addSeparator()
      .addItem('Anthropic APIキーを登録する', 'mailSetApiKey')
      .addItem('新着メールの自動確認を開始する', 'mailStartAutoCheck')
      .addItem('新着メールの自動確認を停止する', 'mailStopAutoCheck')
      .addSeparator()
      .addItem('Squareトークンを登録する', 'squareSetToken')
      .addItem('過去の請求書の設定を読み取る', 'squareInspectTemplate')
      .addSeparator()
      .addItem('フォーム回答だけを取り込む', 'boardImportResponses')
      .addItem('顧客・案件を作り直す', 'boardRebuild'))
    .addToUi();
}

// ------------------------------------------------------------
// 初期セットアップ
// ------------------------------------------------------------

function boardSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  boardMigrateCases_(ss);
  boardMigrateCustomers_(ss);

  boardSetupSheet_(ss, BOARD_SHEET_CASES, BOARD_CASE_HEADERS, [90, 210, 150, 70, 95, 95, 95, 220]);
  boardSetupSheet_(ss, BOARD_SHEET_CUSTOMERS, BOARD_CUSTOMER_HEADERS, [80, 170, 120, 220, 130]);
  boardSetupSheet_(ss, BOARD_SHEET_MAILS, BOARD_MAIL_HEADERS, [140, 80, 200, 240, 240, 300, 260, 300, 110, 200, 140]);
  boardSetupSheet_(ss, BOARD_SHEET_EXAMPLES, BOARD_EXAMPLE_HEADERS, [140, 150, 240, 300, 260, 300, 320]);
  boardSetupTemplates_(ss);
  boardSetupSheet_(ss, BOARD_SHEET_KNOWLEDGE, BOARD_KNOWLEDGE_HEADERS, [140, 560, 100]);
  boardSetupSheet_(ss, BOARD_SHEET_SETTINGS, BOARD_SETTINGS_HEADERS, [220, 300, 340]);
  boardSetupSheet_(ss, BOARD_SHEET_LOGS, BOARD_LOG_HEADERS, [150, 100, 500]);

  boardApplyCaseFormatting_(ss.getSheetByName(BOARD_SHEET_CASES));
  boardMigrateSettings_(ss.getSheetByName(BOARD_SHEET_SETTINGS));
  boardSeedSettings_(ss.getSheetByName(BOARD_SHEET_SETTINGS));
  boardSeedKnowledge_(ss.getSheetByName(BOARD_SHEET_KNOWLEDGE));

  boardOrderSheets_(ss);
  boardHideSourceSheets_(ss);

  const repaired = boardMigrateMails_(ss);
  const imported = boardImportResponses_(ss);
  boardLog_('セットアップ', '初期セットアップを実行しました（取込 ' + imported + ' 件）');

  SpreadsheetApp.getUi().alert(
    'セットアップが完了しました。\n\n' +
    'フォーム回答の取り込み：' + imported + ' 件' +
    (repaired > 0 ? '\nメール履歴の列ずれを修復：' + repaired + ' 件' : '') +
    '\n\n「案件ボード」タブをご確認ください。'
  );
}

/** 旧レイアウトからの移行。列の増減を伴うため、見出し書き換えより先に実行する。 */
function boardMigrateCases_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastColumn() < 10) return;

  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });

  const invoiceUrl = headers.indexOf('請求書URL');
  if (invoiceUrl >= 0) {
    sheet.deleteColumn(invoiceUrl + 1);
    boardLog_('移行', '請求書URL 列を削除しました');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
  }

  const due = headers.indexOf('納期予定');
  if (due >= 0) {
    sheet.getRange(1, due + 1).setValue('納期予定（自）');
    sheet.insertColumnAfter(due + 1);
    sheet.getRange(1, due + 2).setValue('納期予定（至）');
    boardLog_('移行', '納期予定を（自）（至）の2列に分割しました');
  }

  headers = boardInsertColumnAfter_(sheet, headers, '請求書送付日', 'Square請求書ID');

  // 契約書は請求書の作成時にその場で添付するため、事前作成の記録は不要になった
  const contract = headers.indexOf('契約書作成日');
  if (contract >= 0) {
    sheet.deleteColumn(contract + 1);
    boardLog_('移行', '契約書作成日 列を削除しました');
  }

  boardRenameStatuses_(sheet);
}

/** after 列の直後に name 列が無ければ挿入する。挿入後の見出し配列を返す。 */
function boardInsertColumnAfter_(sheet, headers, after, name) {
  if (headers.indexOf(name) >= 0) return headers;
  const index = headers.indexOf(after);
  if (index < 0) return headers;
  sheet.insertColumnAfter(index + 1);
  sheet.getRange(1, index + 2).setValue(name);
  boardLog_('移行', name + ' 列を追加しました');
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
}

/**
 * 旧形式（9列）のメール履歴を現在の12列レイアウトへ並べ直す。
 *
 * 旧: 日時 / 顧客ID / 差出人 / 件名 / 種別 / 要約 / AI返信案 / 状態 / GmailスレッドID
 * 新: 日時 / 顧客ID / 差出人 / 件名 / 要約 / AI初回案 / 修正指示ログ / 最終文面 /
 *     状態 / GmailスレッドID / 下書き保存日時 / 対応種別
 *
 * 旧形式の行は「状態」の位置にスレッドIDが入り、「GmailスレッドID」が空になるため、
 * その形を手がかりに判定する。
 */
function boardMigrateMails_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const width = Math.max(sheet.getLastColumn(), BOARD_MAIL_HEADERS.length);
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, width);
  const rows = range.getValues();
  let fixed = 0;

  const next = rows.map(function (row) {
    const atStatus = String(row[8] || '').trim();
    const atThread = String(row[9] || '').trim();
    if (atThread || !/^[0-9a-f]{10,24}$/i.test(atStatus)) return row;

    const moved = new Array(width).fill('');
    moved[0] = row[0];
    moved[1] = row[1];
    moved[2] = row[2];
    moved[3] = row[3];
    moved[4] = row[5];          // 要約
    moved[5] = row[6];          // AI初回案
    moved[7] = row[6];          // 最終文面（作り直すまでは同じ内容）
    moved[8] = MAIL_STATUS_PENDING;
    moved[9] = atStatus;        // GmailスレッドID
    fixed++;
    return moved;
  });

  if (fixed > 0) {
    range.setValues(next);
    boardLog_('移行', 'メール履歴 ' + fixed + ' 件を新しい列構成に並べ直しました');
  }
  return fixed;
}

/** 顧客タブに Square顧客ID 列が無ければ追加する。 */
function boardMigrateCustomers_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastColumn() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  if (headers.join('\t') === BOARD_CUSTOMER_HEADERS.join('\t')) return;

  // 見出し名を手がかりに、列が増えても順番が変わっても値を引き継ぐ
  const index = {};
  headers.forEach(function (h, i) { if (h) index[h] = i; });

  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const moved = rows.map(function (row) {
    return BOARD_CUSTOMER_HEADERS.map(function (h) {
      return index[h] === undefined ? '' : row[index[h]];
    });
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, BOARD_CUSTOMER_HEADERS.length).setValues([BOARD_CUSTOMER_HEADERS]);
  if (moved.length > 0) {
    sheet.getRange(2, 1, moved.length, BOARD_CUSTOMER_HEADERS.length).setValues(moved);
  }
  boardLog_('移行', '顧客タブを新しい列構成に並べ直しました（' + moved.length + '件）');
}

/** 旧ステータス名を新名称へ置き換える。入力規則より先に実行する。 */
function boardRenameStatuses_(sheet) {
  if (sheet.getLastRow() < 2) return;
  const range = sheet.getRange(2, BOARD_COL.status, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let changed = 0;
  const next = values.map(function (row) {
    const name = String(row[0] || '').trim();
    if (BOARD_STATUS_RENAMES[name]) { changed++; return [BOARD_STATUS_RENAMES[name]]; }
    return [row[0]];
  });
  if (changed > 0) {
    range.setDataValidation(null);
    range.setValues(next);
    boardLog_('移行', 'ステータス名を ' + changed + ' 件更新しました');
  }
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
  const statusRange = sheet.getRange(2, BOARD_COL.status, maxRows, 1);
  statusRange.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(BOARD_STATUSES, true)
    .setAllowInvalid(false)
    .build());

  const rules = [];
  BOARD_STATUSES.forEach(function (status) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(BOARD_STATUS_COLORS[status])
      .setRanges([statusRange])
      .build());
  });

  const todoRange = sheet.getRange(2, BOARD_COL.todo, maxRows, 1);
  ['確認して返信', '日付を入れて', '経過'].forEach(function (word) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(word)
      .setFontColor('#A32D2D')
      .setRanges([todoRange])
      .build());
  });
  sheet.setConditionalFormatRules(rules);

  [BOARD_COL.startDate, BOARD_COL.dueFrom, BOARD_COL.dueTo, BOARD_COL.invoiceSent,
   BOARD_COL.signedAt, BOARD_COL.guideDraftAt, BOARD_COL.lastContact].forEach(function (col) {
    // 日付列のみ書式を揃える
    sheet.getRange(2, col, maxRows, 1).setNumberFormat('yyyy/mm/dd');
  });
}

function boardHideSourceSheets_(ss) {
  ['Config', BOARD_SOURCE_SHEET].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden() && ss.getSheets().length > 1) sheet.hideSheet();
  });
}

function boardOrderSheets_(ss) {
  const order = [BOARD_SHEET_CASES, BOARD_SHEET_CUSTOMERS, BOARD_SHEET_MAILS,
    BOARD_SHEET_TEMPLATES, BOARD_SHEET_KNOWLEDGE, BOARD_SHEET_EXAMPLES,
    BOARD_SHEET_SETTINGS, BOARD_SHEET_LOGS];
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

const BOARD_DEFAULT_SETTINGS = [
  ['通知先メールアドレス', 'sasagepass@gmail.com', '②の返信案ができたときの通知先'],
  ['送信元エイリアス', 'info@sasagepass.com', 'メール下書きの差出人。Gmailにエイリアス登録が必要'],
  ['営業所コード', '160652', '案内メールの発送先'],
  ['営業所名', '松原柴垣営業所', ''],
  ['発送先郵便番号', '580-0017', ''],
  ['発送先宛名', '合同会社ケセラセラ', ''],
  ['発送先TEL', '050-6870-8948', 'ヤマト送り状に記載する電話番号'],
  ['品名', '衣類', ''],
  ['署名待ちリマインド日数', 5, '支払い情報の登録・契約書署名が確認できないまま経過した日数'],
  ['発送待ちリマインド日数', 7, '追跡番号の連絡がないまま経過した日数'],
  ['返信案の自動チェック', 'オン', 'オフにすると定期チェックで返信案を作らない'],
  ['請求書送信の手順', boardDefaultInvoiceSteps_(), 'Square手続き画面に表示される手順。実際の操作に合わせて自由に書き換えてください']
];

function boardDefaultInvoiceSteps_() {
  return [
    '1. 下の［Squareで請求書を開く］を押します。',
    '2. 「編集」を開き、「添付ファイルとカスタムフィールド」を表示します。',
    '3. 「Square 契約書」→「新規の契約書」→「サービス利用規約」を選んで保存します。',
    '4. 内容を確認して請求書を送信します。',
    '5. この画面に戻って［送信しました］を押します。'
  ].join('\n');
}

/** 旧手順が既定値のまま残っている場合だけ、新しい手順に差し替える。 */
function boardMigrateSettings_(sheet) {
  if (sheet.getLastRow() < 2) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const key = String(rows[i][0] || '').trim();
    const value = String(rows[i][1] || '');
    if (key === '契約書作成の手順') {
      sheet.deleteRow(i + 2);
      boardLog_('移行', '設定「契約書作成の手順」を削除しました');
    } else if (key === '請求書送信の手順' && value.indexOf('既存の契約書') >= 0) {
      sheet.getRange(i + 2, 2).setValue(boardDefaultInvoiceSteps_());
      boardLog_('移行', '設定「請求書送信の手順」を更新しました');
    }
  }
}

/** 既存の値は上書きせず、未登録・空欄の項目だけを補う。 */
function boardSeedSettings_(sheet) {
  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (row, i) {
      if (row[0]) existing[String(row[0]).trim()] = { row: i + 2, value: row[1] };
    });
  }
  BOARD_DEFAULT_SETTINGS.forEach(function (item) {
    const hit = existing[item[0]];
    if (!hit) {
      sheet.appendRow(item);
    } else if (hit.value === '' || hit.value === null) {
      sheet.getRange(hit.row, 2).setValue(item[1]);
    }
  });
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

function boardSetupTemplates_(ss) {
  let sheet = ss.getSheetByName(BOARD_SHEET_TEMPLATES);
  if (!sheet) sheet = ss.insertSheet(BOARD_SHEET_TEMPLATES);

  boardMigrateTemplates_(sheet);

  sheet.getRange(1, 1, BOARD_TEMPLATE_ROWS.length, 1)
    .setValues(BOARD_TEMPLATE_ROWS.map(function (label) { return [label]; }))
    .setFontWeight('bold')
    .setBackground('#F1EFE8')
    .setVerticalAlignment('top');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 90);

  boardSeedTemplates_(sheet);
  boardMigrateTemplateNotes_(sheet);
  boardMigrateQuoteTemplate_(sheet);

  const last = sheet.getLastColumn();
  if (last > 1) {
    for (let c = 2; c <= last; c++) sheet.setColumnWidth(c, BOARD_TEMPLATE_COL_WIDTH);
    sheet.getRange(1, 2, BOARD_TEMPLATE_ROWS.length, last - 1)
      .setWrap(true)
      .setVerticalAlignment('top');
    sheet.getRange(1, 2, 1, last - 1).setFontWeight('bold');
  }
  sheet.setRowHeight(BOARD_TEMPLATE_ROW.body, BOARD_TEMPLATE_BODY_HEIGHT);
  return sheet;
}

/** 旧レイアウト（1行＝1テンプレート）を、縦横入れ替えた構成へ変換する。 */
function boardMigrateTemplates_(sheet) {
  if (String(sheet.getRange(1, 1).getValue() || '').trim() !== 'ID') return;

  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
      .filter(function (row) { return String(row[0] || '').trim(); })
    : [];

  sheet.clear();
  const values = BOARD_TEMPLATE_ROWS.map(function (label, index) {
    return [label].concat(rows.map(function (row) { return row[index]; }));
  });
  sheet.getRange(1, 1, values.length, rows.length + 1).setValues(values);
  boardLog_('移行', 'テンプレを縦横入れ替えた構成に変換しました（' + rows.length + '件）');
}

const BOARD_NOTE_ESTIMATE = '　※上記受付開始日に到着した際のおおよその目安です。';
const BOARD_NOTE_FIRST = '　※初回のみ、ストア情報登録のため、通常より大幅に納期をいただいております。';
const BOARD_NOTE_OLD = '※納期は商品到着後の状況により前後する場合がございます';

/**
 * すでに作成済みのテンプレートに、納期に関する注意書きを差し込む。
 * 既存の本文を尊重し、注意書きが無い場合だけ納期行の直後に追加する。
 */
function boardMigrateTemplateNotes_(sheet) {
  const last = sheet.getLastColumn();
  if (last < 2) return;

  const ids = sheet.getRange(BOARD_TEMPLATE_ROW.id, 1, 1, last).getValues()[0];
  let updated = 0;

  for (let c = 1; c < ids.length; c++) {
    const id = String(ids[c] || '').trim();
    if (id !== 'T2' && id !== 'T4') continue;

    const cell = sheet.getRange(BOARD_TEMPLATE_ROW.body, c + 1);
    const body = String(cell.getValue() || '');
    if (!body || body.indexOf('{{納期予定}}') < 0) continue;
    // 旧仕様の差し込み変数は、そのまま本文として読める文章に置き換える
    let lines = body.replace('{{初回注記}}', BOARD_NOTE_FIRST).split('\n');
    const hasEstimate = lines.some(function (l) { return l.indexOf(BOARD_NOTE_ESTIMATE.trim()) >= 0; });
    const hasFirst = lines.some(function (l) { return l.indexOf(BOARD_NOTE_FIRST.trim()) >= 0; });
    if (hasEstimate && hasFirst) {
      if (lines.join('\n') !== body) { cell.setValue(lines.join('\n')); updated++; }
      continue;
    }

    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('{{納期予定}}') >= 0) { index = i; break; }
    }
    if (index < 0) continue;

    const notes = [];
    if (!hasEstimate) notes.push(BOARD_NOTE_ESTIMATE);
    if (!hasFirst) notes.push(BOARD_NOTE_FIRST);

    const following = lines[index + 1] || '';
    const replaceCount = following.indexOf(BOARD_NOTE_OLD) >= 0 ? 1 : 0;
    lines.splice.apply(lines, [index + 1, replaceCount].concat(notes));

    cell.setValue(lines.join('\n'));
    updated++;
  }

  if (updated > 0) boardLog_('移行', 'テンプレ ' + updated + ' 件に納期の注意書きを追加しました');
}

/**
 * 既存の見積もり回答（T1）に、テスト点数の訂正と、伺いたい情報の枠を反映する。
 * 手を入れた箇所は残し、足りないものだけを補う。
 */
function boardMigrateQuoteTemplate_(sheet) {
  const last = sheet.getLastColumn();
  if (last < 2) return;

  const ids = sheet.getRange(BOARD_TEMPLATE_ROW.id, 1, 1, last).getValues()[0];
  for (let c = 1; c < ids.length; c++) {
    if (String(ids[c] || '').trim() !== 'T1') continue;

    const cell = sheet.getRange(BOARD_TEMPLATE_ROW.body, c + 1);
    let body = String(cell.getValue() || '');
    if (!body) return;
    const before = body;

    body = body.replace('・テストのご依頼は10点から承っております。', boardQuoteTestLine_());
    if (body.indexOf('■ ご依頼にあたって伺いたい情報') < 0) {
      body = body.replace(
        'ご不明な点やご希望条件のご相談がございましたら',
        boardQuoteIntakeBlock_() + '\n\nご不明な点やご希望条件のご相談がございましたら'
      );
      if (body.indexOf('■ ご依頼にあたって伺いたい情報') < 0) {
        body = body + '\n\n' + boardQuoteIntakeBlock_();
      }
    }
    body = body.replace(
      'ご依頼をご希望の場合は、その旨ご連絡いただけましたら、発送先・発送方法をご案内いたします。\n', ''
    );

    if (body !== before) {
      cell.setValue(body);
      boardLog_('移行', '見積もり回答テンプレを更新しました');
    }
    return;
  }
}

function boardSeedTemplates_(sheet) {
  const last = sheet.getLastColumn();
  const existing = {};
  if (last > 1) {
    sheet.getRange(BOARD_TEMPLATE_ROW.id, 2, 1, last - 1).getValues()[0].forEach(function (id) {
      if (id) existing[String(id).trim()] = true;
    });
  }

  const seeds = [
    ['T1', '見積もり回答', '【ササゲパス】お見積もりのご案内', boardDefaultQuoteBody_(), 'フォーム回答への初回返信'],
    ['T2', '案内メール（依頼確定時）', '【ササゲパス】ご依頼を承りました（発送先・スケジュールのご案内）', boardDefaultGuideBody_(), '受付開始日と納期予定（自）が未入力なら下書きを作成しない。予定点数が空なら該当行が自動で消える'],
    ['T4', '手続き完了のご連絡', '【ササゲパス】お手続きを確認いたしました', boardDefaultDoneBody_(), '署名・カード登録の確認後に送る'],
    ['T5', 'リマインド（手続き未完了）', '【ササゲパス】お手続きのご確認', boardDefaultRemindPaymentBody_(), '請求書を送ってから一定日数が経っても署名・支払いが確認できないとき'],
    ['T6', 'リマインド（追跡番号未着）', '【ササゲパス】ご発送状況のご確認', boardDefaultRemindShippingBody_(), '発送の連絡も荷物の到着もないとき'],
    ['T7', 'お預かり完了のご連絡', '【ササゲパス】商品をお預かりいたしました', boardDefaultReceivedBody_(), '商品が到着したとき'],
    ['S1', 'Square請求書（登録手数料220円）', SQUARE_INVOICE_TITLE, squareInvoiceDescription_(), '過去の請求書と同一の文面。Squareの請求書メッセージ欄に入る']
  ];
  let col = Math.max(sheet.getLastColumn(), 1);
  seeds.forEach(function (seed) {
    if (existing[seed[0]]) return;
    col++;
    sheet.getRange(1, col, BOARD_TEMPLATE_ROWS.length, 1)
      .setValues(seed.map(function (value) { return [value]; }));
  });
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
    '　ご依頼点数　：{{予定点数}}点',
    '　単　　　価　：{{単価}}／点',
    '　受付開始日　：{{受付開始日}}',
    '　納期の目安　：{{納期予定}}',
    '　※上記受付開始日に到着した際のおおよその目安です。',
    '　※初回のみ、ストア情報登録のため、通常より大幅に納期をいただいております。',
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

function boardDefaultQuoteBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'このたびは概算見積もりフォームよりお問い合わせいただき、誠にありがとうございます。',
    'いただいた内容をもとに、以下のとおりご案内いたします。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ お見積もり内容',
    '━━━━━━━━━━━━━━━━━━━━',
    '{{依頼内容}}',
    '　概算単価　{{単価}}／点',
    '',
    '※数量割引は月間50点以上のご依頼が対象です。',
    '　月間の点数が50点に満たない場合は、割引前の単価でのご案内となります。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ ご利用条件',
    '━━━━━━━━━━━━━━━━━━━━',
    '・初回契約料・基本料金はいただいておりません。ご依頼のない月に費用は発生しません。',
    boardQuoteTestLine_(),
    '・返送料は弊社負担です（弊社への発送時の送料はお客様負担となります）。',
    '・納期の目安：ご発送から返送まで1〜2週間程度',
    '　※点数や状況により前後いたします。ご依頼確定後にあらためてご案内いたします。',
    '',
    boardQuoteIntakeBlock_(),
    '',
    'ご不明な点やご希望条件のご相談がございましたら、お気軽にご返信ください。',
    '引き続きどうぞよろしくお願い申し上げます。'
  ].join('\n');
}

function boardQuoteTestLine_() {
  return '・テストのご依頼は、撮影のみの場合は10点以上、出品を含む場合は50点以上から承っております。';
}

/** ご依頼にあたって必ず伺う項目。返信からこの見出しを探して顧客タブへ取り込む。 */
function boardQuoteIntakeBlock_() {
  return [
    '━━━━━━━━━━━━━━━━━━━━',
    '■ ご依頼にあたって伺いたい情報',
    '━━━━━━━━━━━━━━━━━━━━',
    'ご依頼をご希望の場合、ご請求と商品の返送に必要となりますので、',
    '下記をこのメールへのご返信にてお知らせください。',
    '恐れ入りますが、下の枠内をコピーして、各項目の後ろにご記入ください。',
    '',
    '──────────────────',
    '・ストア名（予定でも可）：',
    '・会社名（個人事業主の方は個人名義）：',
    '・代表者名義：',
    '・請求先郵便番号：',
    '・請求先住所（都道府県から建物名まで正確に）：',
    '',
    '・返送先郵便番号：',
    '・返送先住所（都道府県から建物名まで正確に）：',
    '・返送先電話番号：',
    '・宛名：',
    '──────────────────',
    '',
    '※請求先と返送先が同じ場合は、返送先の欄に「請求先と同じ」とご記入いただければ結構です。'
  ].join('\n');
}

function boardDefaultRemindPaymentBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    '',
    '先日お送りしたご請求書について、',
    '決済情報のご登録と契約書へのご署名がまだ確認できておりません。',
    '',
    'お手続きが完了しませんと作業を開始できないため、',
    '恐れ入りますがご確認をお願いいたします。',
    'すでにお手続き済みの場合や、ご不明な点、',
    'ご都合が変わった場合などございましたら、本メールへのご返信にてお知らせください。',
    '',
    'どうぞよろしくお願い申し上げます。'
  ].join('\n');
}

function boardDefaultRemindShippingBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    '',
    'ご発送のご準備はいかがでしょうか。',
    'すでにご発送済みの場合は、本メールへのご返信にて、',
    '送り状のお問い合わせ番号またはお控えの写真をお送りください。',
    '',
    'まだの場合もお急ぎいただく必要はございませんので、',
    'ご都合のよいタイミングでご発送ください。',
    '',
    'どうぞよろしくお願い申し上げます。'
  ].join('\n');
}

function boardDefaultReceivedBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    '',
    '本日、商品を{{予定点数}}点お預かりいたしました。',
    '{{納期予定}}を目安に作業を進め、完了次第あらためてご連絡いたします。',
    '',
    'どうぞよろしくお願い申し上げます。'
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
    '　※上記受付開始日に到着した際のおおよその目安です。',
    '　※初回のみ、ストア情報登録のため、通常より大幅に納期をいただいております。',
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

function boardRebuild() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('顧客・案件を作り直す',
    '「案件ボード」と「顧客」の内容をすべて削除し、フォーム回答から作り直します。\n' +
    '手入力した受付開始日・納期予定・メモも消えます。よろしいですか？',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [BOARD_SHEET_CASES, BOARD_SHEET_CUSTOMERS].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getMaxColumns()).clear();
    }
  });
  const imported = boardImportResponses_(ss);
  boardLog_('作り直し', imported + ' 件を再取込しました');
  ui.alert(imported + ' 件を取り込み直しました。');
}

/** 見出し名 → 列番号（1始まり）。表記ゆれに備えて候補を順に探す。 */
function boardResolveSourceColumns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  const map = {};
  Object.keys(BOARD_SOURCE_FIELDS).forEach(function (key) {
    const candidates = BOARD_SOURCE_FIELDS[key];
    for (let i = 0; i < candidates.length; i++) {
      const index = headers.indexOf(candidates[i]);
      if (index >= 0) { map[key] = index; return; }
    }
    map[key] = -1;
  });
  return map;
}

function boardImportResponses_(ss) {
  const source = ss.getSheetByName(BOARD_SOURCE_SHEET);
  if (!source || source.getLastRow() < 2) return 0;

  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const customers = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!cases || !customers) return 0;

  const col = boardResolveSourceColumns_(source);
  if (col.email < 0) {
    throw new Error('Responses シートに「メールアドレス」の列が見つかりません。見出し行をご確認ください。');
  }

  const imported = {};
  if (cases.getLastRow() > 1) {
    cases.getRange(2, BOARD_COL.sourceRow, cases.getLastRow() - 1, 1).getValues().forEach(function (row) {
      if (row[0]) imported[String(row[0])] = true;
    });
  }

  const rows = source.getRange(2, 1, source.getLastRow() - 1, source.getLastColumn()).getValues();
  let added = 0;

  for (let i = 0; i < rows.length; i++) {
    const sourceRow = i + 2;
    if (imported[String(sourceRow)]) continue;

    const r = rows[i];
    const pick = function (key) { return col[key] >= 0 ? r[col[key]] : ''; };
    const email = String(pick('email') || '').trim();
    if (!boardIsEmail_(email)) continue;

    const company = String(pick('company') || '').trim();
    const name = String(pick('name') || '').trim();
    const detail = String(pick('detail') || '').trim();

    const customerId = boardUpsertCustomer_(customers, {
      company: company,
      name: name,
      email: email,
      tel: String(pick('tel') || '').trim(),
      detail: detail,
      monthly: pick('monthly'),
      unitPrice: pick('unitPrice'),
      date: pick('date')
    });

    const caseRow = cases.getLastRow() + 1;
    const values = new Array(BOARD_CASE_HEADERS.length).fill('');
    values[BOARD_COL.caseId - 1] = 'A' + boardPad_(caseRow - 1, 3);
    values[BOARD_COL.status - 1] = '問合せ';
    values[BOARD_COL.customer - 1] = company || name;
    values[BOARD_COL.customerId - 1] = customerId;
    values[BOARD_COL.detail - 1] = detail;
    values[BOARD_COL.unitPrice - 1] = pick('unitPrice');
    values[BOARD_COL.lastContact - 1] = pick('date');
    values[BOARD_COL.sourceRow - 1] = sourceRow;

    cases.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).setValues([values]);
    boardSetTodoFormula_(cases, caseRow);

    // フォームに回答があった時点で「対応を選ぶ」の一覧にも載せる。
    // お客様からメールが届くまで待っていると、初回の返信が漏れるため。
    mailAppendHistory_(ss, {
      customerId: customerId,
      from: email,
      subject: 'フォームからのお問い合わせ',
      summary: boardFormatInquiry_(pick, detail),
      aiFirst: '',
      finalText: '',
      status: '未確認',
      threadId: ''
    });
    added++;
  }

  if (added > 0) boardLog_('取込', added + ' 件の回答を取り込みました');
  return added;
}

/** フォーム回答の内容を、確認画面に出すための文章にまとめる。 */
function boardFormatInquiry_(pick, detail) {
  const inquiry = String(pick('inquiry') || '').trim();
  const monthly = String(pick('monthly') || '').trim();
  const unitPrice = String(pick('unitPrice') || '').trim();
  return [
    '見積もりフォームに回答がありました。',
    '',
    '【お問い合わせ内容・ご要望】',
    inquiry || '（記入なし）',
    '',
    '【選択された内容】',
    detail || '（なし）',
    monthly ? '月間予定数: ' + monthly : '',
    unitPrice ? '概算単価: ' + unitPrice : ''
  ].filter(function (line, i) { return line !== '' || i < 8; }).join('\n');
}

function boardUpsertCustomer_(sheet, data) {
  const existing = boardFindCustomerRowByEmail_(sheet, data.email);
  if (existing) {
    sheet.getRange(existing, BOARD_CUSTOMER_COL.updatedAt).setValue(new Date());
    if (data.detail) sheet.getRange(existing, BOARD_CUSTOMER_COL.detail).setValue(data.detail);
    return sheet.getRange(existing, BOARD_CUSTOMER_COL.id).getValue();
  }

  const row = sheet.getLastRow() + 1;
  const customerId = 'C' + boardPad_(row - 1, 3);
  const values = new Array(BOARD_CUSTOMER_HEADERS.length).fill('');
  values[BOARD_CUSTOMER_COL.id - 1] = customerId;
  values[BOARD_CUSTOMER_COL.company - 1] = data.company;
  values[BOARD_CUSTOMER_COL.name - 1] = data.name;
  values[BOARD_CUSTOMER_COL.email - 1] = data.email;
  values[BOARD_CUSTOMER_COL.tel - 1] = data.tel;
  values[BOARD_CUSTOMER_COL.detail - 1] = data.detail;
  values[BOARD_CUSTOMER_COL.monthly - 1] = data.monthly;
  values[BOARD_CUSTOMER_COL.unitPrice - 1] = data.unitPrice;
  values[BOARD_CUSTOMER_COL.firstAt - 1] = data.date;
  values[BOARD_CUSTOMER_COL.updatedAt - 1] = new Date();

  sheet.getRange(row, 1, 1, BOARD_CUSTOMER_HEADERS.length).setValues([values]);
  return customerId;
}

/**
 * お客様の返信本文から、T1でお伺いした項目を抜き出す。
 * 「・ストア名（予定でも可）：〇〇」のように、見出しと値が同じ行にある形を想定する。
 * 引用された空欄のテンプレートは値が無いため、自然に無視される。
 */
function boardExtractCustomerIntake_(text) {
  const found = {};
  String(text || '').split('\n').forEach(function (raw) {
    const line = raw.replace(/^[\s>＞・･]+/, '').trim();
    const match = line.match(/^([^：:]+)[：:]\s*(.*)$/);
    if (!match) return;

    const label = match[1].replace(/[（(].*?[)）]/g, '').replace(/\s/g, '').trim();
    const value = match[2].trim();
    if (!value) return;

    BOARD_CUSTOMER_INTAKE.forEach(function (item) {
      if (item.label === label) found[item.col] = value;
    });
  });
  return found;
}

/** 抜き出した内容を顧客タブへ書き込む。値が入っている項目だけを更新する。 */
function boardApplyCustomerIntake_(ss, email, values) {
  const keys = Object.keys(values);
  if (keys.length === 0) return 0;

  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  const row = sheet ? boardFindCustomerRowByEmail_(sheet, email) : 0;
  if (!row) return 0;

  const changed = [];
  keys.forEach(function (key) {
    const col = BOARD_CUSTOMER_COL[key];
    if (!col) return;
    const cell = sheet.getRange(row, col);
    if (String(cell.getValue() || '').trim() === values[key]) return;
    cell.setValue(values[key]);
    changed.push(BOARD_CUSTOMER_HEADERS[col - 1]);
  });

  if (changed.length > 0) {
    sheet.getRange(row, BOARD_CUSTOMER_COL.updatedAt).setValue(new Date());
    boardLog_('顧客情報', email + ' の ' + changed.join('・') + ' を更新しました');
  }
  return changed.length;
}

function boardFindCustomerRowByEmail_(sheet, email) {
  const last = sheet.getLastRow();
  if (last < 2 || !email) return 0;
  const emails = sheet.getRange(2, BOARD_CUSTOMER_COL.email, last - 1, 1).getValues();
  for (let i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase()) return i + 2;
  }
  return 0;
}

function boardSetTodoFormula_(sheet, row) {
  const cell = function (col) { return '$' + boardColLetter_(col) + row; };
  const b = cell(BOARD_COL.status);
  const start = cell(BOARD_COL.startDate);
  const from = cell(BOARD_COL.dueFrom);
  const to = cell(BOARD_COL.dueTo);
  const draft = cell(BOARD_COL.guideDraftAt);
  const dueEnd = 'IF(' + to + '="",' + from + ',' + to + ')';
  const elapsed = '" ("&TEXT(TODAY()-' + draft + ',"0")&"日経過)"';
  const formula = '=IF(' + cell(BOARD_COL.caseId) + '="","",IFS(' +
    b + '="問合せ","返信案を確認して返信",' +
    b + '="返信済","お客様の返信待ち",' +
    b + '="依頼確定",IF(OR(' + start + '="",' + from + '=""),"日付を入れて案内メール","案内メールを送る"),' +
    b + '="' + BOARD_STATUS_SIGNING + '","支払い情報の登録・署名待ち"&IF(' + draft + '="","",' + elapsed + '),' +
    b + '="発送待ち","追跡番号の連絡待ち",' +
    b + '="作業中","作業"&IF(' + from + '="","","（納期 "&TEXT(' + dueEnd + ',"m/d")&"）"),' +
    'TRUE,""))';
  sheet.getRange(row, BOARD_COL.todo).setFormula(formula);
}

function boardColLetter_(col) {
  let s = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function boardPad_(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function boardIsEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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
  if (row < 2 || !sheet.getRange(row, BOARD_COL.caseId).getValue()) {
    SpreadsheetApp.getUi().alert('案件の行を選んでから実行してください。');
    return;
  }
  PropertiesService.getUserProperties().setProperty('BOARD_ACTIVE_ROW', String(row));
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createTemplateFromFile('Board').evaluate().setTitle('案件の詳細')
  );
}

function boardGetActiveCase() {
  const row = Number(PropertiesService.getUserProperties().getProperty('BOARD_ACTIVE_ROW') || 0);
  if (!row) throw new Error('案件が選択されていません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  const customer = boardFindCustomer_(ss, v[BOARD_COL.customerId - 1]);
  return {
    row: row,
    caseId: v[BOARD_COL.caseId - 1],
    status: v[BOARD_COL.status - 1],
    customer: v[BOARD_COL.customer - 1],
    qty: v[BOARD_COL.qty - 1],
    startDate: boardToInputDate_(v[BOARD_COL.startDate - 1]),
    dueFrom: boardToInputDate_(v[BOARD_COL.dueFrom - 1]),
    dueTo: boardToInputDate_(v[BOARD_COL.dueTo - 1]),
    todo: v[BOARD_COL.todo - 1],
    customerId: v[BOARD_COL.customerId - 1],
    detail: v[BOARD_COL.detail - 1],
    unitPrice: v[BOARD_COL.unitPrice - 1],
    email: customer ? customer.email : '',
    emailValid: customer ? boardIsEmail_(customer.email) : false
  };
}

function boardSaveCase(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(data.row);
  sheet.getRange(row, BOARD_COL.qty).setValue(data.qty === '' ? '' : Number(data.qty));
  sheet.getRange(row, BOARD_COL.startDate).setValue(boardFromInputDate_(data.startDate));
  sheet.getRange(row, BOARD_COL.dueFrom).setValue(boardFromInputDate_(data.dueFrom));
  sheet.getRange(row, BOARD_COL.dueTo).setValue(boardFromInputDate_(data.dueTo));
  boardSetTodoFormula_(sheet, row);
  boardLog_('保存', data.caseId + ' を更新しました');
  return boardGetActiveCase();
}

/**
 * 案件の情報でテンプレートの変数を埋めた件名と本文を返す。
 * 予定点数が空欄のときは、その行ごと削除する（点数が空のまま送られないようにするため）。
 */
function boardBuildTemplateText_(ss, caseRow, templateId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = sheet.getRange(Number(caseRow), 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  const customerId = v[BOARD_COL.customerId - 1];
  const customer = boardFindCustomer_(ss, customerId);
  if (!customer) throw new Error('顧客 ' + customerId + ' が「顧客」タブに見つかりません。');

  const tpl = boardFindTemplate_(ss, templateId);
  if (!tpl) throw new Error('テンプレ ' + templateId + ' が見つかりません。「テンプレ」タブをご確認ください。');

  const settings = boardGetSettings_(ss);
  const qty = v[BOARD_COL.qty - 1];
  const vars = {
    '会社名': customer.company,
    '担当者名': customer.name,
    '依頼内容': v[BOARD_COL.detail - 1],
    '予定点数': qty,
    '単価': v[BOARD_COL.unitPrice - 1],
    '受付開始日': boardFormatDate_(v[BOARD_COL.startDate - 1]),
    '納期予定': boardFormatDateRange_(v[BOARD_COL.dueFrom - 1], v[BOARD_COL.dueTo - 1]),
    '営業所コード': settings['営業所コード'],
    '営業所名': settings['営業所名'],
    '発送先郵便番号': settings['発送先郵便番号'],
    '発送先宛名': settings['発送先宛名'],
    '発送先TEL': settings['発送先TEL'],
    '品名': settings['品名']
  };

  let body = String(tpl.body || '');
  if (qty === '' || qty === null || qty === undefined) {
    body = boardDropLinesWith_(body, '{{予定点数}}');
  }

  return {
    subject: boardFill_(tpl.subject, vars),
    body: boardFill_(body, vars),
    customer: customer,
    values: v
  };
}

/** 顧客IDに紐づく最新の案件の行番号。完了・失注は除く。 */
function boardFindLatestCaseRow_(ss, customerId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2 || !customerId) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  let found = 0;
  rows.forEach(function (row, i) {
    if (String(row[BOARD_COL.customerId - 1]).trim() !== String(customerId).trim()) return;
    const status = String(row[BOARD_COL.status - 1] || '').trim();
    if (status === '返送済' || status === '見送り') return;
    found = i + 2;
  });
  return found;
}

function boardCreateGuideDraft(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(data.row);

  boardSaveCase(data);

  const v = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  if (!v[BOARD_COL.startDate - 1] || !v[BOARD_COL.dueFrom - 1]) {
    throw new Error('受付開始日と納期予定（自）を入力してください。');
  }

  const customerId = v[BOARD_COL.customerId - 1];
  const customer = boardFindCustomer_(ss, customerId);
  if (!customer) {
    throw new Error('顧客 ' + customerId + ' が「顧客」タブに見つかりません。');
  }
  if (!boardIsEmail_(customer.email)) {
    throw new Error('顧客 ' + customerId + ' のメールアドレスが正しくありません。\n現在の値：「' +
      (customer.email || '空欄') + '」\n「顧客」タブのD列を修正してください。');
  }

  const built = boardBuildTemplateText_(ss, row, 'T2');
  const subject = built.subject;
  const body = built.body;
  const settings = boardGetSettings_(ss);
  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  GmailApp.createDraft(customer.email, subject, body, options);

  sheet.getRange(row, BOARD_COL.guideDraftAt).setValue(new Date());
  if (!sheet.getRange(row, BOARD_COL.invoiceSent).getValue()) {
    sheet.getRange(row, BOARD_COL.invoiceSent).setValue(new Date());
  }
  sheet.getRange(row, BOARD_COL.status).setValue(BOARD_STATUS_SIGNING);
  boardSetTodoFormula_(sheet, row);
  boardLog_('下書き作成', v[BOARD_COL.caseId - 1] + ' の案内メール下書きを作成しました');

  return { message: 'Gmailの下書きを作成しました。内容を確認して送信してください。', to: customer.email };
}

// ------------------------------------------------------------
// ヘルパー
// ------------------------------------------------------------

function boardFindCustomer_(ss, customerId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastRow() < 2 || !customerId) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][BOARD_CUSTOMER_COL.id - 1]).trim() === String(customerId).trim()) {
      return {
        row: i + 2,
        company: rows[i][BOARD_CUSTOMER_COL.company - 1],
        name: rows[i][BOARD_CUSTOMER_COL.name - 1],
        email: String(rows[i][BOARD_CUSTOMER_COL.email - 1] || '').trim(),
        tel: rows[i][BOARD_CUSTOMER_COL.tel - 1],
        squareId: String(rows[i][BOARD_CUSTOMER_COL.squareId - 1] || '').trim()
      };
    }
  }
  return null;
}

function boardFindTemplate_(ss, id) {
  const sheet = ss.getSheetByName(BOARD_SHEET_TEMPLATES);
  if (!sheet || sheet.getLastColumn() < 2) return null;
  const ids = sheet.getRange(BOARD_TEMPLATE_ROW.id, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let c = 1; c < ids.length; c++) {
    if (String(ids[c] || '').trim() !== id) continue;
    const column = sheet.getRange(1, c + 1, BOARD_TEMPLATE_ROWS.length, 1).getValues();
    return {
      subject: String(column[BOARD_TEMPLATE_ROW.subject - 1][0] || ''),
      body: String(column[BOARD_TEMPLATE_ROW.body - 1][0] || '')
    };
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

function boardDropLinesWith_(text, needle) {
  return String(text || '').split('\n').filter(function (line) {
    return line.indexOf(needle) < 0;
  }).join('\n');
}

function boardFormatDateRange_(from, to) {
  if (!from) return '';
  if (!to) return boardFormatDate_(from);
  return boardFormatDate_(from) + ' 〜 ' + boardFormatDate_(to);
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
