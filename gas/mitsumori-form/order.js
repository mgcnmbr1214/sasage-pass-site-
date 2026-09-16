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
  // ここに無い業者は「その他」でお名前をご入力いただく
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
  price: '各メニューの料金や詳細に関して、改めて確認されたい場合はこちらから\n' + ORDER_PRICE_URL,
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
/**
 * 契約済みのお客様に、そろっていない項目があれば記録に残す。
 * **お客様には直していただかない。** こちらからメールで伺う。
 */
function orderWarnMissingProfile_(customer) {
  if (!orderIsRegistered_(customer)) return;
  const missing = orderMissingProfile_(customer);
  if (missing.length === 0) return;
  boardLog_('依頼フォーム', customer.id + ' は契約済みですが、' +
    missing.join('、') + ' が空のままです（お客様側では直せません）');
}

function orderRender_(params) {
  const template = HtmlService.createTemplateFromFile('Order');
  template.customerId = String(params.cid || '').trim();
  template.formKey = String(params.k || '').trim();

  // **最初の1回ぶんの往復を省く。** 画面を出してから改めて中身を聞きに行くと、
  // GASへの往復が2回になり、待ち時間がそのまま倍になる
  let state = null;
  try {
    state = orderGetState(template.customerId, template.formKey);
  } catch (err) {
    state = null;   // 失敗しても画面は出す。あとから聞き直せばよい
  }
  // `<` をそのまま埋めると、文面に </script> が入ったとき画面が壊れる
  template.stateJson = state
    ? JSON.stringify(state).replace(/</g, '\\u003c')
    : 'null';
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
      // 初回だけお客様情報を伺う。そろっていれば読むだけの表示に切り替わる
      profileNeeded: orderProfileNeeded_(customer),
      registered: orderIsRegistered_(customer),
      profileFields: orderProfileForm_(customer),
      // ご依頼の入力に使うのは、まだ発送前の案件だけ
      current: open ? orderCaseView_(ss, open) : null,
      // **状況のご案内は、発送後・作業中・返送済でも出す。**
      // いちばん知りたいのは「いま自分の荷物がどうなっているか」で、
      // それは発送を終えたあとのほうがむしろ知りたい
      progress: (open || latest) ? orderCaseView_(ss, open || latest) : null,
      monthly: orderMonthly_(ss, customer.id, (open || latest) ? (open || latest).caseRow : 0),
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

  // 初回はお客様情報をここで登録する。以降は触らない
  const firstTime = orderProfileNeeded_(customer);
  if (firstTime) orderSaveProfile_(ss, customer, data.profile);
  else orderWarnMissingProfile_(customer);

  sheet.getRange(caseRow, BOARD_COL.detail).setValue(detail);
  // **選ばれた項目のIDを残す。** 依頼内容の文だけでは料金を計算し直せない
  sheet.getRange(caseRow, BOARD_COL.selection).setValue(JSON.stringify({
    options: data.options || {},
    subChoices: data.subChoices || {},
    at: new Date().toISOString()
  }));
  sheet.getRange(caseRow, BOARD_COL.qty).setValue(Number(qty));
  // **送るたびに入れ直す。** 内容を直したなら、待たせている日数もそこから数える
  sheet.getRange(caseRow, BOARD_COL.requestedAt).setValue(new Date());
  // 備考が空のときは消さない。こちらで書いた申し送りが、再送信で消えてしまう
  const note = String(data.note || '').trim();
  if (note) sheet.getRange(caseRow, BOARD_COL.memo).setValue(note);
  // 契約がまだなら発送に進めない。契約済みなら発送のご連絡待ち
  sheet.getRange(caseRow, BOARD_COL.status).setValue(
    customer.values[BOARD_CUSTOMER_COL.signedAt - 1] ? BOARD_STATUS_WAITING_SHIP : BOARD_STATUS_SIGNING);
  boardSetTodoFormula_(sheet, caseRow);
  boardSetOwnerFormula_(sheet, caseRow);

  boardLog_('依頼フォーム', caseId + ' のご依頼を受け付けました（' + qty + '点／' +
    customer.values[BOARD_CUSTOMER_COL.name - 1] + '）');

  priceRefreshUnitPrices_(ss);

  // 初回は契約書と登録手数料の請求書を用意する。**送るのは人が確かめてから**
  if (firstTime) orderPrepareContract_(ss, caseRow, caseId);

  const settings = boardGetSettings_(ss);
  // **お客様への自動返信が先。** こちらへの通知は、送れたかどうかも一緒に知らせる
  const replied = firstTime ? false : orderSendThanks_(ss, settings, caseRow, customer);
  orderNotifyRequest_(ss, settings, customer, {
    caseId: caseId, qty: qty, detail: detail, note: note,
    firstTime: firstTime, replied: replied
  });

  return { ok: true, caseId: caseId, firstTime: firstTime };
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

  // 「その他」はお客様がお名前を書いてくださる。**書かれた名前をそのまま残す。**
  // 「その他」とだけ記録すると、あとから荷物を追えなくなる
  const typed = String(data.carrierOther || '').trim();
  if (carrier.id === 'other' && !typed) throw new Error('運送業者名をご入力ください。');
  const carrierName = carrier.id === 'other' ? typed : carrier.name;

  const tracking = String(data.tracking || '').replace(/[\s　]/g, '');
  const error = orderCheckTracking_(carrier, tracking);
  if (error) throw new Error(error);

  const open = orderFindOpenCase_(boardListCases_(ss, customer.id));
  if (!open) throw new Error('ご発送前のご依頼が見つかりません。先にご依頼内容をお送りください。');

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  sheet.getRange(open.caseRow, BOARD_COL.carrier).setValue(carrierName);
  // 12桁の数字をそのまま入れると 1.23E+11 になる。文字として入れる
  sheet.getRange(open.caseRow, BOARD_COL.tracking).setNumberFormat('@').setValue(tracking);
  boardRefreshTrackingLinks_(sheet.getParent());
  // **数量割引の段は、この日付の月で決まる。** お客様が決める日なので動かせない
  if (!sheet.getRange(open.caseRow, BOARD_COL.shippedAt).getValue()) {
    sheet.getRange(open.caseRow, BOARD_COL.shippedAt).setValue(new Date());
  }
  sheet.getRange(open.caseRow, BOARD_COL.status).setValue(BOARD_STATUS_SHIPPED);
  boardSetTodoFormula_(sheet, open.caseRow);
  boardSetOwnerFormula_(sheet, open.caseRow);

  priceRefreshUnitPrices_(ss);
  boardLog_('依頼フォーム', open.caseId + ' の発送情報を受け付けました（' +
    carrierName + ' ' + tracking + '）');
  return { ok: true, caseId: open.caseId };
}

/**
 * 初回だけお伺いする、お客様の情報。
 *
 * これまでは見積もり回答（T1）に書き並べ、**お客様の返信を読み取って**いた。
 * 書き方がまちまちで取りこぼしが起き、郵便番号のコロンが抜けていただけで
 * 案件が止まったこともある。選んで入れていただく形にすれば、その心配がない。
 *
 * 顧客タブの列と1対1で対応させる。
 */
const ORDER_PROFILE_FIELDS = [
  { key: 'storeName', label: 'ストア名（ご予定のものでも結構です）' },
  // 個人事業主の方は空のことがある。**空でも登録済みとして扱う**
  { key: 'company', label: '会社名（個人事業主の方は不要です）', optional: true },
  { key: 'representative', label: '代表者名義' },
  { key: 'billZip', label: 'ご請求先 郵便番号', zip: 'billAddress' },
  { key: 'billAddress', label: 'ご請求先 住所（都道府県から建物名まで）' },
  { key: 'returnZip', label: '返送先 郵便番号', zip: 'returnAddress' },
  { key: 'returnAddress', label: '返送先 住所（都道府県から建物名まで）' },
  { key: 'returnName', label: '返送先 宛名' },
  { key: 'returnTel', label: '返送先 電話番号' }
];

/**
 * お客様情報の入力欄を出すかどうか。
 *
 * **契約が済んだお客様には出さない。** 請求先や返送先が勝手に書き換わると、
 * 請求も返送も行き先を見失う。見るだけにして、変更はメールで承る。
 *
 * 契約前は、必要な項目がそろうまで出す。会社名は個人事業主の方だと空のことが
 * あるので数えない。実際に、会社名が空だというだけで、契約済みのお客様に
 * 入力欄が出てしまっていた。
 */
function orderProfileNeeded_(customer) {
  if (orderIsRegistered_(customer)) return false;
  return orderMissingProfile_(customer).length > 0;
}

/** 契約書に署名済みか。ここが入っていれば、登録は済んでいる。 */
function orderIsRegistered_(customer) {
  return !!String(customer.values[BOARD_CUSTOMER_COL.signedAt - 1] || '').trim();
}

/** そろっていない項目の名前を返す。会社名は数えない。 */
function orderMissingProfile_(customer) {
  return ORDER_PROFILE_FIELDS.filter(function (f) {
    if (f.optional) return false;
    return !String(customer.values[BOARD_CUSTOMER_COL[f.key] - 1] || '').trim();
  }).map(function (f) { return f.label; });
}

/** 画面に出す初回の入力欄。すでに分かっている項目は初期値として埋めておく。 */
function orderProfileForm_(customer) {
  return ORDER_PROFILE_FIELDS.map(function (f) {
    return {
      key: f.key, label: f.label, zip: f.zip || '',
      value: String(customer.values[BOARD_CUSTOMER_COL[f.key] - 1] || '')
    };
  });
}

/**
 * お客様情報を顧客タブへ保存する。
 *
 * **書き込むのは、そろっていないときの1回だけ。**
 * 一度登録したあとの変更はメールで承る。お客様の操作で
 * 請求先が空になると、請求書が作れなくなる。
 */
function orderSaveProfile_(ss, customer, profile) {
  const data = profile || {};
  const missing = [];
  ORDER_PROFILE_FIELDS.forEach(function (f) {
    if (!String(data[f.key] || '').trim()) missing.push(f.label);
  });
  if (missing.length > 0) {
    throw new Error('次の項目のご入力をお願いいたします。' + '\n' + '・' + missing.join('\n・'));
  }

  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  ORDER_PROFILE_FIELDS.forEach(function (f) {
    sheet.getRange(customer.row, BOARD_CUSTOMER_COL[f.key]).setValue(String(data[f.key]).trim());
  });
  sheet.getRange(customer.row, BOARD_CUSTOMER_COL.updatedAt).setValue(new Date());
  boardLog_('依頼フォーム', customer.id + ' のお客様情報を登録しました');
}

/**
 * 郵便番号から住所を引く。入力の手間と打ち間違いを減らす。
 * 引けなくても入力は止めない。**住所は人が確かめるもの。**
 */
function orderLookupZip(zip) {
  const digits = String(zip || '').replace(/[^0-9]/g, '');
  if (digits.length !== 7) return { ok: false };
  try {
    const res = UrlFetchApp.fetch(
      'https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + digits,
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false };
    const hit = (JSON.parse(res.getContentText()).results || [])[0];
    if (!hit) return { ok: false };
    return { ok: true, address: hit.address1 + hit.address2 + hit.address3 };
  } catch (err) {
    boardLog_('②画面', '郵便番号から住所を引けませんでした: ' + err.message);
    return { ok: false };
  }
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

/**
 * 初回の契約書と登録手数料の請求書を、Squareに下書きとして用意する。
 *
 * **送信まではしない。** お客様に届くものなので、内容を確かめてから人が送る。
 * ここで作っておかないと、こちらが気づくまでお客様が何日も待つことになる。
 * 失敗しても依頼の受付は取り消さない。案件ボードに「請求書を送る」と出る
 */
function orderPrepareContract_(ss, caseRow, caseId) {
  try {
    squareCreateDraftForCase(caseRow);
    boardLog_('依頼フォーム', caseId + ' の登録手数料の請求書を下書き作成しました');
  } catch (err) {
    boardLog_('②エラー', caseId + ' の請求書の下書き作成に失敗: ' + err.message);
  }
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
  const carrier = String(v[BOARD_COL.carrier - 1] || '');
  const tracking = String(v[BOARD_COL.tracking - 1] || '');
  const returned = boardReturnShipments_(ss)[hit.caseId] || {};

  return {
    caseId: hit.caseId,
    status: hit.status,
    qty: String(v[BOARD_COL.qty - 1] == null ? '' : v[BOARD_COL.qty - 1]),
    note: String(v[BOARD_COL.memo - 1] || ''),
    tracking: tracking,
    carrier: carrier,

    // ここから下は進み具合。**分かったところから出る。**
    // 空の欄を並べても不安になるだけなので、値のある行だけ画面に出す
    trackingUrl: orderTrackingUrl_(carrier, tracking),
    shippedAt: boardFormatDate_(v[BOARD_COL.shippedAt - 1]),
    receivedQty: String(v[BOARD_COL.receivedQty - 1] == null ? '' : v[BOARD_COL.receivedQty - 1]),
    shippedQty: String(v[BOARD_COL.shippedQty - 1] == null ? '' : v[BOARD_COL.shippedQty - 1]),
    due: boardFormatDateRange_(v[BOARD_COL.dueFrom - 1], v[BOARD_COL.dueTo - 1]),
    returnTracking: String(returned.tracking || ''),
    returnCarrier: String(returned.carrier || ''),
    returnTrackingUrl: orderTrackingUrl_(returned.carrier, returned.tracking)
  };
}

/**
 * 今月のご利用状況と、数量割引のどの段にいるか。
 *
 * **段は「当月に発送されたぶんのお預かり点数」で決まる。** お客様がご自分で
 * 決められる日で区切るという取り決めなので、ここでも同じ数え方をする。
 * 次の段まであと何点かも一緒に返す。知らないうちに損をしていた、をなくすため。
 */
function orderMonthly_(ss, customerId, caseRow) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const config = getConfig_();
  const now = new Date();
  const month = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();

  let count = 0;
  rows.forEach(function (row) {
    if (String(row[BOARD_COL.customerId - 1] || '').trim() !== customerId) return;
    if (String(row[BOARD_COL.status - 1] || '').trim() === BOARD_STATUS_CLOSED) return;
    if (priceShipMonthOf_(row) !== month) return;
    count += priceCountOf_(row);
  });

  const values = caseRow
    ? sheet.getRange(caseRow, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0]
    : null;
  const selection = values ? priceSelectionOf_(config, values) : null;
  const price = selection && selection.options ? priceUnitPrice_(config, selection, count) : null;

  const here = priceTierFor_(config, count);
  const tiers = ((config.quantityOptions && config.quantityOptions.monthly) || [])
    .filter(function (t) { return t.enabled !== false; })
    .map(function (t) {
      return {
        label: String(t.label || ''),
        from: Number(t.quantity || 0),
        discount: orderTierText_(t, config),
        current: !!here && Number(t.quantity || 0) === Number(here.quantity || 0)
      };
    });
  // **並び順に頼らない。** 段が上から順に並んでいない表でも、
  // 「次の段」はいつも、いまの点数より上でいちばん近いもの
  const next = tiers.filter(function (t) { return t.from > count; })
    .sort(function (a, b) { return a.from - b.from; })[0] || null;

  return {
    monthLabel: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy年M月'),
    count: count,
    unitPrice: price ? price.unitPrice : 0,
    tierLabel: price ? price.tierLabel : '',
    tiers: tiers,
    next: next ? { label: next.label, more: next.from - count, discount: next.discount } : null
  };
}

/** 段ごとの割引の書き方。金額引きと率引きで言い方が変わる。 */
function orderTierText_(tier, config) {
  if (!tier || tier.discountType === 'none') return '通常料金';
  if (tier.discountType === 'amount') {
    const amount = Math.max(0, Number(tier.discountAmount || 0));
    return amount ? '1点あたり ' + formatYen_(amount, config) + ' 引き' : '通常料金';
  }
  const rate = Math.max(0, Number(tier.discountRate || 0));
  return rate ? Math.round(rate * 100) + '% 引き' : '通常料金';
}

/** 発送先のご案内。**契約が済むまで出さない。** */
function orderShipTo_(settings, signed) {
  if (!signed) return null;
  const zip = String(settings['発送先郵便番号'] || '');
  const tel = String(settings['発送先TEL'] || '');
  const item = String(settings['品名'] || '');

  return {
    // ヤマト運輸は営業所止め。こちらの都合で受け取りに行けるので、いちばん早い
    yamato: {
      title: 'ご発送先（ヤマト運輸「営業所止め」）',
      rows: [
        ['営業所コード', String(settings['営業所コード'] || '')],
        ['営業所名', String(settings['営業所名'] || '')],
        ['郵便番号', zip ? '〒' + zip : ''],
        ['宛名', String(settings['発送先宛名'] || '')],
        ['電話番号', tel],
        ['品名', item]
      ]
    },
    // **営業所止めはヤマトにしかない。** 書いていないとお客様が止まって聞き直す
    other: {
      title: 'ご発送先（ヤマト運輸以外）',
      rows: [
        ['郵便番号', zip ? '〒' + zip : ''],
        ['住所', String(settings['ヤマト以外の発送先住所'] || '')],
        ['宛名', String(settings['ヤマト以外の発送先宛名'] || '')],
        ['電話番号', tel],
        ['品名', item]
      ]
    },
    note: 'ヤマト運輸のほうが受け取り・検品が早く進むため、先に受付をさせていただくことがございます。'
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

  // **控えがあれば、そちらを使う。** 依頼内容の文から名前で探す方法は、
  // 依頼内容が空のときや、メニュー名を変えたあとでは何も選べない
  const saved = String(sheet.getRange(hit.caseRow, BOARD_COL.selection).getValue() || '').trim();
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.options && Object.keys(parsed.options).length > 0) {
        return {
          options: parsed.options,
          subChoices: parsed.subChoices || {},
          texts: parsed.texts || {}
        };
      }
    } catch (err) {
      // 壊れていれば、下の文からの読み取りに任せる
    }
  }

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
/**
 * ご依頼を受け付けたことを、お客様へ自動で返す（T10）。
 *
 * **依頼内容を送っただけでは終わらない**ことを、その場でお伝えする。
 * 済んだと思われると、荷物が届かないまま日が過ぎる。
 * T4と同じく、AIは通さず定型文をそのまま送る。設定で止められる。
 *
 * **初回のお客様には送らない。** 契約がまだで発送に進めないため、
 * 先に届くのはSquareのお手続きのご案内になる。
 */
function orderSendThanks_(ss, settings, caseRow, customer) {
  if (String(settings['依頼受付の自動返信'] || 'オン').trim() === 'オフ') return false;
  if (!boardIsEmail_(customer.values[BOARD_CUSTOMER_COL.email - 1])) return false;

  const email = String(customer.values[BOARD_CUSTOMER_COL.email - 1] || '').trim();
  let built;
  try {
    built = boardBuildTemplateText_(ss, caseRow, 'T10');
  } catch (err) {
    boardLog_('依頼フォーム', 'ご依頼の自動返信を作れませんでした: ' + err.message);
    return false;
  }

  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  try {
    GmailApp.sendEmail(email, built.subject, built.body, options);
  } catch (err) {
    boardLog_('依頼フォーム', 'ご依頼の自動返信の送信に失敗: ' + err.message);
    return false;
  }

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  sheet.getRange(caseRow, BOARD_COL.lastContact).setValue(new Date());
  mailAppendHistory_(ss, {
    customerId: customer.id,
    from: email,
    subject: built.subject,
    summary: '依頼フォームでご依頼を受け付けたため、自動で送信しました。',
    aiFirst: built.body,
    finalText: built.body,
    status: MAIL_STATUS_SENT,
    threadId: ''
  });
  boardLog_('依頼フォーム', email + ' へご依頼受付のご連絡を自動送信しました');
  return true;
}

/**
 * ご依頼が届いたことを、こちらへ知らせる。
 *
 * 依頼フォームからのご依頼は、メールでも「対応を選ぶ」でも気づけない。
 * 案件ボードを見に行かないと分からないので、ここで一報を入れる。
 * **初回のお客様だけは、こちらに送る手続きがある**ので件名を変える。
 */
function orderNotifyRequest_(ss, settings, customer, info) {
  if (String(settings['依頼フォームの通知'] || 'オン').trim() === 'オフ') return false;
  const to = String(settings['通知先メールアドレス'] || '').trim();
  if (!to) return false;

  const who = String(customer.values[BOARD_CUSTOMER_COL.company - 1] ||
    customer.values[BOARD_CUSTOMER_COL.name - 1] ||
    customer.values[BOARD_CUSTOMER_COL.email - 1] || '').trim();
  const NL2 = String.fromCharCode(10);

  const lines = [
    who + ' 様から、依頼フォームでご依頼がありました。',
    '',
    '　案件ID　　：' + info.caseId,
    '　ご依頼点数：' + info.qty + '点',
    '　ご依頼内容：' + String(info.detail || '').split(NL2).join(NL2 + '　　　　　　　'),
  ];
  if (info.note) lines.push('　備考　　　：' + String(info.note).split(NL2).join(NL2 + '　　　　　　　'));

  lines.push('');
  if (info.firstTime) {
    lines.push('■ 初回のお客様です。こちらの対応があります。');
    lines.push('　契約書と登録手数料の請求書を下書きで用意しました。');
    lines.push('　内容を確かめて送信してください。');
    lines.push('　　→ メニュー「ササゲパス」→「別途対応メニュー」→「初回登録の請求書だけを作成・送信する」');
  } else {
    lines.push('■ この時点でこちらの対応はありません。');
    lines.push('　お客様のご発送と追跡番号のご連絡をお待ちください。');
    lines.push(info.replied
      ? '　ご発送のお願いは、お客様へ自動でお送りしました。'
      : '　※ ご発送のお願いの自動返信は送られていません（設定がオフか、送信に失敗しました）。');
  }

  lines.push('');
  lines.push('案件ボード：');
  lines.push(ss.getUrl());

  try {
    MailApp.sendEmail({
      to: to,
      subject: (info.firstTime ? '【要対応】' : '【ご依頼】') + who +
        ' ─ ' + info.caseId + '（' + info.qty + '点）',
      body: lines.join(NL2),
      name: 'ササゲパス業務ボード'
    });
  } catch (err) {
    boardLog_('依頼フォーム', 'ご依頼の通知を送れませんでした: ' + err.message);
    return false;
  }
  return true;
}

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
