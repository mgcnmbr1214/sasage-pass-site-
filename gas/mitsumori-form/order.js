/**
 * ササゲパス 依頼フォーム
 *
 * 2回目以降のお客様が、ご自分のタイミングでご依頼を出すための画面。
 * 見積もりフォームとは別物で、**料金は表示しない**。
 * 選択肢は見積もりフォームと同じ設定（Config）から取るので、
 * メニューや料金表を変えても、こちらを直す必要はない。
 *
 * 2段階に分かれている。
 *   1. ご依頼内容・点数・備考　→ 発送待ち
 *   2. 運送業者・追跡番号　　　→ 荷受待ち（依頼完了）
 *
 * 1だけで止まっている依頼は「発送待ち」として案件ボードに並ぶ。
 * 催促は自動で送らず、経過日数を見て手動で判断する。
 */

/** 料金と作業内容の案内先。依頼フォームでは金額を出さない。 */
const ORDER_PRICE_URL = 'https://sasagepass.com/mitsumori/';

/** URLに付ける鍵の長さ。顧客IDだけでは別のお客様の内容が見えてしまう。 */
const ORDER_KEY_LENGTH = 12;

/** 運送業者と、追跡番号の桁数。合わない番号は受け付けない。 */
const ORDER_CARRIERS = [
  {
    id: 'yamato', name: 'ヤマト運輸', digits: [12],
    url: 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number='
  },
  {
    id: 'sagawa', name: '佐川急便', digits: [10, 12],
    url: 'https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo='
  },
  {
    id: 'japanpost', name: '日本郵便', digits: [11, 12, 13],
    url: 'https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1='
  },
  { id: 'other', name: 'その他', digits: [], url: '' }
];

/** 画面に出す注意書き。テンプレートと違い、文面はここで持つ。 */
const ORDER_NOTES = {
  tracking: '「追跡番号の送信」を必ず忘れずにお願いします。\n' +
    'お荷物をお受け取りできない場合や、作業が後回しになる場合があります。\n' +
    '同じ日に届くお荷物が複数ある場合は、そのうち1件だけで結構です。',
  due: '納期はクリーニング＋撮影のみのご依頼で100点→およそ1週間前後が目安です。\n' +
    'お預かり後にあらためて詳しい納期をご連絡いたします。\n' +
    '初回作業のご依頼や混雑時は通常より長くいただく場合がございます。',
  newMenu: '新しいメニューを追加された場合、準備にお時間をいただくことがございます。\n' +
    'お急ぎのときは発送前にメールでご相談ください。',
  // この画面は料金を出さない。確かめたいときの行き先を必ず添える
  price: '各メニューの料金や詳細に関してはこちらをご確認ください\n' + ORDER_PRICE_URL,
  tel: '運送業者専用電話です。ササゲパス作業内容や納期のご案内は' +
    'こちらでは承っておりません。',
  profile: 'ご登録内容の変更は、お手数ですがメールにてご連絡ください。'
};

/**
 * 依頼フォームを開く。doGet から呼ぶ。
 *
 * **顧客IDのパラメータ名は cid。** `c` はGoogle側が使っている名前で、
 * `?c=…` を付けると画面まで届かず「ファイルを開くことができません」になる。
 */
function orderRender_(params) {
  const template = HtmlService.createTemplateFromFile('Order');
  template.customerId = String(params.cid || '').trim();
  template.formKey = String(params.k || '').trim();
  return template
    .evaluate()
    .setTitle('ササゲパス ご依頼フォーム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // 見積もりフォームと同じく、あとでサイト側へ埋め込めるようにしておく
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 画面を描くのに必要なものをまとめて返す。
 *
 * **鍵が合わなければ何も返さない。** 顧客IDだけで開けると、
 * URLの番号を変えるだけで別のお客様の登録内容が見えてしまう。
 */
function orderGetState(customerId, formKey) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    boardUseCurrentColumns_();

    const customer = orderAuthorize_(ss, customerId, formKey);
    if (!customer) return { ok: false, reason: 'このURLでは開けません。お手数ですがメールにてご連絡ください。' };

    const cases = boardListCases_(ss, customer.id);
    const open = orderFindOpenCase_(cases);
    const latest = cases[0] || null;
    const settings = boardGetSettings_(ss);
    const signed = !!customer.values[BOARD_CUSTOMER_COL.signedAt - 1];

    return {
      ok: true,
      customer: orderCustomerView_(customer),
      signed: signed,
      notes: ORDER_NOTES,
      carriers: ORDER_CARRIERS.map(function (c) { return { id: c.id, name: c.name, digits: c.digits }; }),
      menus: orderMenus_(),
      // 前回と同じ内容をあらかじめ選んでおく。毎回選び直さなくてよいように
      selected: orderPreviousSelection_(open || latest),
      current: open ? orderCaseView_(ss, open) : null,
      shipTo: orderShipTo_(settings, signed)
    };
  } catch (err) {
    boardLog_('②エラー', '依頼フォームの読み込みに失敗: ' + err.message);
    return { ok: false, reason: '読み込みに失敗しました。時間をおいてお試しください。' };
  }
}

/**
 * ご依頼内容を受け付ける。第1段階。
 *
 * **発送前のご依頼は1件まで。** すでにあればその依頼を書き換える。
 * 見積もりフォームから来た「問合せ」の行があれば、新しく作らずにそれを使う。
 */
function orderSubmitRequest(payload) {
  const data = payload || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();

  const customer = orderAuthorize_(ss, data.c, data.k);
  if (!customer) throw new Error('このURLでは受け付けられません。お手数ですがメールにてご連絡ください。');

  const qty = boardExtractCount_(data.qty);
  if (qty === '' || Number(qty) <= 0) throw new Error('ご依頼予定数をご入力ください。');

  const detail = orderDetailText_(data);
  if (!detail) throw new Error('ご依頼内容を1つ以上お選びください。');

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const cases = boardListCases_(ss, customer.id);
  const open = orderFindOpenCase_(cases);

  let caseRow;
  let caseId;
  if (open) {
    caseRow = open.caseRow;
    caseId = open.caseId;
  } else {
    const created = boardAppendCase_(ss, {
      customerId: customer.id,
      status: BOARD_STATUS_WAITING_SHIP,
      values: { customer: customer.values[BOARD_CUSTOMER_COL.company - 1] ||
        customer.values[BOARD_CUSTOMER_COL.name - 1] }
    });
    if (!created) throw new Error('いま混み合っています。恐れ入りますが、もう一度お試しください。');
    caseRow = created.row;
    caseId = created.caseId;
  }

  sheet.getRange(caseRow, BOARD_COL.detail).setValue(detail);
  sheet.getRange(caseRow, BOARD_COL.qty).setValue(Number(qty));
  sheet.getRange(caseRow, BOARD_COL.orderedAt).setValue(new Date());
  sheet.getRange(caseRow, BOARD_COL.memo).setValue(String(data.note || '').trim());
  // 契約がまだなら発送に進めない。契約済みなら発送のご連絡待ち
  sheet.getRange(caseRow, BOARD_COL.status).setValue(
    customer.values[BOARD_CUSTOMER_COL.signedAt - 1] ? BOARD_STATUS_WAITING_SHIP : BOARD_STATUS_SIGNING);
  boardSetTodoFormula_(sheet, caseRow);
  boardSetOwnerFormula_(sheet, caseRow);

  boardLog_('依頼フォーム', caseId + ' のご依頼を受け付けました（' + qty + '点／' +
    customer.values[BOARD_CUSTOMER_COL.name - 1] + '）');
  return { ok: true, caseId: caseId };
}

/**
 * ご発送情報を受け付ける。第2段階。ここで依頼が完了する。
 *
 * **契約が済むまで受け付けない。** 未契約のまま商品を預かると、
 * 返送も請求もできない荷物が手元に残る。
 */
function orderSubmitShipping(payload) {
  const data = payload || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();

  const customer = orderAuthorize_(ss, data.c, data.k);
  if (!customer) throw new Error('このURLでは受け付けられません。お手数ですがメールにてご連絡ください。');
  if (!customer.values[BOARD_CUSTOMER_COL.signedAt - 1]) {
    throw new Error('お手続き（カードのご登録と契約書へのご署名）の完了後にご入力いただけます。');
  }

  const carrier = orderFindCarrier_(data.carrier);
  if (!carrier) throw new Error('運送業者をお選びください。');

  const tracking = String(data.tracking || '').replace(/[\s　]/g, '');
  const error = orderCheckTracking_(carrier, tracking);
  if (error) throw new Error(error);

  const open = orderFindOpenCase_(boardListCases_(ss, customer.id));
  if (!open) throw new Error('ご発送前のご依頼が見つかりません。先にご依頼内容をお送りください。');

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  sheet.getRange(open.caseRow, BOARD_COL.carrier).setValue(carrier.name);
  sheet.getRange(open.caseRow, BOARD_COL.tracking).setValue(tracking);
  sheet.getRange(open.caseRow, BOARD_COL.status).setValue(BOARD_STATUS_SHIPPED);
  boardSetTodoFormula_(sheet, open.caseRow);
  boardSetOwnerFormula_(sheet, open.caseRow);

  boardLog_('依頼フォーム', open.caseId + ' の発送情報を受け付けました（' +
    carrier.name + ' ' + tracking + '）');
  return { ok: true, caseId: open.caseId };
}

/** URLの顧客IDと鍵が合っているか。合っていなければ何も返さない。 */
function orderAuthorize_(ss, customerId, formKey) {
  const id = String(customerId || '').trim();
  const key = String(formKey || '').trim();
  if (!id || key.length < ORDER_KEY_LENGTH) return null;

  const found = boardFindCustomerRow_(ss, id);
  if (!found) return null;
  if (String(found.values[BOARD_CUSTOMER_COL.formKey - 1] || '').trim() !== key) {
    boardLog_('②画面', '依頼フォームの鍵が合いません（' + id + '）');
    return null;
  }
  return { id: id, row: found.row, values: found.values };
}

/** まだ発送前のご依頼。あれば書き換え、無ければ新しく作る。 */
function orderFindOpenCase_(cases) {
  const before = [BOARD_STATUS_SIGNING, BOARD_STATUS_WAITING_SHIP];
  return (cases || []).filter(function (c) { return before.indexOf(c.status) >= 0; })[0] || null;
}

/** 画面に出すお客様の登録内容。読むだけで、変更はメールでお願いする。 */
function orderCustomerView_(customer) {
  const v = customer.values;
  const text = function (key) { return String(v[BOARD_CUSTOMER_COL[key] - 1] || ''); };
  return {
    id: customer.id,
    name: text('name'),
    company: text('company'),
    storeName: text('storeName'),
    representative: text('representative'),
    billing: (text('billZip') ? '〒' + text('billZip') + '　' : '') + text('billAddress'),
    returnTo: (text('returnZip') ? '〒' + text('returnZip') + '　' : '') + text('returnAddress'),
    returnName: text('returnName'),
    returnTel: text('returnTel')
  };
}

/** 受付中のご依頼の中身。書き換えるときの初期値に使う。 */
function orderCaseView_(ss, hit) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const v = sheet.getRange(hit.caseRow, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  return {
    caseId: hit.caseId,
    status: hit.status,
    qty: String(v[BOARD_COL.qty - 1] == null ? '' : v[BOARD_COL.qty - 1]),
    note: String(v[BOARD_COL.memo - 1] || ''),
    tracking: String(v[BOARD_COL.tracking - 1] || ''),
    carrier: String(v[BOARD_COL.carrier - 1] || '')
  };
}

/** 発送先のご案内。**契約が済むまで出さない。** */
function orderShipTo_(settings, signed) {
  if (!signed) return null;
  return {
    office: String(settings['営業所名'] || ''),
    officeCode: String(settings['営業所コード'] || ''),
    zip: String(settings['発送先郵便番号'] || ''),
    name: String(settings['発送先宛名'] || ''),
    tel: String(settings['発送先TEL'] || ''),
    item: String(settings['品名'] || '')
  };
}

/**
 * 選択肢。見積もりフォームと同じ設定から作るが、**料金は渡さない**。
 * 依頼フォームは金額を確かめる場ではなく、内容を伝える場。
 */
function orderMenus_() {
  const config = getPublicConfig();
  return (config.menus || []).filter(function (m) { return m.enabled !== false; })
    .map(function (menu) {
      return {
        id: menu.id,
        name: menu.name,
        selectionType: menu.selectionType,
        items: (menu.items || []).filter(function (item) { return item.enabled !== false; })
          .map(function (item) {
            return {
              id: item.id,
              type: item.type,
              name: item.name,
              placeholder: item.placeholder || '',
              subChoiceSelectionType: item.subChoiceSelectionType || 'multiple',
              subChoices: (item.subChoices || []).filter(function (c) { return c.enabled !== false; })
                .map(function (c) { return { id: c.id, name: c.name }; })
            };
          })
      };
    });
}

/**
 * 前回と同じ内容をあらかじめ選んでおくための対応表。
 *
 * 選んだIDは残していないので、**保存してある依頼内容の文章から名前で引き当てる**。
 * 名前が変わっていれば選ばれないだけで、害はない。
 */
function orderPreviousSelection_(hit) {
  const empty = { options: {}, subChoices: {}, texts: {} };
  if (!hit) return empty;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const detail = String(sheet.getRange(hit.caseRow, BOARD_COL.detail).getValue() || '');
  if (!detail) return empty;

  const menus = orderMenus_();
  const picked = { options: {}, subChoices: {}, texts: {} };

  detail.split(String.fromCharCode(10)).forEach(function (line) {
    const clean = boardDetailWithoutPrice_(line).trim();
    if (!clean || clean.indexOf('：') < 0) return;

    const menuName = clean.slice(0, clean.indexOf('：')).trim();
    const rest = clean.slice(clean.indexOf('：') + 1).trim();
    const menu = menus.filter(function (m) { return m.name === menuName; })[0];
    if (!menu) return;

    const parts = rest.split('>');
    const itemName = parts[0].trim();
    const item = menu.items.filter(function (i) { return i.name === itemName; })[0];
    if (!item) return;

    if (!picked.options[menu.id]) picked.options[menu.id] = [];
    if (picked.options[menu.id].indexOf(item.id) < 0) picked.options[menu.id].push(item.id);

    if (parts.length > 1) {
      const names = parts[1].split('、').map(function (n) { return n.trim(); });
      if (!picked.subChoices[menu.id]) picked.subChoices[menu.id] = {};
      picked.subChoices[menu.id][item.id] = item.subChoices
        .filter(function (c) { return names.indexOf(c.name) >= 0; })
        .map(function (c) { return c.id; });
    }
  });

  return picked;
}

/**
 * 選ばれた内容を、案件ボードに残す文章にする。
 * **料金は入れない。** 実際の請求額は数量で変わり、ここに書くと取り違えのもとになる。
 */
function orderDetailText_(data) {
  const menus = orderMenus_();
  const options = data.options || {};
  const subChoices = data.subChoices || {};
  const texts = data.texts || {};
  const lines = [];

  menus.forEach(function (menu) {
    const ids = options[menu.id] || [];
    menu.items.forEach(function (item) {
      if (item.type === 'text') {
        const value = String((texts[menu.id] || {})[item.id] || '').trim();
        if (value) lines.push(menu.name + '：' + item.name + String.fromCharCode(10) + value);
        return;
      }
      if (ids.indexOf(item.id) < 0) return;
      lines.push(menu.name + '：' + item.name);

      const chosen = (subChoices[menu.id] || {})[item.id] || [];
      const names = item.subChoices.filter(function (c) { return chosen.indexOf(c.id) >= 0; })
        .map(function (c) { return c.name; });
      if (names.length > 0) {
        lines.push(menu.name + '：' + item.name + ' > ' + names.join('、'));
      }
    });
  });

  return lines.join(String.fromCharCode(10));
}

/** 運送業者を名前かIDで引く。 */
function orderFindCarrier_(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  return ORDER_CARRIERS.filter(function (c) { return c.id === key || c.name === key; })[0] || null;
}

/**
 * 追跡番号の桁数を確かめる。合わなければ送信させない。
 * **番号違いは、荷物とご依頼を結び付けられなくなる。**
 */
function orderCheckTracking_(carrier, tracking) {
  if (!tracking) return '追跡番号をご入力ください。';
  if (carrier.digits.length === 0) return '';

  const digits = tracking.replace(/-/g, '');
  if (!/^[0-9A-Za-z]+$/.test(digits)) return '追跡番号は数字でご入力ください。';
  if (carrier.digits.indexOf(digits.length) < 0) {
    return carrier.name + 'の追跡番号は' + carrier.digits.join('桁または') +
      '桁です。ご入力の番号は' + digits.length + '桁でした。';
  }
  return '';
}

/** 運送業者に合わせた追跡ページのURL。作業チーム共有に出す。 */
function orderTrackingUrl_(carrierName, tracking) {
  const carrier = orderFindCarrier_(carrierName);
  const digits = String(tracking || '').replace(/[-\s　]/g, '');
  if (!carrier || !carrier.url || !digits) return '';
  return carrier.url + digits;
}
