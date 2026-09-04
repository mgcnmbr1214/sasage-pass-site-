/**
 * ササゲパス 業務ボード 発送の検知と作業チームへの共有
 *
 * お客様から届いたメールを読み、発送された案件を「発送済み」に進める。
 * 追跡番号は本文から探し、無ければ添付画像（送り状の写真）を Claude に読ませる。
 * まとめた共有内容は案件ボードの「作業チーム共有」列に書き出す。送信はしない。
 */

const SHIP_PROP_PREFIX = 'SHIP_CHECKED_';
const SHIP_TARGET_STATUSES = ['発送待ち', BOARD_STATUS_SIGNING];
const SHIP_LOOKBACK_DAYS = 60;
const SHIP_MAX_IMAGES = 2;
const SHIP_MAX_IMAGE_BYTES = 3500000;
const SHIP_YAMATO_URL = 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number=';

function shipCheckAll() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = mailGetApiKey_();
  if (!apiKey) return 0;

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const props = PropertiesService.getScriptProperties();
  let shipped = 0;

  rows.forEach(function (row, i) {
    const caseId = String(row[BOARD_COL.caseId - 1] || '').trim();
    if (!caseId) return;
    if (SHIP_TARGET_STATUSES.indexOf(String(row[BOARD_COL.status - 1] || '').trim()) < 0) return;

    const customer = boardFindCustomer_(ss, row[BOARD_COL.customerId - 1]);
    if (!customer || !boardIsEmail_(customer.email)) return;

    const message = shipLatestMessage_(customer.email);
    if (!message) return;

    // 同じメールを何度もAIに読ませない
    const key = SHIP_PROP_PREFIX + caseId;
    if (props.getProperty(key) === message.getId()) return;
    props.setProperty(key, message.getId());

    let result;
    try {
      result = shipAnalyze_(apiKey, message);
    } catch (err) {
      boardLog_('発送', caseId + '：メールの判定に失敗 ' + err.message);
      return;
    }
    if (!result || !result.shipped) return;

    const tracking = String(result.tracking || '').trim();
    sheet.getRange(i + 2, BOARD_COL.tracking).setValue(tracking);
    sheet.getRange(i + 2, BOARD_COL.status).setValue(BOARD_STATUS_SHIPPED);
    sheet.getRange(i + 2, BOARD_COL.teamNote)
      .setValue(shipBuildTeamNote_(row, customer, tracking, result));
    boardSetTodoFormula_(sheet, i + 2);
    boardLog_('発送', caseId + '：発送を確認しました' + (tracking ? '（追跡番号 ' + tracking + '）' : '（追跡番号なし）'));
    shipped++;
  });

  return shipped;
}

/** その顧客から届いた最新のメール。 */
function shipLatestMessage_(email) {
  let threads;
  try {
    threads = GmailApp.search('from:' + email + ' newer_than:' + SHIP_LOOKBACK_DAYS + 'd', 0, 10);
  } catch (err) {
    boardLog_('発送', 'メールの検索に失敗: ' + err.message);
    return null;
  }
  let latest = null;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (String(message.getFrom() || '').indexOf(email) < 0) return;
      if (!latest || message.getDate() > latest.getDate()) latest = message;
    });
  });
  return latest;
}

/** 発送されたかどうか、追跡番号、特記事項を読み取る。 */
function shipAnalyze_(apiKey, message) {
  const content = [];
  shipImageParts_(message).forEach(function (part) { content.push(part); });
  content.push({
    type: 'text',
    text: [
      '以下は、ささげ代行サービスのお客様から届いたメールです。',
      '添付画像がある場合は宅配便の送り状の写真であることが多いので、そこも読んでください。',
      '',
      '--- 件名 ---',
      message.getSubject(),
      '--- 本文 ---',
      mailPlainBody_(message).slice(0, 3000)
    ].join('\n')
  });

  const system = [
    'あなたはメールの内容を判定する担当者です。次のJSONだけを出力してください。説明は不要です。',
    '{"shipped": true/false, "tracking": "追跡番号", "quantity": "点数", "arrival": "到着予定", "notes": "作業上の特記事項"}',
    '',
    '判定の基準:',
    '- shipped: お客様が商品を発送したと読み取れる場合に true。発送予定や検討中は false。',
    '- tracking: 送り状のお問い合わせ番号。本文か画像から読み取る。数字とハイフンのみ。無ければ空文字。',
    '- quantity: 発送された商品の点数。書かれていなければ空文字。',
    '  送り状の「個数」は荷物（箱）の数であって商品の点数ではない。点数として使わないこと。',
    '- arrival: 到着予定日。書かれていなければ空文字。',
    '- notes: メンテナンスの指定や取り扱いの注意など、作業者が知るべきこと。無ければ空文字。',
    '- 推測で埋めないこと。読み取れないものは空文字にする。'
  ].join('\n');

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MAIL_MODEL,
      max_tokens: 500,
      system: system,
      messages: [{ role: 'user', content: content }]
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Claude APIエラー (' + response.getResponseCode() + ')');
  }
  const parts = (JSON.parse(response.getContentText()).content || [])
    .filter(function (c) { return c.type === 'text'; });
  const text = parts.map(function (c) { return c.text; }).join('').trim();
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return json ? JSON.parse(json) : null;
}

/** 添付画像をClaudeに渡せる形にする。大きすぎるものは送らない。 */
function shipImageParts_(message) {
  const parts = [];
  message.getAttachments().forEach(function (attachment) {
    if (parts.length >= SHIP_MAX_IMAGES) return;
    const type = String(attachment.getContentType() || '');
    if (type.indexOf('image/') !== 0) return;
    if (attachment.getSize() > SHIP_MAX_IMAGE_BYTES) return;
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: type.split(';')[0],
        data: Utilities.base64Encode(attachment.getBytes())
      }
    });
  });
  return parts;
}

/** 作業チームへ渡す内容。料金と月間予定数は載せない。 */
function shipBuildTeamNote_(row, customer, tracking, result) {
  const detail = boardDetailWithoutPrice_(row[BOARD_COL.detail - 1])
    .split(String.fromCharCode(10))
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line; })
    .map(function (line) { return '　・' + line; })
    .join(String.fromCharCode(10));

  // **点数は案件ボードの予定点数を正とする。**
  // 送り状の写真には「個数 1」（荷物の数）と書かれており、それを点数として
  // 読み取ってしまい、22点のご依頼が「1点」になったことがある。
  // メールから読み取った数は、予定点数が空のときだけ使う
  const planned = boardExtractCount_(row[BOARD_COL.qty - 1]);
  const read = boardExtractCount_(result.quantity);
  const quantity = planned !== '' ? String(planned)
    : (read !== '' ? String(read) : String(result.quantity || '').trim());
  const due = boardFormatDateRange_(row[BOARD_COL.dueFrom - 1], row[BOARD_COL.dueTo - 1]);

  const lines = [
    '【作業依頼】' + row[BOARD_COL.caseId - 1] + '　' + (customer.company || customer.name || ''),
    ''
  ];

  if (tracking) {
    lines.push('■ 追跡番号');
    lines.push('　' + tracking);
    if (/^\d[\d-]{10,}$/.test(tracking)) {
      lines.push('　' + SHIP_YAMATO_URL + tracking.replace(/-/g, ''));
    }
  } else {
    lines.push('■ 追跡番号');
    lines.push('　未取得（お客様に確認が必要）');
  }

  if (result.arrival) lines.push('　到着予定: ' + result.arrival);
  lines.push('');
  lines.push('■ 点数');
  lines.push('　' + (quantity ? quantity + '点' : '未確定'));
  lines.push('');
  lines.push('■ 納期予定');
  lines.push('　' + (due || '未定'));
  lines.push('');
  lines.push('■ 作業内容');
  lines.push(detail || '　（未設定）');

  // 案件のメモは、その案件でずっと守ってほしいこと。毎回渡す
  const memo = String(row[BOARD_COL.memo - 1] || '').trim();
  if (memo) {
    lines.push('');
    lines.push('■ メモ');
    memo.split(String.fromCharCode(10)).forEach(function (line) {
      if (line.trim()) lines.push('　' + line.trim());
    });
  }

  if (result.notes) {
    lines.push('');
    lines.push('■ お客様からの指定');
    lines.push('　' + result.notes);
  }

  return lines.join(String.fromCharCode(10));
}
