/**
 * ササゲパス 業務ボード Square 連携
 *
 * 第1段階：既存の請求書の設定を読み取る。
 * 新規作成は、読み取った設定を確認したうえで実装する。
 * この段階では請求書の作成・送信は一切行わない。
 */

const SQUARE_PROP_TOKEN = 'SQUARE_ACCESS_TOKEN';
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';
const SQUARE_API_VERSION = '2025-01-23';
const SQUARE_INVOICE_TITLE = 'サービスご利用における決済情報のご登録とご署名に関するお願い';
const SQUARE_TEMPLATE_TITLE = SQUARE_INVOICE_TITLE;

/**
 * 登録手数料の請求内容。過去の請求書（invoice_number 000014 / 000016 / 000022）から抽出した
 * 実績値をそのまま定数化している。変更するときは Square 側の運用と必ず突き合わせること。
 */
const SQUARE_FEE_ITEM_NAME = '登録手数料';
const SQUARE_FEE_AMOUNT = 200;          // 税抜。消費税10%が加算され合計220円になる
const SQUARE_TAX_NAME = '消費税';
const SQUARE_TAX_PERCENTAGE = '10.0';
const SQUARE_CURRENCY = 'JPY';
const SQUARE_DUE_DAYS = 2;              // 発行日から支払期限までの日数（過去実績と同じ）

/** 過去の請求書のメッセージ欄と完全に同一の文面（空行・全角空白まで一致させている）。 */
function squareInvoiceDescription_() {
  return [
    'ササゲパス運営事務局です。',
    '',
    '',
    'サービスご利用にあたり、お手数ですが下記2点のご対応をお願いいたします。',
    '',
    '1. カード情報の保存について',
    ' 　',
    'メール画面の「カードで支払う」ボタンからお支払い手続きをお願いします。',
    'お手数ですが「Google Pay」ではなく「クレジットカード」を選択し、 ',
    '**「カード情報をササゲパスに保存する 」**に必ずチェックを入れたうえで決済を完了してください。',
    '',
    '　※以降は、毎月のご利用実績に応じて発生したご請求額が、保存いただいたカードから自動的に引き落としされます。',
    '',
    '',
    '2. 契約書へのご署名について',
    ' ',
    'メール画面下部の**「契約書を表示」**より契約書をご確認いただき、内容に問題がなければ電子署名をお願いいたします。',
    '',
    '',
    'ご不明点がございましたらメールにてお気軽にご連絡ください。',
    '今後ともどうぞよろしくお願いいたします。',
    '',
    '',
    'ササゲパス運営事務局'
  ].join('\n');
}

// ------------------------------------------------------------
// アクセストークンの登録
// ------------------------------------------------------------

function squareSetToken() {
  const ui = SpreadsheetApp.getUi();
  const current = squareGetToken_();
  const response = ui.prompt(
    'Square アクセストークンの登録',
    (current ? '現在登録済みです（先頭: ' + current.slice(0, 8) + '…）。\n変更する場合は新しいトークンを、' : 'Square開発者ダッシュボードで発行した本番用トークンを') +
    '\n貼り付けてください。\n\n' +
    '※シートには保存されず、スクリプトの非公開領域に保管されます。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const token = response.getResponseText().trim();
  if (!token) return;
  PropertiesService.getScriptProperties().setProperty(SQUARE_PROP_TOKEN, token);
  boardLog_('Square', 'アクセストークンを登録しました');

  try {
    const locations = squareListLocations_();
    ui.alert('接続できました。\n\n店舗: ' +
      locations.map(function (l) { return l.name + '（' + l.id + '）'; }).join('\n'));
  } catch (err) {
    ui.alert('トークンは保存しましたが、接続に失敗しました。\n\n' + err.message);
  }
}

function squareGetToken_() {
  return PropertiesService.getScriptProperties().getProperty(SQUARE_PROP_TOKEN);
}

// ------------------------------------------------------------
// 既存の請求書を読み取る
// ------------------------------------------------------------

/**
 * 過去の「決済情報のご登録とご署名に関するお願い」請求書を探し、
 * 個人情報を伏せた設定内容を表示する。
 */
function squareInspectTemplate() {
  const ui = SpreadsheetApp.getUi();
  if (!squareGetToken_()) {
    ui.alert('先に「Squareトークンを登録する」を実行してください。');
    return;
  }

  let report;
  try {
    report = squareBuildTemplateReport_();
  } catch (err) {
    ui.alert('読み取りに失敗しました。\n\n' + err.message);
    return;
  }

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:13px;padding:12px">' +
    '<p style="margin:0 0 8px">下の内容をコピーして、Claude Code のチャットに貼り付けてください。' +
    'お客様の氏名・メール・電話番号は伏せてあります。</p>' +
    '<textarea id="t" style="width:100%;height:460px;font-family:monospace;font-size:12px">' +
    report.replace(/</g, '&lt;') + '</textarea>' +
    '<p style="margin:10px 0 0"><button onclick="document.getElementById(\'t\').select();document.execCommand(\'copy\')" ' +
    'style="padding:8px 16px;border:none;border-radius:8px;background:#3B6EF8;color:#fff;font-weight:700;cursor:pointer">' +
    'コピーする</button></p></div>'
  ).setWidth(820).setHeight(620);
  ui.showModalDialog(html, '過去の請求書の設定');
}

function squareBuildTemplateReport_() {
  const locations = squareListLocations_();
  const invoices = squareSearchInvoices_(locations.map(function (l) { return l.id; }), 50);

  const matched = invoices.filter(function (inv) {
    return String(inv.title || '').indexOf(SQUARE_TEMPLATE_TITLE) >= 0;
  });
  const targets = matched.length > 0 ? matched : invoices;

  const lines = [];
  lines.push('# Square 請求書の設定（自動抽出）');
  lines.push('店舗: ' + locations.map(function (l) { return l.name + ' / ' + l.id + ' / ' + l.currency; }).join(' , '));
  lines.push('直近の請求書 ' + invoices.length + ' 件中、タイトル一致 ' + matched.length + ' 件');
  lines.push('');

  targets.slice(0, 3).forEach(function (inv, index) {
    lines.push('## 請求書 ' + (index + 1));
    lines.push(squareDescribeInvoice_(inv));
    lines.push('');
    const order = inv.order_id ? squareGetOrder_(inv.order_id) : null;
    if (order) {
      lines.push('### 明細');
      lines.push(squareDescribeOrder_(order));
      lines.push('');
    }
  });

  return lines.join('\n');
}

function squareDescribeInvoice_(inv) {
  const out = [];
  out.push('title: ' + (inv.title || ''));
  out.push('description: ' + JSON.stringify(inv.description || ''));
  out.push('status: ' + inv.status);
  out.push('delivery_method: ' + inv.delivery_method);
  out.push('scheduled_at: ' + (inv.scheduled_at || '(なし)'));
  out.push('invoice_number: ' + (inv.invoice_number || ''));
  out.push('sale_or_service_date: ' + (inv.sale_or_service_date || '(なし)'));
  out.push('store_payment_method_enabled: ' + inv.store_payment_method_enabled);
  out.push('accepted_payment_methods: ' + JSON.stringify(inv.accepted_payment_methods || {}));
  out.push('custom_fields: ' + JSON.stringify(inv.custom_fields || []));
  out.push('attachments: ' + JSON.stringify((inv.attachments || []).map(function (a) {
    return { filename: a.filename, description: a.description };
  })));

  const recipient = inv.primary_recipient || {};
  out.push('primary_recipient: ' + JSON.stringify({
    customer_id: recipient.customer_id ? '(あり)' : '(なし)',
    given_name: recipient.given_name ? '***' : '',
    email_address: recipient.email_address ? '***' : '',
    phone_number: recipient.phone_number ? '***' : ''
  }));

  out.push('payment_requests: ' + JSON.stringify((inv.payment_requests || []).map(function (p) {
    return {
      request_type: p.request_type,
      due_date: p.due_date,
      tipping_enabled: p.tipping_enabled,
      automatic_payment_source: p.automatic_payment_source,
      card_id: p.card_id ? '(あり)' : undefined,
      reminders: p.reminders,
      fixed_amount_requested_money: p.fixed_amount_requested_money,
      percentage_requested: p.percentage_requested,
      computed_amount_money: p.computed_amount_money
    };
  }), null, 1));

  return out.join('\n');
}

function squareDescribeOrder_(order) {
  return JSON.stringify({
    location_id: order.location_id,
    line_items: (order.line_items || []).map(function (li) {
      return {
        name: li.name,
        quantity: li.quantity,
        base_price_money: li.base_price_money,
        variation_name: li.variation_name,
        note: li.note,
        catalog_object_id: li.catalog_object_id ? '(カタログ品目あり)' : undefined,
        applied_taxes: (li.applied_taxes || []).length
      };
    }),
    taxes: (order.taxes || []).map(function (t) {
      return { name: t.name, percentage: t.percentage, type: t.type, scope: t.scope };
    }),
    discounts: (order.discounts || []).map(function (d) { return { name: d.name, percentage: d.percentage }; }),
    total_money: order.total_money,
    total_tax_money: order.total_tax_money,
    pricing_options: order.pricing_options
  }, null, 1);
}

// ------------------------------------------------------------
// 請求書の作成と送信
// ------------------------------------------------------------

/**
 * 案件に対する登録手数料の請求書を「下書き」として作成する。
 * この時点ではお客様には届かない。内容を確認してから squarePublishForCase で送信する。
 */
function squareCreateDraftForCase(caseRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(caseRow);
  const values = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];

  const existing = String(values[BOARD_COL.invoiceId - 1] || '').trim();
  if (existing) {
    const current = squareGetInvoice_(existing);
    if (current && current.status !== 'CANCELED') {
      return {
        invoiceId: existing,
        status: current.status,
        url: squareDashboardUrl_(existing),
        message: 'この案件にはすでに請求書があります（状態: ' + current.status + '）。'
      };
    }
  }

  const customer = boardFindCustomer_(ss, values[BOARD_COL.customerId - 1]);
  if (!customer || !boardIsEmail_(customer.email)) {
    throw new Error('顧客のメールアドレスが登録されていません。「顧客」タブをご確認ください。');
  }

  const location = squareListLocations_()[0];
  if (!location) throw new Error('Squareの店舗情報を取得できませんでした。');

  const customerId = squareFindOrCreateCustomer_(customer);
  const order = squareCreateFeeOrder_(location.id, customerId);
  const template = boardFindTemplate_(ss, 'S1');
  const today = new Date();

  const invoice = squareFetch_('POST', '/invoices', {
    idempotency_key: Utilities.getUuid(),
    invoice: {
      location_id: location.id,
      order_id: order.id,
      primary_recipient: { customer_id: customerId },
      delivery_method: 'EMAIL',
      title: template ? template.subject : SQUARE_INVOICE_TITLE,
      description: template ? template.body : squareInvoiceDescription_(),
      sale_or_service_date: squareDateString_(today, 0),
      accepted_payment_methods: {
        card: true,
        square_gift_card: false,
        bank_account: false,
        buy_now_pay_later: false,
        cash_app_pay: false
      },
      store_payment_method_enabled: true,
      payment_requests: [{
        request_type: 'BALANCE',
        due_date: squareDateString_(today, SQUARE_DUE_DAYS),
        tipping_enabled: false,
        automatic_payment_source: 'NONE'
      }]
    }
  }).invoice;

  sheet.getRange(row, BOARD_COL.invoiceId).setValue(invoice.id);
  boardLog_('Square', values[BOARD_COL.caseId - 1] + ' の請求書を下書き作成しました（' + invoice.id + '）');

  return {
    invoiceId: invoice.id,
    status: invoice.status,
    url: squareDashboardUrl_(invoice.id),
    message: '請求書を下書きとして作成しました。まだお客様には届いていません。'
  };
}

/** 下書きの請求書を送信する。ここで初めてお客様にメールが届く。 */
function squarePublishForCase(caseRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(caseRow);
  const invoiceId = String(sheet.getRange(row, BOARD_COL.invoiceId).getValue() || '').trim();
  if (!invoiceId) throw new Error('先に請求書を作成してください。');

  const current = squareGetInvoice_(invoiceId);
  if (!current) throw new Error('請求書が見つかりません。');
  if (current.status !== 'DRAFT') {
    return {
      status: current.status,
      url: squareDashboardUrl_(invoiceId),
      message: 'この請求書はすでに送信済みです（状態: ' + current.status + '）。'
    };
  }

  const published = squareFetch_('POST', '/invoices/' + invoiceId + '/publish', {
    version: current.version,
    idempotency_key: Utilities.getUuid()
  }).invoice;

  sheet.getRange(row, BOARD_COL.invoiceSent).setValue(new Date());
  sheet.getRange(row, BOARD_COL.status).setValue(BOARD_STATUS_SIGNING);
  boardSetTodoFormula_(sheet, row);
  boardLog_('Square', invoiceId + ' の請求書を送信しました');

  return {
    status: published.status,
    url: published.public_url || squareDashboardUrl_(invoiceId),
    message: '請求書を送信しました。お客様にメールが届きます。'
  };
}

function squareGetInvoiceStatusForCase(caseRow) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_SHEET_CASES);
  const invoiceId = String(sheet.getRange(Number(caseRow), BOARD_COL.invoiceId).getValue() || '').trim();
  if (!invoiceId) return { invoiceId: '', status: '', url: '' };
  const invoice = squareGetInvoice_(invoiceId);
  return {
    invoiceId: invoiceId,
    status: invoice ? invoice.status : '(取得できません)',
    url: (invoice && invoice.public_url) || squareDashboardUrl_(invoiceId)
  };
}

function squareFindOrCreateCustomer_(customer) {
  const found = squareFetch_('POST', '/customers/search', {
    query: { filter: { email_address: { exact: customer.email } } },
    limit: 1
  });
  if (found.customers && found.customers.length > 0) return found.customers[0].id;

  const created = squareFetch_('POST', '/customers', {
    idempotency_key: Utilities.getUuid(),
    given_name: String(customer.name || '').trim() || undefined,
    company_name: String(customer.company || '').trim() || undefined,
    email_address: customer.email,
    phone_number: String(customer.tel || '').trim() || undefined
  });
  return created.customer.id;
}

function squareCreateFeeOrder_(locationId, customerId) {
  const data = squareFetch_('POST', '/orders', {
    idempotency_key: Utilities.getUuid(),
    order: {
      location_id: locationId,
      customer_id: customerId,
      line_items: [{
        name: SQUARE_FEE_ITEM_NAME,
        quantity: '1',
        base_price_money: { amount: SQUARE_FEE_AMOUNT, currency: SQUARE_CURRENCY },
        applied_taxes: [{ tax_uid: 'fee-tax' }]
      }],
      taxes: [{
        uid: 'fee-tax',
        name: SQUARE_TAX_NAME,
        percentage: SQUARE_TAX_PERCENTAGE,
        type: 'ADDITIVE',
        scope: 'LINE_ITEM'
      }]
    }
  });
  return data.order;
}

function squareGetInvoice_(invoiceId) {
  try {
    return squareFetch_('GET', '/invoices/' + invoiceId).invoice || null;
  } catch (err) {
    boardLog_('Square', '請求書の取得に失敗: ' + err.message);
    return null;
  }
}

function squareDashboardUrl_(invoiceId) {
  return 'https://squareup.com/dashboard/invoices/' + invoiceId;
}

function squareDateString_(base, addDays) {
  const date = new Date(base.getTime());
  date.setDate(date.getDate() + addDays);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ------------------------------------------------------------
// API 呼び出し
// ------------------------------------------------------------

function squareListLocations_() {
  const data = squareFetch_('GET', '/locations');
  return (data.locations || []).map(function (l) {
    return { id: l.id, name: l.name, currency: l.currency };
  });
}

function squareSearchInvoices_(locationIds, limit) {
  const all = [];
  locationIds.forEach(function (locationId) {
    const data = squareFetch_('POST', '/invoices/search', {
      query: {
        filter: { location_ids: [locationId] },
        sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' }
      },
      limit: limit || 20
    });
    (data.invoices || []).forEach(function (inv) { all.push(inv); });
  });
  return all;
}

function squareGetOrder_(orderId) {
  try {
    const data = squareFetch_('GET', '/orders/' + orderId);
    return data.order || null;
  } catch (err) {
    boardLog_('Square', '注文の取得に失敗: ' + err.message);
    return null;
  }
}

function squareFetch_(method, path, payload) {
  const token = squareGetToken_();
  if (!token) throw new Error('Squareのアクセストークンが未登録です。');

  const options = {
    method: method.toLowerCase(),
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Square-Version': SQUARE_API_VERSION
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(SQUARE_API_BASE + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Square APIエラー (' + code + ') ' + path + '\n' + text.slice(0, 500));
  }
  return JSON.parse(text);
}
