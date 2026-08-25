/**
 * ササゲパス サイト 問い合わせ窓口 受信スクリプト
 *
 * index.html の .contact-form から fetch(..., {mode:'no-cors'}) で送信された内容を受け取り、
 * ① 業務ボードのスプレッドシートの「Responses」シートに1行追記する（既存の取込み処理に自動で乗る）
 * ② info@sasagepass.com へ即時通知メールを送る
 *
 * デプロイ設定（script.google.com の「デプロイ」画面で設定する）:
 *   - 種類: ウェブアプリ / 次のユーザーとして実行: 自分（Me）/ アクセスできるユーザー: 全員（Anyone）
 *
 * gas/mitsumori-form/ の業務ボードとは完全に別の独立したプロジェクトとして運用する
 * （同じプロジェクトに doPost を足すと、既存の見積もりフォームの doPost と衝突するため）。
 */

var SPREADSHEET_ID = '1uEkO75sWb6bYLDI6I_p4pxPOtq-CUqTm0H_E1n8yQtc';
var RESPONSES_SHEET_NAME = 'Responses';
var NOTIFY_TO = 'info@sasagepass.com';

// gas/mitsumori-form/board.js の BOARD_SOURCE_FIELDS と同じ候補見出し
var SOURCE_FIELD_CANDIDATES = {
  date: ['送信日時', 'タイムスタンプ'],
  company: ['会社名', '会社名・屋号', '貴社名 / 屋号名'],
  name: ['お名前', 'ご担当者名', '担当者名'],
  email: ['メールアドレス', 'メール'],
  detail: ['選択内容'],
  inquiry: ['問い合わせ内容', 'お問い合わせ・ご要望', 'お問い合わせ内容・補足', 'ご要望', '備考']
};

var SERVICE_LABELS = {
  '撮影のみ': '撮影のみ（プランA）',
  '撮影+採寸': '撮影＋採寸（プランB）',
  '撮影+採寸+出品': '撮影＋採寸＋出品（プランC）',
  '複数サイト出品': '複数サイト出品（プランD）',
  'サイト制作': '自社サイト制作',
  '未定・相談したい': 'まだ決めていない・相談したい'
};

function doPost(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // ハニーポット: ボットが埋めてきた隠しフィールド。何もせず成功を返す。
  if (params.website) return jsonOutput({ result: 'success' });

  var name = clean_(params.name);
  var company = clean_(params.company);
  var email = clean_(params.email);
  var service = clean_(params.service);
  var message = clean_(params.message);

  if (!name || !email || !message) {
    return jsonOutput({ result: 'error', message: '必須項目が入力されていません。' });
  }
  if (email.indexOf('@') === -1) {
    return jsonOutput({ result: 'error', message: 'メールアドレスの形式が正しくありません。' });
  }

  try {
    appendToResponses_(name, company, email, service, message);
  } catch (err) {
    notifyInternalError_('Responsesシートへの追記に失敗', err);
  }

  try {
    sendNotifyMail_(name, company, email, service, message);
  } catch (err) {
    notifyInternalError_('通知メールの送信に失敗', err);
  }

  return jsonOutput({ result: 'success' });
}

function appendToResponses_(name, company, email, service, message) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(RESPONSES_SHEET_NAME);
  if (!sheet) throw new Error('「' + RESPONSES_SHEET_NAME + '」シートが見つかりません。');

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var col = resolveColumns_(headers);

  var row = new Array(lastCol).fill('');
  if (col.date >= 0) row[col.date] = new Date();
  if (col.name >= 0) row[col.name] = name;
  if (col.company >= 0) row[col.company] = company;
  if (col.email >= 0) row[col.email] = email;
  if (col.detail >= 0) {
    var label = SERVICE_LABELS[service] || service || '（未選択）';
    row[col.detail] = '問い合わせ窓口より：' + label;
  }
  if (col.inquiry >= 0) row[col.inquiry] = message;

  sheet.appendRow(row);
}

/** board.js の boardResolveSourceColumns_ と同じ考え方（表記ゆれを吸収して見出し名で解決）。 */
function resolveColumns_(headers) {
  var norm = headers.map(normalizeHeader_);
  var map = {};
  Object.keys(SOURCE_FIELD_CANDIDATES).forEach(function (key) {
    var candidates = SOURCE_FIELD_CANDIDATES[key];
    for (var i = 0; i < candidates.length; i++) {
      var exact = headers.indexOf(candidates[i]);
      if (exact >= 0) { map[key] = exact; return; }
    }
    for (var i = 0; i < candidates.length; i++) {
      var want = normalizeHeader_(candidates[i]);
      for (var c = 0; c < norm.length; c++) {
        if (!norm[c]) continue;
        if (norm[c] === want || norm[c].indexOf(want) >= 0 || want.indexOf(norm[c]) >= 0) { map[key] = c; return; }
      }
    }
    map[key] = -1;
  });
  return map;
}

function normalizeHeader_(text) {
  return String(text || '').trim()
    .replace(/[\s　・･、,／\/（）()]/g, '')
    .replace(/^[おご]/, '');
}

function sendNotifyMail_(name, company, email, service, message) {
  var label = SERVICE_LABELS[service] || service || '（未選択）';
  var body = [
    'サイトの問い合わせ窓口から送信がありました。',
    '（内容は業務ボードのResponsesシートにも追記済みです）',
    '',
    'お名前　　　　：' + name,
    '会社名・店舗名：' + (company || '（未入力）'),
    'メールアドレス：' + email,
    'ご希望のサービス：' + label,
    '',
    'お問い合わせ内容：',
    message
  ].join('\n');

  MailApp.sendEmail({
    to: NOTIFY_TO,
    replyTo: email,
    name: 'ササゲパス 問い合わせ窓口',
    subject: 'サイトからのお問い合わせ（' + name + '様）',
    body: body
  });
}

function notifyInternalError_(label, err) {
  try {
    MailApp.sendEmail({
      to: NOTIFY_TO,
      subject: '【要確認】問い合わせ窓口でエラー: ' + label,
      body: (err && err.message ? err.message : String(err))
    });
  } catch (e2) {
    // ここで失敗しても doPost 全体は成功として返す（フォーム自体は受け付けたため）
  }
}

function clean_(v) { return (v || '').toString().trim(); }

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
