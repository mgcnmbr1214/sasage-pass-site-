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

const BOARD_STATUS_SHIPPED = '発送済み';

const BOARD_STATUS_SHORT = '情報不足';
const BOARD_STATUS_READY = '依頼確定前';
const BOARD_STATUS_CLOSED = '見送り';

const BOARD_STATUS_DONE = '返送済';

const BOARD_STATUSES = ['問合せ', '返信済', BOARD_STATUS_SHORT, BOARD_STATUS_READY, '依頼確定', BOARD_STATUS_SIGNING, '発送待ち', BOARD_STATUS_SHIPPED, '作業中', BOARD_STATUS_DONE, BOARD_STATUS_CLOSED];

/** 終わった案件。「対応を選ぶ」にも出さず、未返信も数えない。 */
const BOARD_FINISHED_STATUSES = [BOARD_STATUS_DONE, BOARD_STATUS_CLOSED];

/** そのステータスで次に動くのは誰か。案件ボードの「対応者」列に出す。 */
const BOARD_STATUS_OWNER = {
  '問合せ': '自分',
  '返信済': 'お客様',
  '情報不足': '自分',
  '依頼確定前': '自分',
  '依頼確定': '自分',
  '支払い情報登録・契約書署名待ち': 'お客様',
  '発送待ち': 'お客様',
  '発送済み': '自分',
  '作業中': '自分',
  '返送済': '完了',
  '見送り': '完了'
};

/** 旧名称 → 新名称。セットアップ時に既存の値を書き換える。 */
const BOARD_STATUS_RENAMES = { '手続き待ち': BOARD_STATUS_SIGNING };

/** 案件ボードの列。順序を変えたら docs/シート設計.md も更新すること。 */
const BOARD_CASE_HEADERS = [
  '案件ID', 'ステータス', '対応者', 'お客様', '予定点数', '初回ご依頼予定数', '初回ご依頼予定日', '受付開始日', '納期予定（自）', '納期予定（至）', '次にやること',
  '未返信',
  '顧客ID', '依頼内容', 'フォームの問い合わせ内容', '最新の受信メール', '最新の送信メール', '単価',
  '請求書送付日', 'Square請求書ID', '署名・支払確認日',
  '追跡番号', '作業チーム共有', '案内メール作成日', '最終連絡日', 'メモ', '元回答行'
];

const BOARD_COL = {
  caseId: 1, status: 2, owner: 3, customer: 4, qty: 5, firstQty: 6, firstDate: 7,
  startDate: 8, dueFrom: 9, dueTo: 10, todo: 11,
  unreplied: 12,
  customerId: 13, detail: 14, formInquiry: 15, lastInbound: 16, lastOutbound: 17, unitPrice: 18,
  invoiceSent: 19, invoiceId: 20, signedAt: 21,
  tracking: 22, teamNote: 23, guideDraftAt: 24, lastContact: 25, memo: 26, sourceRow: 27
};

/** 折りたたみグループにまとめる列。並びが変わっても、隣り合っている範囲ごとにまとめる。 */
const BOARD_DETAIL_COLS = [
  'firstQty', 'firstDate', 'customerId', 'detail', 'formInquiry', 'unitPrice',
  'invoiceSent', 'invoiceId', 'signedAt', 'teamNote', 'guideDraftAt', 'lastContact', 'memo', 'sourceRow'
];

/** 案件ボードに載せる問い合わせ内容の最大文字数。全文はメール履歴で見る。 */
const BOARD_INQUIRY_MAX = 400;

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

/** 見積もり回答で伺う項目のうち、案件ごとに保管するもの。 */
const BOARD_CASE_INTAKE = [
  { label: '初回ご依頼予定数', col: 'firstQty' },
  { label: '初回ご依頼予定日', col: 'firstDate' }
];

/** 取り込みで探す見出しの一覧。コロンを付け忘れた行を拾うときに使う。 */
const BOARD_INTAKE_LABELS = (function () {
  const set = {};
  BOARD_CUSTOMER_INTAKE.concat(BOARD_CASE_INTAKE).forEach(function (item) { set[item.label] = true; });
  return set;
})();

const BOARD_MAIL_HEADERS = [
  '日時', '顧客ID', 'お客様', '差出人', '件名', '受信本文',
  'AI初回案', '修正指示ログ', '返信文面', '状態', 'GmailスレッドID', '下書き保存日時', '対応種別', '下書きID',
  'GmailメッセージID'
];

/** メール履歴の旧見出し → 新見出し。中身は動かさず、名前だけ付け替える。 */
const BOARD_MAIL_RENAMES = { '要約': '受信本文', '最終文面': '返信文面' };

/** メール履歴で普段は畳んでおく列。文面そのものは畳まない。 */
const BOARD_MAIL_DETAIL_COLS = ['aiFirst', 'instructions', 'threadId', 'savedAt', 'draftId', 'messageId'];

const BOARD_MAIL_COL = {
  date: 1, customerId: 2, customerName: 3, from: 4, subject: 5, summary: 6,
  aiFirst: 7, instructions: 8, finalText: 9, status: 10,
  threadId: 11, savedAt: 12, responseType: 13, draftId: 14, messageId: 15
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
    requires: ['startDate', 'dueFrom'],
    stamp: 'guideDraftAt'
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
  },
  {
    id: 'T8', name: '作業完了・データ納品（納品リンクを共有し、返送とデータ保管についてお伝えします）',
    template: 'T8', status: '', fields: [], invoice: false, requires: []
  }
];

/**
 * 差し込みでは埋められず、人が書くしかない箇所の目印。
 * 残ったまま下書きにしようとすると止める。
 */
const BOARD_TEMPLATE_PLACEHOLDER = /【ここに[^】]*】/;

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
  inquiry: ['問い合わせ内容', 'お問い合わせ・ご要望', 'お問い合わせ内容・補足', 'ご要望', '備考']
};

/**
 * メール履歴の「状態」を手で変えたら、案件ボードの未返信をすぐ合わせる。
 *
 * インストール型のトリガーから呼ぶ（`boardEnsureEditTrigger_`）。
 * 簡易トリガーの `onEdit` は権限が限られていて静かに失敗することがあるため、使わない。
 */
function boardOnEditInstalled_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== BOARD_SHEET_MAILS) return;
  if (e.range.getRow() < 2) return;

  const first = e.range.getColumn();
  const last = first + e.range.getNumColumns() - 1;
  if (BOARD_MAIL_COL.status < first || BOARD_MAIL_COL.status > last) return;

  boardRefreshUnreplied_(SpreadsheetApp.getActiveSpreadsheet());
}

/** 編集を検知するトリガーを1つだけ用意する。 */
function boardEnsureEditTrigger_(ss) {
  let found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() !== 'boardOnEditInstalled_') return;
    if (found) { ScriptApp.deleteTrigger(trigger); return; }
    found = true;
  });
  if (found) return;
  ScriptApp.newTrigger('boardOnEditInstalled_').forSpreadsheet(ss).onEdit().create();
  boardLog_('セットアップ', 'メール履歴の編集を検知するトリガーを登録しました');
}

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
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  boardMigrateCases_(ss);
  boardMigrateCustomers_(ss);
  // 移行で列が動いている可能性があるため、必ず読み直してから先へ進む
  boardSyncColumns_(ss.getSheetByName(BOARD_SHEET_CASES));

  boardSetupSheet_(ss, BOARD_SHEET_CASES, BOARD_CASE_HEADERS);
  boardSetupSheet_(ss, BOARD_SHEET_CUSTOMERS, BOARD_CUSTOMER_HEADERS, [80, 170, 120, 220, 130]);
  boardSetupSheet_(ss, BOARD_SHEET_MAILS, BOARD_MAIL_HEADERS);
  boardSetupSheet_(ss, BOARD_SHEET_EXAMPLES, BOARD_EXAMPLE_HEADERS, [140, 150, 240, 300, 260, 300, 320]);
  boardSetupTemplates_(ss);
  boardSetupSheet_(ss, BOARD_SHEET_KNOWLEDGE, BOARD_KNOWLEDGE_HEADERS, [140, 560, 100]);
  boardSetupSheet_(ss, BOARD_SHEET_SETTINGS, BOARD_SETTINGS_HEADERS, [220, 300, 340]);
  boardSetupSheet_(ss, BOARD_SHEET_LOGS, BOARD_LOG_HEADERS, [150, 100, 500]);

  boardApplyCaseFormatting_(ss.getSheetByName(BOARD_SHEET_CASES));
  boardRefreshFormulas_(ss.getSheetByName(BOARD_SHEET_CASES));
  boardMigrateSettings_(ss.getSheetByName(BOARD_SHEET_SETTINGS));
  boardSeedSettings_(ss.getSheetByName(BOARD_SHEET_SETTINGS));
  boardSeedKnowledge_(ss.getSheetByName(BOARD_SHEET_KNOWLEDGE));

  boardOrderSheets_(ss);
  boardHideSourceSheets_(ss);
  try {
    boardEnsureEditTrigger_(ss);
  } catch (err) {
    boardLog_('②エラー', '編集トリガーの登録に失敗: ' + err.message);
  }

  const brokenFixed = boardRepairBrokenCases_(ss);
  const deduped = boardDedupeCases_(ss);
  const repaired = boardMigrateMails_(ss);
  const mailDeduped = boardDedupeMails_(ss);
  const imported = boardImportResponses_(ss);
  let backfilled = 0;
  try {
    backfilled = boardBackfillMonthlyToDetail_(ss);
  } catch (err) {
    boardLog_('②エラー', '月間予定数の追記に失敗: ' + err.message);
  }
  try {
    boardRefreshCustomerNotes_(ss);
  } catch (err) {
    boardLog_('②エラー', 'お客様欄のメモ更新に失敗: ' + err.message);
  }
  try {
    boardBackfillGuideDate_(ss);
  } catch (err) {
    boardLog_('②エラー', '案内メール作成日の補完に失敗: ' + err.message);
  }

  try {
    // 読み取りの条件を直しても、記録済みのメールには反映されない。ここで見直す。
    // **ステータスの見直しより先に行う。** 顧客情報が埋まる前に判定すると、
    // 情報がそろっているのに「情報不足」のまま残る
    boardBackfillIntake_(ss);
  } catch (err) {
    boardLog_('②エラー', '顧客情報の補完に失敗: ' + err.message);
  }

  let restated = 0;
  try {
    restated = boardReevaluateStatuses_(ss);
  } catch (err) {
    boardLog_('②エラー', 'ステータスの見直しに失敗: ' + err.message);
  }
  try {
    // 送った下書きを見つけて状態を進め、返信文面の食い違いも直す
    mailRefreshSentStatus_(ss);
    mailSyncSentReplies_(ss);
  } catch (err) {
    boardLog_('②エラー', '返信文面の照合に失敗: ' + err.message);
  }
  try {
    // 行の増減がすべて終わったあとに実行する
    boardApplyMailFormatting_(ss.getSheetByName(BOARD_SHEET_MAILS));
  } catch (err) {
    boardLog_('②エラー', 'メール履歴の整形に失敗: ' + err.message);
  }
  boardLog_('セットアップ', '初期セットアップを実行しました（取込 ' + imported + ' 件）');

  SpreadsheetApp.getUi().alert(
    'セットアップが完了しました。\n\n' +
    'フォーム回答の取り込み：' + imported + ' 件' +
    (brokenFixed > 0 ? '\n列がずれた案件を削除：' + brokenFixed + ' 件' : '') +
    (deduped > 0 ? '\n重複した案件を削除：' + deduped + ' 件' : '') +
    (repaired > 0 ? '\nメール履歴の列ずれを修復：' + repaired + ' 件' : '') +
    (mailDeduped > 0 ? '\n重複したメール履歴を削除：' + mailDeduped + ' 件' : '') +
    (backfilled > 0 ? '\n依頼内容へ月間予定数を追記：' + backfilled + ' 件' : '') +
    (restated > 0 ? '\nステータスの見直し：' + restated + ' 件' : '') +
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

  headers = boardInsertColumnAfter_(sheet, headers, 'ステータス', '対応者');
  headers = boardInsertColumnAfter_(sheet, headers, '次にやること', '未返信');

  // 対応不要はメール履歴側へ移した
  const dismiss = headers.indexOf('対応不要');
  if (dismiss >= 0) {
    sheet.deleteColumn(dismiss + 1);
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    boardLog_('移行', '案件ボードの 対応不要 列を削除しました（メール履歴へ移動）');
  }
  headers = boardInsertColumnAfter_(sheet, headers, '予定点数', '初回ご依頼予定数');
  headers = boardInsertColumnAfter_(sheet, headers, '初回ご依頼予定数', '初回ご依頼予定日');
  headers = boardRenameColumn_(sheet, headers, '最新のお問い合わせ内容', 'フォームの問い合わせ内容');
  headers = boardRenameColumn_(sheet, headers, '最新のメール内容', '最新の受信メール');
  headers = boardInsertColumnAfter_(sheet, headers, '依頼内容', 'フォームの問い合わせ内容');
  headers = boardInsertColumnAfter_(sheet, headers, 'フォームの問い合わせ内容', '最新の受信メール');
  headers = boardInsertColumnAfter_(sheet, headers, '最新の受信メール', '最新の送信メール');
  headers = boardInsertColumnAfter_(sheet, headers, '請求書送付日', 'Square請求書ID');
  headers = boardInsertColumnAfter_(sheet, headers, '追跡番号', '作業チーム共有');

  // 契約書は請求書の作成時にその場で添付するため、事前作成の記録は不要になった
  const contract = headers.indexOf('契約書作成日');
  if (contract >= 0) {
    sheet.deleteColumn(contract + 1);
    boardLog_('移行', '契約書作成日 列を削除しました');
  }

  boardRenameStatuses_(sheet);

  // 列を足し引きしたので、BOARD_COL を実際の並びに引き直す。
  // これを忘れると、以降の処理がすべて1列ずれた場所を読み書きする
  boardSyncColumns_(sheet);
}

/** 見出しの名前を変える。変更後の見出し配列を返す。 */
function boardRenameColumn_(sheet, headers, from, to) {
  const index = headers.indexOf(from);
  if (index < 0 || headers.indexOf(to) >= 0) return headers;
  sheet.getRange(1, index + 1).setValue(to);
  boardLog_('移行', from + ' を ' + to + ' に変更しました');
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
}

/** after 列の直後に name 列が無ければ挿入する。挿入後の見出し配列を返す。 */
function boardInsertColumnAfter_(sheet, headers, after, name) {
  if (headers.indexOf(name) >= 0) return headers;
  const index = headers.indexOf(after);
  if (index < 0) return headers;
  sheet.insertColumnAfter(index + 1);
  // 挿入した列は左隣の書式と入力規則を引き継ぐため、規則だけ外す
  sheet.getRange(1, index + 2, sheet.getMaxRows(), 1).setDataValidation(null);
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

  const current = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); })
    : [];
  const sameOrder = current.slice(0, headers.length).join('\t') === headers.join('\t');
  // 見出しが揃っていれば並び順は尊重する。手で並べ替えたものを戻さないため
  const sameSet = headers.every(function (h) { return current.indexOf(h) >= 0; });

  if (!sameSet) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
    .setFontWeight('bold')
    .setBackground('#F1EFE8')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  // 幅は位置で決まるため、既定の並びのときだけ適用する
  if (widths && (sameOrder || !sameSet)) {
    for (let i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  }
  return sheet;
}

/** 長文が入る列。折り返さず1行に収めて、一覧を見やすく保つ。 */
const BOARD_CLIPPED_COLS = ['detail', 'formInquiry', 'lastInbound', 'lastOutbound', 'teamNote', 'memo'];
const BOARD_ROW_HEIGHT = 50;

/** 「未返信」列に並べるリンクの数。これを超えた分は「+3」のようにまとめる。 */
const BOARD_UNREPLIED_MAX_LINKS = 4;
const BOARD_UNREPLIED_SEPARATOR = ' ・ ';

/** 列の幅。並べ替えても効くよう、位置ではなく列の意味で指定する。 */
const BOARD_CASE_WIDTHS = {
  caseId: 80, status: 190, owner: 70, customer: 150, qty: 70, firstQty: 100, firstDate: 95,
  startDate: 95, dueFrom: 95, dueTo: 95, todo: 230, unreplied: 130,
  customerId: 70, detail: 160, formInquiry: 160, lastInbound: 200, lastOutbound: 200, unitPrice: 70,
  invoiceSent: 95, invoiceId: 110, signedAt: 95,
  tracking: 130, teamNote: 160, guideDraftAt: 95, lastContact: 95, memo: 160, sourceRow: 70
};

function boardApplyCaseFormatting_(sheet) {
  if (sheet.getFrozenColumns() === 0) sheet.setFrozenColumns(4);

  Object.keys(BOARD_CASE_WIDTHS).forEach(function (key) {
    sheet.setColumnWidth(BOARD_COL[key], BOARD_CASE_WIDTHS[key]);
  });

  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  // 入力規則はステータス列だけに付ける。列の挿入で他の列へ広がることがあるため一度全部外す
  sheet.getRange(2, 1, maxRows, sheet.getMaxColumns()).setDataValidation(null);
  const statusRange = sheet.getRange(2, BOARD_COL.status, maxRows, 1);
  statusRange.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(BOARD_STATUSES, true)
    .setAllowInvalid(false)
    .build());

  // 未返信のある案件は行ごと薄く色を付ける。ステータスと対応者には色を付けない
  const rules = [];
  const width = Math.max(sheet.getLastColumn(), BOARD_CASE_HEADERS.length);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + boardColLetter_(BOARD_COL.unreplied) + '2<>""')
    .setBackground('#FDF3E3')
    .setRanges([sheet.getRange(2, 1, maxRows, width)])
    .build());

  const todoRange = sheet.getRange(2, BOARD_COL.todo, maxRows, 1);
  ['確認して返信', '日付を入れて', '経過', '作業チームへ共有', '不足している情報', '依頼確定メール'].forEach(function (word) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(word)
      .setFontColor('#A32D2D')
      .setRanges([todoRange])
      .build());
  });
  sheet.getRange(2, BOARD_COL.owner, maxRows, 1)
    .setHorizontalAlignment('center').setBackground(null).setFontColor(null);
  sheet.getRange(2, BOARD_COL.status, maxRows, 1).setBackground(null).setFontColor(null);

  sheet.getRange(2, BOARD_COL.unreplied, maxRows, 1).setHorizontalAlignment('center');

  sheet.setConditionalFormatRules(rules);

  [BOARD_COL.startDate, BOARD_COL.dueFrom, BOARD_COL.dueTo, BOARD_COL.invoiceSent,
   BOARD_COL.signedAt, BOARD_COL.guideDraftAt, BOARD_COL.lastContact].forEach(function (col) {
    // 日付列のみ書式を揃える
    sheet.getRange(2, col, maxRows, 1).setNumberFormat('yyyy/mm/dd');
  });

  // 問い合わせ内容は折り返して読めるようにする
  // 長文の列は折り返さない。折り返すと1行が数十行分の高さになり一覧にならない
  BOARD_CLIPPED_COLS.forEach(function (key) {
    sheet.getRange(2, BOARD_COL[key], maxRows, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setVerticalAlignment('middle');
  });

  // setRowHeights は「データに合わせる」の指定を解除しない。
  // Forced のほうを使わないと、自動調整の行だけ中身に合わせて伸びたままになる
  boardForceRowHeight_(sheet, 2, Math.max(sheet.getMaxRows() - 1, 1));

  boardRefreshUnreplied_(sheet.getParent());

  boardApplyGroups_(sheet, BOARD_DETAIL_COLS.map(function (key) { return BOARD_COL[key]; }));
  boardApplyCaseFilter_(sheet);
}

/** メール履歴の幅。確認に使う列を広く、内部用の列を狭く。 */
const BOARD_MAIL_WIDTHS = {
  date: 130, customerId: 70, customerName: 150, from: 200, subject: 230, summary: 400,
  finalText: 400, status: 110, responseType: 200,
  aiFirst: 160, instructions: 160,
  threadId: 120, savedAt: 120, draftId: 120, messageId: 120
};

/**
 * メール履歴を読みやすい形に整える。
 *
 * 並べ替えはしない。届いた順（＝日時順）に下へ足していく。
 * お客様ごとに見たいときは、見出しの絞り込みから手で並べ替える。
 */
function boardApplyMailFormatting_(sheet) {
  if (!sheet) return;
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);

  Object.keys(BOARD_MAIL_WIDTHS).forEach(function (key) {
    sheet.setColumnWidth(BOARD_MAIL_COL[key], BOARD_MAIL_WIDTHS[key]);
  });

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(BOARD_MAIL_COL.customerName);

  // 長文の列は折り返さない。行の高さを揃えて一覧として読めるようにする
  ['summary', 'aiFirst', 'instructions', 'finalText', 'responseType'].forEach(function (key) {
    sheet.getRange(2, BOARD_MAIL_COL[key], maxRows, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setVerticalAlignment('middle');
  });
  sheet.getRange(2, 1, maxRows, sheet.getLastColumn()).setVerticalAlignment('middle');
  sheet.getRange(2, BOARD_MAIL_COL.date, maxRows, 1).setNumberFormat('yyyy/mm/dd HH:mm');
  sheet.getRange(2, BOARD_MAIL_COL.customerId, maxRows, 1).setHorizontalAlignment('center');
  boardForceRowHeight_(sheet, 2, maxRows);

  const dataRows = Math.max(sheet.getLastRow() - 1, 0);
  if (dataRows > 0) {
    boardMigrateMailStatuses_(sheet);
    boardBackfillMailDates_(sheet);
    boardStampMailBodies_(sheet);
    for (let row = 2; row <= sheet.getLastRow(); row++) boardSetMailCustomerFormula_(sheet, row);

    // 状態は決まった言葉だけにする。意味は入力時の説明で出す
    sheet.getRange(2, BOARD_MAIL_COL.status, maxRows, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(MAIL_STATUSES, true)
        .setHelpText(MAIL_STATUS_HELP)
        .setAllowInvalid(false)
        .build());

  }

  // 対応中のメールは背景を付けて、案件ボードの色と対応させる
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR(' + MAIL_OPEN_STATUSES.map(function (s) {
        return '$' + boardColLetter_(BOARD_MAIL_COL.status) + '2="' + s + '"';
      }).join(',') + ')')
      .setBackground('#FDF3E3')
      .setRanges([sheet.getRange(2, 1, maxRows, Math.max(sheet.getLastColumn(), BOARD_MAIL_HEADERS.length))])
      .build()
  ]);

  boardApplyGroups_(sheet, BOARD_MAIL_DETAIL_COLS.map(function (key) { return BOARD_MAIL_COL[key]; }));

  if (sheet.getLastRow() > 1) {
    const existing = sheet.getFilter();
    if (existing) existing.remove();
    sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).createFilter();
  }
}

/** 「お客様」列。顧客IDから会社名（無ければ担当者名）を引く。 */
function boardSetMailCustomerFormula_(sheet, row) {
  const id = '$' + boardColLetter_(BOARD_MAIL_COL.customerId) + row;
  const table = "'" + BOARD_SHEET_CUSTOMERS + "'!$"
    + boardColLetter_(BOARD_CUSTOMER_COL.id) + ':$' + boardColLetter_(BOARD_CUSTOMER_COL.name);
  const lookup = function (col) {
    return 'IFERROR(VLOOKUP(' + id + ',' + table + ',' + col + ',FALSE),"")';
  };
  sheet.getRange(row, BOARD_MAIL_COL.customerName).setFormula(
    '=IF(' + id + '="","",LET(c,' + lookup(BOARD_CUSTOMER_COL.company) +
    ',IF(c<>"",c,' + lookup(BOARD_CUSTOMER_COL.name) + ')))'
  );
}

/**
 * 日時を「記録した時刻」から「メールが届いた日時」に直す。
 * 同じスレッドに複数のメールがあるとき、どれがどれか見分けるための手がかりになる。
 */
function boardBackfillMailDates_(sheet) {
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  let fixed = 0;

  rows.forEach(function (row, i) {
    const messageId = String(row[BOARD_MAIL_COL.messageId - 1] || '').trim();
    if (!messageId) return;
    try {
      const message = GmailApp.getMessageById(messageId);
      if (!message) return;
      const when = message.getDate();
      const now = row[BOARD_MAIL_COL.date - 1];
      if (now instanceof Date && Math.abs(now.getTime() - when.getTime()) < 60000) return;
      sheet.getRange(i + 2, BOARD_MAIL_COL.date).setValue(when);
      fixed++;
    } catch (err) {
      // 消されたメールなどは記録した時刻のままにしておく
    }
  });

  if (fixed > 0) boardLog_('移行', 'メール履歴の日時 ' + fixed + ' 件を受信日時に直しました');
}

/**
 * 受信本文と返信文面の先頭に日時を付ける。
 * 受信本文は受信日時、返信文面は下書きを保存した日時（無ければ受信日時）。
 */
function boardStampMailBodies_(sheet) {
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const received = [];
  const replied = [];
  let stamped = 0;

  rows.forEach(function (row) {
    const at = row[BOARD_MAIL_COL.date - 1];
    const savedAt = row[BOARD_MAIL_COL.savedAt - 1];
    const before = [row[BOARD_MAIL_COL.summary - 1], row[BOARD_MAIL_COL.finalText - 1]];
    const after = [
      mailStamp_(at, before[0]),
      mailStamp_(savedAt instanceof Date ? savedAt : at, before[1])
    ];
    if (after[0] !== String(before[0] || '') || after[1] !== String(before[1] || '')) stamped++;
    received.push([after[0]]);
    replied.push([after[1]]);
  });

  if (stamped === 0) return;
  sheet.getRange(2, BOARD_MAIL_COL.summary, received.length, 1).setValues(received);
  sheet.getRange(2, BOARD_MAIL_COL.finalText, replied.length, 1).setValues(replied);
  boardLog_('移行', 'メール履歴 ' + stamped + ' 件の本文に日時を付けました');
}

/** 状態の言い回しを新しいものに揃える。 */
function boardMigrateMailStatuses_(sheet) {
  const range = sheet.getRange(2, BOARD_MAIL_COL.status, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let changed = 0;
  const next = values.map(function (row) {
    const now = String(row[0] || '').trim();
    if (!MAIL_STATUS_RENAMES[now]) return row;
    changed++;
    return [MAIL_STATUS_RENAMES[now]];
  });
  if (changed === 0) return;
  range.setDataValidation(null).setValues(next);
  boardLog_('移行', 'メール履歴の状態 ' + changed + ' 件を新しい言い方に直しました');
}

/**
 * 詳細列を折りたたみグループにまとめる。
 *
 * グループは位置でしか作れないため、いま隣り合っている詳細列の範囲ごとに作る。
 * 列を並べ替えたあとに初期セットアップを実行すれば、新しい並びで作り直される。
 */
function boardApplyGroups_(sheet, columns) {
  const width = sheet.getLastColumn();

  // 前回のグループを一度ほどく。深さが残っていると入れ子になっていく
  for (let i = 0; i < 3; i++) {
    try {
      sheet.getRange(1, 1, 1, width).shiftColumnGroupDepth(-1);
    } catch (err) {
      break;
    }
  }

  const detail = {};
  columns.forEach(function (col) { detail[col] = true; });

  let start = 0;
  for (let col = 1; col <= width + 1; col++) {
    if (detail[col]) {
      if (!start) start = col;
      continue;
    }
    if (start && col - start >= 2) {
      try {
        sheet.getRange(1, start, 1, col - start).shiftColumnGroupDepth(1);
        sheet.getColumnGroup(start, 1).collapse();
      } catch (err) {
        boardLog_('表示', '列のグループ化に失敗: ' + err.message);
      }
    }
    start = 0;
  }
}

/** 行の高さを固定する。自動調整が効いている行も含めて揃える。 */
function boardForceRowHeight_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  try {
    sheet.setRowHeightsForced(startRow, numRows, BOARD_ROW_HEIGHT);
  } catch (err) {
    // 古い実行環境向けの控え。自動調整は解除できない
    sheet.setRowHeights(startRow, numRows, BOARD_ROW_HEIGHT);
  }
}

/** 見出し行に絞り込みを付ける。ステータス順や担当順に並べ替えて見られるようにする。 */
function boardApplyCaseFilter_(sheet) {
  if (sheet.getLastRow() < 2) return;
  try {
    const existing = sheet.getFilter();
    if (existing) existing.remove();
    sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).createFilter();
  } catch (err) {
    boardLog_('表示', '絞り込みを付けられませんでした: ' + err.message);
  }
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

/**
 * 設定シートに残す「記録」。切り替えるための値ではなく、読むためのもの。
 * 項目名を（記録）で始めてあり、初期セットアップで灰色にして設定と見分ける。
 */
const BOARD_SETTING_NOTE_PREFIX = '（記録）';
const BOARD_SETTING_NOTES = [
  [BOARD_SETTING_NOTE_PREFIX + '案件が作られる条件',
   'Responses に未取込の行があり、メールアドレスが妥当なとき',
   'フォーム回答1件＝案件1件。同じお客様が2回答えれば案件は2件になる。'
   + '取り込み済みかどうかは案件ボードの「元回答行」列で判断するため、何度実行しても重複しない。'],
  [BOARD_SETTING_NOTE_PREFIX + '取り込み元① 見積もりフォーム',
   'https://sites.google.com/view/sasagepass-estimate/概算見積もり',
   '選択内容・月間予定数・概算単価まで埋まる。このスプレッドシートのスクリプト（gas/mitsumori-form）が '
   + 'Responses タブへ追記する。'],
  [BOARD_SETTING_NOTE_PREFIX + '取り込み元② お問い合わせフォーム',
   'https://sasagepass.com/ の最下部',
   '案件ボードの「依頼内容」が「お問い合わせフォームより：〇〇」で始まる。点数と単価は空になる。'
   + '別プロジェクト（gas/contact-form）が同じ Responses タブへ追記する。'],
  [BOARD_SETTING_NOTE_PREFIX + '案件が作られない経路',
   'メール受信・対応を選ぶ・Squareの操作・顧客タブへの手入力',
   'いずれも案件は増えない。新着メールの読み取りは顧客タブに登録済みのアドレスしか見ないため、'
   + '未登録の相手から届いたメールは検知もしない。']
];

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
  ['新着メールの読み取り', 'オン', 'オフにすると定期チェックで新着メールを読み取らない'],
  ['手続き完了の自動送信', 'オン', '支払いと署名の確認後、テンプレT4をお客様へ自動送信する。オフで停止'],
  ['請求書送信の手順', boardDefaultInvoiceSteps_(), 'Square手続き画面に表示される手順。実際の操作に合わせて自由に書き換えてください']
].concat(BOARD_SETTING_NOTES);

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
    } else if (key === '返信案の自動チェック') {
      // 検知の時点では返信案を作らなくなったため、実態に合う名前に変える。オン/オフの値はそのまま
      sheet.getRange(i + 2, 1).setValue('新着メールの読み取り');
      sheet.getRange(i + 2, 3).setValue('オフにすると定期チェックで新着メールを読み取らない');
      boardLog_('移行', '設定「返信案の自動チェック」を「新着メールの読み取り」に変更しました');
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
    const note = item[0].indexOf(BOARD_SETTING_NOTE_PREFIX) === 0;
    const hit = existing[item[0]];
    if (!hit) {
      sheet.appendRow(item);
    } else if (note) {
      // 記録は切り替えるための値ではないので、常に最新の内容にしておく
      sheet.getRange(hit.row, 2, 1, 2).setValues([[item[1], item[2]]]);
    } else if (hit.value === '' || hit.value === null) {
      sheet.getRange(hit.row, 2).setValue(item[1]);
    }
  });
  boardStyleSettingNotes_(sheet);
}

/** 記録の行は灰色にして、切り替える設定と見分けられるようにする。 */
function boardStyleSettingNotes_(sheet) {
  if (sheet.getLastRow() < 2) return;
  const rows = sheet.getLastRow() - 1;
  const names = sheet.getRange(2, 1, rows, 1).getValues();

  names.forEach(function (row, i) {
    const note = String(row[0] || '').indexOf(BOARD_SETTING_NOTE_PREFIX) === 0;
    sheet.getRange(i + 2, 1, 1, BOARD_SETTINGS_HEADERS.length)
      .setBackground(note ? '#F1EFE8' : null)
      .setFontColor(note ? '#5F5E5A' : null);
  });
  sheet.getRange(2, 1, rows, BOARD_SETTINGS_HEADERS.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setVerticalAlignment('top');
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
    ['T8', '作業完了・データ納品のご連絡', '【ササゲパス】作業が完了いたしました（データ納品のご案内）', boardDefaultDeliveryBody_(), '作業が完了し、納品データを共有するとき。**納品URLは手入力**。入れないと下書きにできない'],
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

function boardDefaultDeliveryBody_() {
  return [
    '{{会社名}}',
    '{{担当者名}} 様',
    '',
    'お世話になっております。ササゲパス運営事務局です。',
    '',
    'お待たせいたしました。ご依頼いただきました作業が完了いたしました。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ 納品データ',
    '━━━━━━━━━━━━━━━━━━━━',
    '下記のリンクよりご確認ください。',
    '',
    '　【ここに納品データのURLを貼ってください】',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ 商品の返送について',
    '━━━━━━━━━━━━━━━━━━━━',
    '・初回のご依頼につきましては、納品データにご依頼内容との齟齬がないかを',
    '　ご確認いただき、ご返信をいただいてから返送を開始いたします。',
    '　お手数をおかけいたしますが、必ずご確認のうえご返信をお願いいたします。',
    '',
    '・2回目以降は、少しでも早くお手元にお戻しできるよう、',
    '　データの納品と同時に返送を開始いたします。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '■ データの保管期間について',
    '━━━━━━━━━━━━━━━━━━━━',
    '出品を伴わないご依頼の場合、共有ドライブでの保管期間は',
    '納品から1か月間とさせていただいております。',
    '期間内にお客様のお手元へも保存いただきますようお願いいたします。',
    '',
    '仕上がりについてのご要望がございましたら、いつでもご相談ください。',
    '',
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
  boardUseCurrentColumns_();
  const count = boardImportResponses_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(count > 0 ? count + ' 件の新しい回答を取り込みました。' : '新しい回答はありませんでした。');
}

function boardRebuild() {
  boardUseCurrentColumns_();
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
  try {
    boardRefreshCustomerNotes_(ss);
  } catch (err) {
    boardLog_('②エラー', 'お客様欄のメモ更新に失敗: ' + err.message);
  }
  boardLog_('作り直し', imported + ' 件を再取込しました');
  ui.alert(imported + ' 件を取り込み直しました。');
}

/** 見出し名 → 列番号（1始まり）。表記ゆれに備えて候補を順に探す。 */
function boardResolveSourceColumns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  // 「お問い合わせ内容」と「問い合わせ内容」のような表記ゆれを吸収する
  const norm = headers.map(boardNormalizeHeader_);
  const map = {};
  Object.keys(BOARD_SOURCE_FIELDS).forEach(function (key) {
    const candidates = BOARD_SOURCE_FIELDS[key];
    for (let i = 0; i < candidates.length; i++) {
      const exact = headers.indexOf(candidates[i]);
      if (exact >= 0) { map[key] = exact; return; }
    }
    for (let i = 0; i < candidates.length; i++) {
      const want = boardNormalizeHeader_(candidates[i]);
      for (let c = 0; c < norm.length; c++) {
        if (!norm[c]) continue;
        if (norm[c] === want || norm[c].indexOf(want) >= 0 || want.indexOf(norm[c]) >= 0) {
          map[key] = c;
          return;
        }
      }
    }
    map[key] = -1;
  });
  return map;
}

/** 見出しの表記ゆれを揃える。丁寧語の接頭辞と記号・空白を落とす。 */
function boardNormalizeHeader_(text) {
  return String(text || '').trim()
    .replace(/[\s　・･、,／\/（）()]/g, '')
    .replace(/^[おご]/, '');
}

/**
 * 列がずれた状態で作られてしまった案件を取り除く。
 *
 * 列構成が古いまま取り込みが走ると、値が本来と違う列に入る。
 * その行は顧客とも結びつかず機能しないため、案件IDはあるのに
 * 顧客IDの列が顧客IDの形をしていない行を壊れた行とみなす。
 */
function boardRepairBrokenCases_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const width = Math.max(sheet.getLastColumn(), BOARD_CASE_HEADERS.length);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const broken = [];

  rows.forEach(function (row, i) {
    const caseId = String(row[BOARD_COL.caseId - 1] || '').trim();
    if (!caseId) return;
    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (/^C\d+$/.test(customerId)) return;
    broken.push({ row: i + 2, caseId: caseId });
  });

  // 全部または大半が「壊れている」と出たときは、壊れているのは判定のほう。
  // 列の位置を取り違えたまま消すと、案件が丸ごと失われる
  if (broken.length > 0 && broken.length >= Math.ceil(rows.length / 2)) {
    boardLog_('整理', '案件 ' + broken.length + '/' + rows.length +
      ' 件が壊れていると判定されたため、削除を中止しました。列の構成を確認してください');
    return 0;
  }

  broken.slice().reverse().forEach(function (item) { sheet.deleteRow(item.row); });

  // ずれた値が右側の余った列に残っていれば取り除く。
  // ただし見出しの付いた列は消さない。並べ替えで右端に来ただけの本来の列を失うため
  for (let col = sheet.getLastColumn(); col > BOARD_CASE_HEADERS.length; col--) {
    if (String(sheet.getRange(1, col).getValue() || '').trim()) continue;
    sheet.deleteColumn(col);
  }

  if (broken.length > 0) {
    boardLog_('整理', '列がずれた案件 ' + broken.length + ' 件を削除しました（' +
      broken.map(function (b) { return b.caseId; }).join('、') + '）');
  }
  return broken.length;
}

/** 作業がどこまで進んだか。重複したメール履歴のうち、どれを残すかの判断に使う。 */
function boardMailProgress_(status) {
  // 読み込み時ではなく呼ばれた時に組み立てる。
  // トップレベルで他のファイルの定数を参照すると、読み込み順によっては
  // スクリプト全体が起動に失敗し、メニューごと出なくなる
  const order = [MAIL_STATUS_SKIP, MAIL_STATUS_PENDING, MAIL_STATUS_SENT];
  const index = order.indexOf(String(status || '').trim());
  return index < 0 ? 0 : index + 1;
}

/**
 * 重複したメール履歴を1件にまとめる。
 *
 * 案件が重複して取り込まれた際に、メール履歴の行も一緒に増えてしまった。
 * 同じお客様・同じ件名で、返信先のスレッドも同じものを重複とみなし、
 * いちばん作業が進んでいる行だけを残す。
 */
function boardDedupeMails_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 3) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  const best = {};
  const remove = [];

  const score = function (row) {
    const status = String(row[BOARD_MAIL_COL.status - 1] || '').trim();
    let value = boardMailProgress_(status);
    if (String(row[BOARD_MAIL_COL.finalText - 1] || '').trim()) value += 10;
    if (String(row[BOARD_MAIL_COL.instructions - 1] || '').trim()) value += 5;
    if (String(row[BOARD_MAIL_COL.responseType - 1] || '').trim()) value += 5;
    return value;
  };

  rows.forEach(function (row, i) {
    // メール1通ずつが1行なので、同じ通かどうかはメッセージIDで見る。
    // 顧客・件名・スレッドで見ると、同じスレッドに届いた別のメールまで
    // 重複とみなして消してしまい、次の新着チェックで作り直される堂々巡りになる
    const messageId = String(row[BOARD_MAIL_COL.messageId - 1] || '').trim();
    const key = messageId ? 'M\t' + messageId : [
      'K',
      String(row[BOARD_MAIL_COL.customerId - 1] || '').trim(),
      String(row[BOARD_MAIL_COL.subject - 1] || '').trim(),
      String(row[BOARD_MAIL_COL.threadId - 1] || '').trim()
    ].join('\t');
    if (key === 'K\t\t\t') return;

    const current = { row: i + 2, score: score(row) };
    const kept = best[key];
    if (!kept) { best[key] = current; return; }

    // 進み具合が同じなら、あとから作られた行を残す
    if (current.score >= kept.score) { remove.push(kept.row); best[key] = current; }
    else remove.push(current.row);
  });

  remove.sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });
  if (remove.length > 0) boardLog_('整理', '重複したメール履歴 ' + remove.length + ' 件を削除しました');
  return remove.length;
}

/** 手入力された値が入っている列。重複を消してよいかの判断に使う。 */
const BOARD_MANUAL_COLS = ['startDate', 'dueFrom', 'dueTo', 'qty', 'signedAt',
  'invoiceId', 'invoiceSent', 'tracking', 'teamNote', 'memo'];

/**
 * 同じフォーム回答から作られた案件が重複していたら取り除く。
 * 手で入力した値が残っている行は消さず、ログに出して判断を委ねる。
 */
function boardDedupeCases_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 3) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const seen = {};
  const removable = [];
  const kept = [];

  rows.forEach(function (row, i) {
    const source = String(row[BOARD_COL.sourceRow - 1] || '').trim();
    if (!source) return;
    if (!seen[source]) { seen[source] = true; return; }

    const hasManual = BOARD_MANUAL_COLS.some(function (key) {
      return String(row[BOARD_COL[key] - 1] || '').trim();
    });
    if (hasManual) kept.push(row[BOARD_COL.caseId - 1]);
    else removable.push(i + 2);
  });

  removable.sort(function (a, b) { return b - a; }).forEach(function (row) { sheet.deleteRow(row); });

  if (removable.length > 0) boardLog_('整理', '重複した案件 ' + removable.length + ' 件を削除しました');
  if (kept.length > 0) {
    boardLog_('整理', '重複しているが入力済みのため残した案件: ' + kept.join('、') + '（手動でご確認ください）');
  }
  return removable.length;
}

/**
 * 案件ボードの列構成が最新かどうかを確かめ、古ければ移行する。
 *
 * コードは列を番号で読み書きするため、シートが古い並びのまま処理すると
 * 別の列を読んでしまう。実際、取込済みの目印である「元回答行」を読み損ねて
 * 同じ回答を何度も取り込んでしまう不具合が起きた。
 */
function boardEnsureLayout_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet) return false;

  // 必要な見出しがすべて揃っていれば、並び順は自由でよい
  if (boardSyncColumns_(sheet)) return true;

  boardLog_('移行', '案件ボードの列構成が古いため移行します');
  boardMigrateCases_(ss);
  boardMigrateCustomers_(ss);
  if (boardSyncColumns_(sheet)) return true;

  sheet.getRange(1, 1, 1, BOARD_CASE_HEADERS.length).setValues([BOARD_CASE_HEADERS]);
  const ok = boardSyncColumns_(sheet);
  if (!ok) boardLog_('移行', '列構成を合わせられませんでした。初期セットアップを実行してください');
  return ok;
}

/** 既定の並び順から「見出し名 → 設定キー」の対応を作る。 */
const BOARD_COL_KEY_BY_HEADER = (function () {
  const map = {};
  Object.keys(BOARD_COL).forEach(function (key) {
    map[BOARD_CASE_HEADERS[BOARD_COL[key] - 1]] = key;
  });
  return map;
})();

/**
 * シートの見出しを読み、列番号の対応を実際の並びに合わせる。
 *
 * これにより、案件ボードの列を手で並べ替えても動く。
 * 見出しが1つでも欠けていれば false を返し、移行処理に任せる。
 */
function boardSyncColumns_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });

  const found = {};
  BOARD_CASE_HEADERS.forEach(function (name) {
    const index = headers.indexOf(name);
    if (index >= 0) found[BOARD_COL_KEY_BY_HEADER[name]] = index + 1;
  });

  if (Object.keys(found).length !== BOARD_CASE_HEADERS.length) return false;
  Object.keys(found).forEach(function (key) { BOARD_COL[key] = found[key]; });
  return true;
}

function boardImportResponses_(ss) {
  if (!boardEnsureLayout_(ss)) return 0;

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
    const monthly = boardMonthlyLabel_(pick('monthly'));
    values[BOARD_COL.detail - 1] = monthly
      ? (detail ? detail + '\n月間予定数：' + monthly : '月間予定数：' + monthly)
      : detail;
    values[BOARD_COL.formInquiry - 1] = boardTrimInquiry_(pick('inquiry'));
    values[BOARD_COL.unitPrice - 1] = pick('unitPrice');
    values[BOARD_COL.lastContact - 1] = pick('date');
    values[BOARD_COL.sourceRow - 1] = sourceRow;

    cases.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).setValues([values]);
    boardSetTodoFormula_(cases, caseRow);
    boardSetOwnerFormula_(cases, caseRow);
    boardForceRowHeight_(cases, caseRow, 1);

    // フォームに回答があった時点で「対応を選ぶ」の一覧にも載せる。
    // お客様からメールが届くまで待っていると、初回の返信が漏れるため。
    mailAppendHistory_(ss, {
      customerId: customerId,
      from: email,
      subject: 'フォームからのお問い合わせ',
      summary: boardFormatInquiry_(pick, detail),
      aiFirst: '',
      finalText: '',
      status: MAIL_STATUS_PENDING,
      threadId: ''
    });
    added++;
  }

  added += boardBackfillInquiryMails_(ss, source, col);
  if (added > 0) boardLog_('取込', added + ' 件の回答を取り込みました');
  return added;
}

/**
 * 「問合せ」のまま対応リストに載っていない案件を拾い直す。
 * フォーム回答を対応リストへ載せる前に取り込んだ案件が、
 * 一覧に出てこないままになるのを防ぐ。
 */
function boardBackfillInquiryMails_(ss, source, col) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const mails = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!cases || !mails || cases.getLastRow() < 2) return 0;

  const listed = {};
  if (mails.getLastRow() > 1) {
    mails.getRange(2, 1, mails.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues()
      .forEach(function (row) {
        const id = String(row[BOARD_MAIL_COL.customerId - 1] || '').trim();
        if (id) listed[id] = true;
      });
  }

  const rows = cases.getRange(2, 1, cases.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  let added = 0;

  rows.forEach(function (row) {
    if (String(row[BOARD_COL.status - 1] || '').trim() !== '問合せ') return;
    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (!customerId || listed[customerId]) return;

    const customer = boardFindCustomer_(ss, customerId);
    if (!customer || !boardIsEmail_(customer.email)) return;

    const sourceRow = Number(row[BOARD_COL.sourceRow - 1] || 0);
    let summary = '見積もりフォームに回答がありました。';
    if (sourceRow >= 2 && sourceRow <= source.getLastRow()) {
      const values = source.getRange(sourceRow, 1, 1, source.getLastColumn()).getValues()[0];
      const pick = function (key) { return col[key] >= 0 ? values[col[key]] : ''; };
      summary = boardFormatInquiry_(pick, String(pick('detail') || '').trim());
    }

    mailAppendHistory_(ss, {
      customerId: customerId,
      from: customer.email,
      subject: 'フォームからのお問い合わせ',
      summary: summary,
      aiFirst: '',
      finalText: '',
      status: MAIL_STATUS_PENDING,
      threadId: ''
    });
    listed[customerId] = true;
    added++;
  });

  if (added > 0) boardLog_('取込', '未対応の案件 ' + added + ' 件を対応リストに追加しました');
  return added;
}

/** 案件ボードのセルに収まる長さへ整える。全文はメール履歴に残る。 */
function boardTrimInquiry_(text) {
  const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (!value) return '';
  return value.length > BOARD_INQUIRY_MAX ? value.slice(0, BOARD_INQUIRY_MAX) + '…（続きはメール履歴）' : value;
}

const BOARD_INQUIRY_LOOKBACK_DAYS = 60;
const BOARD_INQUIRY_MAX_CUSTOMERS = 30;

/**
 * 案件ボードの「最新のお問い合わせ内容」を最新の状態に保つ。
 *
 * 返信案の生成とは切り離してある。返信案は一度処理したスレッドを
 * 二度と読まないため、そこに相乗りすると既存のメールが反映されないため。
 * 顧客のアドレスをまとめて1回のGmail検索で引き、最後に届いた本文を書き込む。
 */
function boardRefreshInquiries_(ss) {
  // メールの検索が失敗しても、フォームの内容だけは必ず埋める
  let updated = boardFillInquiryFromForm_(ss);

  const customers = mailLoadCustomers_(ss).slice(0, BOARD_INQUIRY_MAX_CUSTOMERS);
  if (customers.length === 0) return updated;

  const byEmail = {};
  customers.forEach(function (c) { byEmail[c.email.toLowerCase()] = c.customerId; });

  const inbound = boardLatestMails_(byEmail, 'from', customers);
  const outbound = boardLatestMails_(byEmail, 'to', customers);

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  Object.keys(byEmail).forEach(function (email) {
    const customerId = byEmail[email];
    const row = boardFindLatestCaseRow_(ss, customerId);
    if (!row) return;

    if (boardWriteMailCell_(sheet, row, BOARD_COL.lastInbound, inbound[customerId])) updated++;
    if (boardWriteMailCell_(sheet, row, BOARD_COL.lastOutbound, outbound[customerId])) updated++;

    // 最終連絡日は、受信・送信のうち新しいほうに合わせる
    const dates = [inbound[customerId], outbound[customerId]]
      .filter(function (m) { return m; }).map(function (m) { return m.date; });
    if (dates.length === 0) return;
    const newest = new Date(Math.max.apply(null, dates));
    const current = sheet.getRange(row, BOARD_COL.lastContact).getValue();
    if (!(current instanceof Date) || newest > current) {
      sheet.getRange(row, BOARD_COL.lastContact).setValue(newest);
    }
  });

  if (updated > 0) boardLog_('取込', '最新のメール内容を ' + updated + ' 件更新しました');
  return updated;
}

/**
 * 顧客ごとの最新メールを1回の検索でまとめて取る。
 * direction が 'from' なら受信、'to' なら送信を対象にする。
 */
function boardLatestMails_(byEmail, direction, customers) {
  const scope = direction === 'to' ? 'in:sent ' : '';
  const query = scope + 'newer_than:' + BOARD_INQUIRY_LOOKBACK_DAYS + 'd {' +
    customers.map(function (c) { return direction + ':' + c.email; }).join(' ') + '}';

  let threads;
  try {
    threads = GmailApp.search(query, 0, 50);
  } catch (err) {
    boardLog_('取込', 'メールの検索に失敗: ' + err.message);
    return {};
  }

  const latest = {};
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      const target = direction === 'to'
        ? String(message.getTo() || '') + ' ' + String(message.getCc() || '')
        : String(message.getFrom() || '');
      const hay = target.toLowerCase();
      const hit = Object.keys(byEmail).filter(function (email) { return hay.indexOf(email) >= 0; })[0];
      if (!hit) return;
      const id = byEmail[hit];
      if (!latest[id] || message.getDate() > latest[id].date) {
        latest[id] = { date: message.getDate(), body: mailPlainBody_(message) };
      }
    });
  });
  return latest;
}

/** 日時と本文をまとめてセルへ書く。内容が同じなら書き換えない。 */
function boardWriteMailCell_(sheet, row, col, mail) {
  if (!mail) return false;
  const when = Utilities.formatDate(mail.date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
  const text = boardTrimInquiry_(when + String.fromCharCode(10) + mail.body);
  if (!text) return false;
  if (String(sheet.getRange(row, col).getValue() || '') === text) return false;
  sheet.getRange(row, col).setValue(text);
  return true;
}

/** まだ問い合わせ内容が空の案件を、フォームの回答で埋める。 */
function boardFillInquiryFromForm_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const source = ss.getSheetByName(BOARD_SOURCE_SHEET);
  if (!sheet || !source || sheet.getLastRow() < 2 || source.getLastRow() < 2) return 0;

  const col = boardResolveSourceColumns_(source);
  if (col.inquiry < 0) {
    const headers = source.getRange(1, 1, 1, source.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); }).filter(function (h) { return h; });
    boardLog_('取込', '問い合わせ内容の列が見つかりません。Responsesの見出し: ' + headers.join(' / '));
    return 0;
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  let filled = 0;
  const skipped = [];

  rows.forEach(function (row, i) {
    if (!String(row[BOARD_COL.caseId - 1] || '').trim()) return;

    const sourceRow = Number(row[BOARD_COL.sourceRow - 1] || 0);
    if (sourceRow < 2 || sourceRow > source.getLastRow()) {
      skipped.push(row[BOARD_COL.caseId - 1] + '（元回答行が不明）');
      return;
    }

    const text = boardTrimInquiry_(source.getRange(sourceRow, col.inquiry + 1).getValue());
    if (!text) {
      skipped.push(row[BOARD_COL.caseId - 1] + '（フォームの記入なし）');
      return;
    }
    // フォームの内容は後から変わらないため、常に上書きして正しい状態に保つ
    if (String(row[BOARD_COL.formInquiry - 1] || '') === text) return;
    sheet.getRange(i + 2, BOARD_COL.formInquiry).setValue(text);
    filled++;
  });

  if (skipped.length > 0) boardLog_('取込', '問い合わせ内容を埋められなかった案件: ' + skipped.join('、'));
  return filled;
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
  return boardMatchIntake_(boardParseLabeledLines_(text), BOARD_CUSTOMER_INTAKE);
}

/** 案件側に保管する項目を抜き出す。 */
function boardExtractCaseIntake_(text) {
  return boardMatchIntake_(boardParseLabeledLines_(text), BOARD_CASE_INTAKE);
}

/** 「見出し：値」の行を集める。括弧書きの補足と空白は落とす。 */
function boardParseLabeledLines_(text) {
  const found = {};
  String(text || '').split('\n').forEach(function (raw) {
    const line = raw.replace(/^[\s>＞・･]+/, '').trim();
    const match = line.match(/^([^：:]+)[：:]\s*(.*)$/);
    if (match) {
      const label = match[1].replace(/[（(].*?[)）]/g, '').replace(/\s/g, '').trim();
      const value = match[2].trim();
      if (label && value) found[label] = value;
      return;
    }

    // コロンを付け忘れた行。「見出し 値」の形で、見出しが完全に一致するものだけ拾う。
    // 知っている見出しに限るので、ふつうの文章を取り違えることはない
    const bare = line.replace(/[（(].*?[)）]/g, '').match(/^(\S+)[\s　]+(.+)$/);
    if (!bare) return;
    if (!BOARD_INTAKE_LABELS[bare[1]]) return;
    if (bare[2].trim()) found[bare[1]] = bare[2].trim();
  });
  return found;
}

function boardMatchIntake_(labels, definitions) {
  const found = {};
  definitions.forEach(function (item) {
    if (labels[item.label]) found[item.col] = labels[item.label];
  });
  return found;
}

/** 抜き出した内容を案件へ書き込む。値が入っている項目だけを更新する。 */
function boardApplyCaseIntake_(ss, customerId, values, onlyEmpty) {
  const keys = Object.keys(values);
  if (keys.length === 0) return 0;

  const row = boardFindLatestCaseRow_(ss, customerId);
  if (!row) return 0;

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  let changed = 0;
  keys.forEach(function (key) {
    const col = BOARD_COL[key];
    if (!col) return;
    const cell = sheet.getRange(row, col);
    const now = String(cell.getValue() || '').trim();
    if (now === values[key]) return;
    // 後追いの補完では、空欄だけを埋める。手で直した値を上書きしない
    if (onlyEmpty && now) return;
    cell.setValue(values[key]);
    changed++;
  });

  if (changed > 0) boardLog_('案件情報', customerId + ' の初回ご依頼予定数などを更新しました');
  return changed;
}

/** 抜き出した内容を顧客タブへ書き込む。値が入っている項目だけを更新する。 */
function boardApplyCustomerIntake_(ss, email, values, onlyEmpty) {
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
    const now = String(cell.getValue() || '').trim();
    if (now === values[key]) return;
    // 後追いの補完では、空欄だけを埋める。手で直した値を上書きしない
    if (onlyEmpty && now) return;
    cell.setValue(values[key]);
    changed.push(BOARD_CUSTOMER_HEADERS[col - 1]);
  });

  if (changed.length > 0) {
    sheet.getRange(row, BOARD_CUSTOMER_COL.updatedAt).setValue(new Date());
    boardLog_('顧客情報', email + ' の ' + changed.join('・') + ' を更新しました');
  }
  return changed.length;
}

/**
 * 記録済みのメールを読み直し、顧客情報の空欄だけを埋める。
 *
 * 取り込みは新着を記録したときにしか走らない。
 * 読み取りの条件を直しても、すでに記録されたメールには反映されないため、
 * 初期セットアップのたびに受信本文を見直す。**空欄だけを埋め、既存の値は触らない。**
 */
function boardBackfillIntake_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues();
  let filled = 0;

  rows.forEach(function (row) {
    const email = String(row[BOARD_MAIL_COL.from - 1] || '').trim();
    const body = mailUnstamp_(row[BOARD_MAIL_COL.summary - 1]);
    if (!email || !body) return;
    try {
      filled += boardApplyCustomerIntake_(ss, email, boardExtractCustomerIntake_(body), true);
      boardApplyCaseIntake_(ss, row[BOARD_MAIL_COL.customerId - 1], boardExtractCaseIntake_(body), true);
    } catch (err) {
      boardLog_('②エラー', '顧客情報の補完に失敗: ' + err.message);
    }
  });

  if (filled > 0) boardLog_('顧客情報', '空欄だった ' + filled + ' 項目を過去のメールから補いました');
  return filled;
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

/**
 * 案件ボードの「お客様」列（C列）に、顧客タブの主要項目をメモ（ホバーで見える注釈）として表示する。
 * BOARD_CUSTOMER_INTAKE の9項目（ストア名・会社名・代表者名義・請求先/返送先の住所等）を対象とする。
 * これらは既に案件ボードの他の列に出ている情報（お客様名・依頼内容など）とは重複しない。
 * mailCheckNow / mailScanFromTrigger の1サイクルごとに全行まとめて再計算する。
 */
function boardRefreshCustomerNotes_(ss) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const customers = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!cases || !customers || cases.getLastRow() < 2) return;

  const byId = {};
  if (customers.getLastRow() > 1) {
    customers.getRange(2, 1, customers.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues()
      .forEach(function (row) { byId[String(row[BOARD_CUSTOMER_COL.id - 1] || '').trim()] = row; });
  }

  const caseRows = cases.getRange(2, 1, cases.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const notes = caseRows.map(function (row) {
    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    const cust = customerId ? byId[customerId] : null;
    return [cust ? boardBuildCustomerNote_(cust) : ''];
  });

  cases.getRange(2, BOARD_COL.customer, notes.length, 1).setNotes(notes);
}

/** メールアドレス＋BOARD_CUSTOMER_INTAKE の9項目を「ラベル：値」の形で1行ずつ並べる。未回答は（未回答）と表示する。 */
function boardBuildCustomerNote_(custRow) {
  const email = String(custRow[BOARD_CUSTOMER_COL.email - 1] || '').trim();
  const lines = ['メールアドレス：' + (email || '（未登録）')];
  BOARD_CUSTOMER_INTAKE.forEach(function (item) {
    const col = BOARD_CUSTOMER_COL[item.col];
    const value = String(custRow[col - 1] || '').trim();
    lines.push(item.label + '：' + (value || '（未回答）'));
  });
  return lines.join('\n');
}

/** 月間予定数の表示を「○点」の形に揃える。既に「点」を含む場合はそのまま。空欄は空文字を返す。 */
function boardMonthlyLabel_(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return /点/.test(value) ? value : value + '点';
}

/**
 * 既存の案件ボードの行のうち、依頼内容（J列）に月間予定数が未反映のものへ、
 * 顧客タブに保存済みの月間予定数を追記する。ui.alert等のUI呼び出しは行わない
 * （boardSetup から自動実行できるようにするため）。
 */
function boardBackfillMonthlyToDetail_(ss) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const customers = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!cases || !customers || cases.getLastRow() < 2) return 0;

  const byId = {};
  if (customers.getLastRow() > 1) {
    customers.getRange(2, 1, customers.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues()
      .forEach(function (row) { byId[String(row[BOARD_CUSTOMER_COL.id - 1] || '').trim()] = row; });
  }

  const last = cases.getLastRow();
  const rows = cases.getRange(2, 1, last - 1, BOARD_CASE_HEADERS.length).getValues();
  let updated = 0;

  rows.forEach(function (row, i) {
    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    const cust = customerId ? byId[customerId] : null;
    if (!cust) return;

    const monthly = boardMonthlyLabel_(cust[BOARD_CUSTOMER_COL.monthly - 1]);
    if (!monthly) return;

    const current = String(row[BOARD_COL.detail - 1] || '');
    // 既存の「月間予定数：…」部分（区切りが／・改行・区切りなし、いずれでも）を取り除いてから付け直す
    const idx = current.indexOf('月間予定数：');
    let base = idx >= 0 ? current.slice(0, idx) : current;
    base = base.replace(/[　\s]*／[　\s]*$/, '').replace(/\n$/, '').trim();
    const rebuilt = base ? base + '\n月間予定数：' + monthly : '月間予定数：' + monthly;
    if (rebuilt === current) return; // 既に最新の形式

    cases.getRange(i + 2, BOARD_COL.detail).setValue(rebuilt);
    updated++;
  });

  if (updated > 0) boardLog_('修正', '既存の依頼内容へ月間予定数を追記しました（' + updated + '件）');
  return updated;
}

/** 全ての案件行に「次にやること」と「対応者」の数式を入れ直す。 */
function boardRefreshFormulas_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    if (!String(sheet.getRange(row, BOARD_COL.caseId).getValue() || '').trim()) continue;
    boardSetTodoFormula_(sheet, row);
    boardSetOwnerFormula_(sheet, row);
  }
  boardRefreshUnreplied_(sheet.getParent());
}

/**
 * 依頼確定へ進める情報がそろっているかを調べる。
 * 見積もり回答で伺った項目のうち、埋まっていないものを返す。
 */
function boardEvaluateReadiness_(ss, customerId) {
  const customer = boardFindCustomerRow_(ss, customerId);
  const missing = [];
  if (!customer) return { ready: false, missing: ['顧客情報'] };

  BOARD_CUSTOMER_INTAKE.forEach(function (item) {
    const col = BOARD_CUSTOMER_COL[item.col];
    if (!col) return;
    if (!String(customer.values[col - 1] || '').trim()) missing.push(item.label);
  });

  const caseRow = boardFindLatestCaseRow_(ss, customerId);
  if (caseRow) {
    const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
    const firstQty = String(sheet.getRange(caseRow, BOARD_COL.firstQty).getValue() || '').trim();
    const qty = String(sheet.getRange(caseRow, BOARD_COL.qty).getValue() || '').trim();
    // 予定点数が既に入っていれば、初回ご依頼予定数は無くても進められる
    if (!firstQty && !qty) missing.push('初回ご依頼予定数');
  }
  return { ready: missing.length === 0, missing: missing };
}

function boardFindCustomerRow_(ss, customerId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastRow() < 2 || !customerId) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][BOARD_CUSTOMER_COL.id - 1]).trim() === String(customerId).trim()) {
      return { row: i + 2, values: rows[i] };
    }
  }
  return null;
}

/**
 * お客様から返信が届いたときに、情報の過不足でステータスを進める。
 * こちらが返信を待っている段階の案件だけを対象にする。
 */
function boardAdvanceOnReply_(ss, customerId) {
  const row = boardFindLatestCaseRow_(ss, customerId);
  if (!row) return '';

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const status = String(sheet.getRange(row, BOARD_COL.status).getValue() || '').trim();
  if (['返信済', BOARD_STATUS_SHORT, BOARD_STATUS_READY].indexOf(status) < 0) return '';

  const next = boardEvaluateReadiness_(ss, customerId).ready ? BOARD_STATUS_READY : BOARD_STATUS_SHORT;
  if (next === status) return '';

  sheet.getRange(row, BOARD_COL.status).setValue(next);
  boardSetTodoFormula_(sheet, row);
  boardSetOwnerFormula_(sheet, row);
  boardLog_('案件情報', sheet.getRange(row, BOARD_COL.caseId).getValue() + ' を「' + next + '」に進めました');
  return next;
}

/**
 * 案内メール作成日が空の案件を、メール履歴の記録から埋める。
 *
 * 「対応を選ぶ」から送った分はこの列を書いていなかったため、
 * 依頼確定の対応をした行の下書き保存日時を使って後から補う。
 */
function boardBackfillGuideDate_(ss) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  const mails = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!cases || !mails || cases.getLastRow() < 2 || mails.getLastRow() < 2) return 0;

  const sentAt = {};
  mails.getRange(2, 1, mails.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues()
    .forEach(function (row) {
      if (String(row[BOARD_MAIL_COL.responseType - 1] || '').indexOf('依頼確定') !== 0) return;
      const when = row[BOARD_MAIL_COL.savedAt - 1] || row[BOARD_MAIL_COL.date - 1];
      if (!(when instanceof Date)) return;
      const id = String(row[BOARD_MAIL_COL.customerId - 1] || '').trim();
      if (!id) return;
      if (!sentAt[id] || when > sentAt[id]) sentAt[id] = when;
    });

  const rows = cases.getRange(2, 1, cases.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  let filled = 0;
  rows.forEach(function (row, i) {
    if (row[BOARD_COL.guideDraftAt - 1]) return;
    const id = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (!sentAt[id]) return;
    cases.getRange(i + 2, BOARD_COL.guideDraftAt).setValue(sentAt[id]);
    boardSetTodoFormula_(cases, i + 2);
    filled++;
  });

  if (filled > 0) boardLog_('整理', '案内メール作成日を ' + filled + ' 件補完しました');
  return filled;
}

/**
 * 情報の過不足を見て、全案件のステータスを判定し直す。
 *
 * 判定の仕組みを作る前に届いた返信は一度も評価されていないため、
 * 初期セットアップのたびに手当てする。対象は返信のやりとり中の案件だけで、
 * 依頼確定より先へ進んだ案件には触れない。
 */
function boardReevaluateStatuses_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const targets = ['返信済', BOARD_STATUS_SHORT, BOARD_STATUS_READY];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const changed = [];

  rows.forEach(function (row, i) {
    const status = String(row[BOARD_COL.status - 1] || '').trim();
    if (targets.indexOf(status) < 0) return;

    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (!customerId) return;

    const next = boardEvaluateReadiness_(ss, customerId).ready ? BOARD_STATUS_READY : BOARD_STATUS_SHORT;
    // 一度も返信が届いていない案件は「返信済」のままにしておく
    if (next === BOARD_STATUS_SHORT && status === '返信済') return;
    if (next === status) return;

    sheet.getRange(i + 2, BOARD_COL.status).setValue(next);
    boardSetTodoFormula_(sheet, i + 2);
    boardSetOwnerFormula_(sheet, i + 2);
    changed.push(row[BOARD_COL.caseId - 1] + '→' + next);
  });

  if (changed.length > 0) boardLog_('整理', 'ステータスを見直しました: ' + changed.join('、'));
  return changed.length;
}

/** 次に動くのが自分かお客様かを、ステータスから自動で表示する。 */
function boardSetOwnerFormula_(sheet, row) {
  const status = '$' + boardColLetter_(BOARD_COL.status) + row;
  const cases = Object.keys(BOARD_STATUS_OWNER).map(function (name) {
    return status + '="' + name + '","' + BOARD_STATUS_OWNER[name] + '"';
  }).join(',');
  sheet.getRange(row, BOARD_COL.owner).setFormula(
    '=IF($' + boardColLetter_(BOARD_COL.caseId) + row + '="","",IFS(' + cases + ',TRUE,""))'
  );
}

/**
 * 「未返信」列を全案件ぶん書き直す。
 *
 * ここは数式にしない。件数と飛び先の行を1つの数式で求めようとすると、
 * 開いた範囲（A2:A）の長さの扱いがスプレッドシート側の判断に左右され、
 * 件数が0になったり飛び先が別の行になったりした。
 * メール履歴を読んで数えるだけなので、こちらで計算して書くほうが確実。
 *
 * メール履歴に動きがあるところから毎回呼ぶ。
 * 10分ごとの自動チェックでも通るため、ずれても次の実行で直る。
 */
function boardRefreshUnreplied_(ss) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!cases || cases.getLastRow() < 2) return;

  // 顧客ごとに、対応中のメールの行番号と受信日を集める
  const open = {};
  const mails = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (mails && mails.getLastRow() > 1) {
    mails.getRange(2, 1, mails.getLastRow() - 1, BOARD_MAIL_HEADERS.length).getValues()
      .forEach(function (row, i) {
        const id = String(row[BOARD_MAIL_COL.customerId - 1] || '').trim();
        if (!id) return;
        if (MAIL_OPEN_STATUSES.indexOf(String(row[BOARD_MAIL_COL.status - 1] || '').trim()) < 0) return;
        const when = row[BOARD_MAIL_COL.date - 1];
        if (!open[id]) open[id] = [];
        open[id].push({
          row: i + 2,
          at: when instanceof Date ? when.getTime() : 0,
          label: when instanceof Date
            ? Utilities.formatDate(when, Session.getScriptTimeZone(), 'M/d')
            : '?'
        });
      });
  }

  const base = ss.getUrl().split('#')[0] + '#gid=' + (mails ? mails.getSheetId() : 0) + '&range=A';
  const rows = cases.getLastRow() - 1;
  const caseIds = cases.getRange(2, BOARD_COL.caseId, rows, 1).getValues();
  const customerIds = cases.getRange(2, BOARD_COL.customerId, rows, 1).getValues();
  const statuses = cases.getRange(2, BOARD_COL.status, rows, 1).getValues();
  const blank = SpreadsheetApp.newRichTextValue().setText('').build();

  cases.getRange(2, BOARD_COL.unreplied, rows, 1).setRichTextValues(
    caseIds.map(function (row, i) {
      if (!String(row[0] || '').trim()) return [blank];
      // 終わった案件には出さない。「対応を選ぶ」の一覧と同じ扱いにする
      if (BOARD_FINISHED_STATUSES.indexOf(String(statuses[i][0] || '').trim()) >= 0) return [blank];
      const hits = open[String(customerIds[i][0] || '').trim()];
      if (!hits || hits.length === 0) return [blank];

      // 届いた日の新しいものから並べ、1通ずつ別のリンクにする
      const shown = hits.slice()
        .sort(function (a, b) { return b.at - a.at; })
        .slice(0, BOARD_UNREPLIED_MAX_LINKS);
      const rest = hits.length - shown.length;
      const labels = shown.map(function (h) { return h.label; });
      const value = SpreadsheetApp.newRichTextValue()
        .setText(labels.join(BOARD_UNREPLIED_SEPARATOR) + (rest > 0 ? ' +' + rest : ''));

      let at = 0;
      shown.forEach(function (h, n) {
        value.setLinkUrl(at, at + labels[n].length, base + h.row);
        at += labels[n].length + BOARD_UNREPLIED_SEPARATOR.length;
      });
      return [value.build()];
    })
  );
}

function boardSetTodoFormula_(sheet, row) {
  const cell = function (col) { return '$' + boardColLetter_(col) + row; };
  const b = cell(BOARD_COL.status);
  const start = cell(BOARD_COL.startDate);
  const from = cell(BOARD_COL.dueFrom);
  const to = cell(BOARD_COL.dueTo);
  const draft = cell(BOARD_COL.guideDraftAt);
  const dueEnd = 'IF(' + to + '="",' + from + ',' + to + ')';
  const elapsed = '" ("&TEXT(MAX(0,TODAY()-' + draft + '),"0")&"日経過)"';
  const formula = '=IF(' + cell(BOARD_COL.caseId) + '="","",IFS(' +
    b + '="問合せ","返信案を確認して返信",' +
    b + '="返信済","お客様の返信待ち",' +
    b + '="' + BOARD_STATUS_SHORT + '","不足している情報を聞く",' +
    b + '="' + BOARD_STATUS_READY + '","依頼確定メールを送る",' +
    b + '="依頼確定",IF(OR(' + start + '="",' + from + '=""),"日付を入れて案内メール","案内メールを送る"),' +
    b + '="' + BOARD_STATUS_SIGNING + '",IF(' + cell(BOARD_COL.signedAt) + '<>"","お客様のご発送待ち",' +
      '"支払い情報の登録・署名待ち"&IF(' + draft + '="","",' + elapsed + ')),' +
    b + '="発送待ち","お客様のご発送待ち",' +
    b + '="' + BOARD_STATUS_SHIPPED + '","作業チームへ共有する",' +
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

/**
 * お客様が書いた日付を読み取る。
 * 「2026年9月1日」「2026/9/1」「9/1」などに対応し、
 * 「9月上旬」のように日が定まらない書き方は読み取らない。
 */
function boardParseDate_(value) {
  if (value instanceof Date) return value;
  const text = String(value == null ? '' : value).replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).trim();
  if (!text) return null;

  let m = text.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = text.match(/(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const today = new Date();
    const date = new Date(today.getFullYear(), month - 1, day);
    // 過ぎた日付なら翌年のこととみなす
    if (date < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      date.setFullYear(today.getFullYear() + 1);
    }
    return date;
  }
  return null;
}

/** 「50点」「約50」などから点数だけを取り出す。読み取れなければ空。 */
function boardExtractCount_(value) {
  if (typeof value === 'number') return value;
  const match = String(value == null ? '' : value).replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).match(/\d+/);
  return match ? Number(match[0]) : '';
}

function boardIsEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// ------------------------------------------------------------
// サイドパネル
// ------------------------------------------------------------

function boardOpenPanel() {
  boardUseCurrentColumns_();
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
  boardUseCurrentColumns_();
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
  boardUseCurrentColumns_();
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

  // 変数名を変える前に作られたテンプレートも動くよう、古い名前も受け付ける
  vars['点数'] = vars['予定点数'];

  let body = String(tpl.body || '');
  if (qty === '' || qty === null || qty === undefined) {
    ['{{予定点数}}', '{{点数}}'].forEach(function (needle) {
      body = boardDropLinesWith_(body, needle);
    });
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
  boardUseCurrentColumns_();
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

/**
 * 案件ボードの列は手で並べ替えてよい。
 * 実行のたび一度だけ見出しを読み、BOARD_COL を実際の並びに合わせる。
 */
let BOARD_COLUMNS_SYNCED = false;
function boardUseCurrentColumns_() {
  if (BOARD_COLUMNS_SYNCED) return;
  BOARD_COLUMNS_SYNCED = true;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
    if (sheet) boardSyncColumns_(sheet);
    boardEnsureMailColumns_(ss);
  } catch (err) {
    boardLog_('移行', '列の並びを読めませんでした: ' + err.message);
  }
}

/**
 * メール履歴タブに足りない列を補う。
 * 初期セットアップを待たずにトリガーが動いても落ちないようにする。
 */
function boardEnsureMailColumns_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_MAILS);
  if (!sheet) return;
  const need = BOARD_MAIL_HEADERS.length;
  const short = need - sheet.getMaxColumns();
  if (short > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), short);

  let headers = sheet.getRange(1, 1, 1, need).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  if (headers.join('\t') === BOARD_MAIL_HEADERS.join('\t')) return;

  // 名前だけ変わった列を先に付け替える。ここを飛ばすと、
  // 「無い列」とみなして挿入してしまい、右側の中身がずれる
  Object.keys(BOARD_MAIL_RENAMES).forEach(function (from) {
    headers = boardRenameColumn_(sheet, headers, from, BOARD_MAIL_RENAMES[from]);
  });

  // 対応不要は状態列に一本化した
  const dismiss = headers.indexOf('対応不要');
  if (dismiss >= 0) {
    sheet.deleteColumn(dismiss + 1);
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    boardLog_('移行', 'メール履歴の 対応不要 列を削除しました（状態列に一本化）');
  }

  // 途中に足す列は、名前で位置を決めて挿入する。そうしないと右側の中身がずれる
  BOARD_MAIL_HEADERS.forEach(function (name, i) {
    if (i === 0 || headers.indexOf(name) >= 0) return;
    if (headers.indexOf(BOARD_MAIL_HEADERS[i - 1]) < 0) return;
    headers = boardInsertColumnAfter_(sheet, headers, BOARD_MAIL_HEADERS[i - 1], name);
  });

  sheet.getRange(1, 1, 1, need).setValues([BOARD_MAIL_HEADERS]);
  boardLog_('移行', 'メール履歴の見出しを更新しました');
}
