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
  boardUseCurrentColumns_();
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

/** 手続き画面を開く。案件ボードで行を選んでから実行する。 */
function squareOpenFlow() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== BOARD_SHEET_CASES) {
    SpreadsheetApp.getUi().alert('「案件ボード」タブで、対象の案件の行を選んでから実行してください。');
    return;
  }
  const row = sheet.getActiveRange().getRow();
  if (row < 2 || !sheet.getRange(row, BOARD_COL.caseId).getValue()) {
    SpreadsheetApp.getUi().alert('案件の行を選んでから実行してください。');
    return;
  }
  PropertiesService.getUserProperties().setProperty('BOARD_ACTIVE_ROW', String(row));
  const html = HtmlService.createTemplateFromFile('SquareFlow').evaluate().setWidth(780).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, '初回登録の請求書を送る');
}

/** 手続き画面に出す現在の状態。4段階のどこまで進んでいるかを返す。 */
function squareGetFlowState() {
  boardUseCurrentColumns_();
  const row = Number(PropertiesService.getUserProperties().getProperty('BOARD_ACTIVE_ROW') || 0);
  if (!row) throw new Error('案件が選択されていません。');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const values = sheet.getRange(row, 1, 1, BOARD_CASE_HEADERS.length).getValues()[0];
  const customer = boardFindCustomer_(ss, values[BOARD_COL.customerId - 1]);
  const settings = boardGetSettings_(ss);
  const invoiceId = String(values[BOARD_COL.invoiceId - 1] || '').trim();
  const invoice = invoiceId ? squareGetInvoice_(invoiceId) : null;

  return {
    row: row,
    caseId: values[BOARD_COL.caseId - 1],
    status: values[BOARD_COL.status - 1],
    customerName: (customer && (customer.company || customer.name)) || values[BOARD_COL.customer - 1],
    customerEmail: customer ? customer.email : '',
    squareCustomerId: customer ? customer.squareId : '',
    invoiceId: invoiceId,
    invoiceStatus: invoice ? invoice.status : '',
    invoiceUrl: invoiceId ? squareDashboardUrl_(invoiceId) : '',
    invoiceSteps: String(settings['請求書送信の手順'] || ''),
    sentAt: boardFormatDate_(values[BOARD_COL.invoiceSent - 1])
  };
}

const SQUARE_SIGN_SENDER = 'noreply@messaging.squareup.com';
const SQUARE_SIGN_KEYWORD = '署名されました';
/** 件名の言い回しが変わっても拾えるよう、本文側の手がかりも見る。 */
const SQUARE_SIGN_KEYWORD_ALT = '署名済みの契約書';
const SQUARE_SIGN_LOOKBACK_DAYS = 90;
/** 署名とカードを見に行く間隔。毎回だとGmailとSquareを無駄に叩く。 */
const SQUARE_REGISTRATION_CHECK_HOURS = 6;

/**
 * 「支払い情報登録・契約書署名待ち」の案件について、
 * 220円の支払いと契約書への署名がそろったかを確認する。
 *
 * 支払いは Square の請求書ステータス、署名は Square から届く
 * 「契約書番号◯◯が◯◯様によって署名されました」のメールで判定する。
 * 両方そろった案件だけ、署名・支払確認日を記録して連絡を促す。
 */
/**
 * お客様ごとの「契約書署名日」と「カード登録」を最新にする。
 *
 * **Squareに契約書のAPIは無い。** 開発者フォーラムで2021年から要望が出ているが、
 * 実装されていない。webhookにも契約や署名の種類は無い。
 * そのため署名はSquareからの通知メールで見つけるしかない。
 *
 * ただし**見つけた日付は顧客タブに残す**。メールは90日で検索から外れるが、
 * 記録が残っていれば、そのあとも署名済みだと分かる。
 * Squareの画面で確認した日付を手で入れてもよい。**メールは見つけるきっかけにすぎない。**
 *
 * カードのほうはAPIで直接分かる。期限切れや無効化も読み取れる。
 */
function squareRefreshRegistrations(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(BOARD_SHEET_CUSTOMERS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CUSTOMER_HEADERS.length).getValues();
  const now = new Date();
  const due = now.getTime() - SQUARE_REGISTRATION_CHECK_HOURS * 3600 * 1000;
  let changed = 0;

  rows.forEach(function (row, i) {
    const email = String(row[BOARD_CUSTOMER_COL.email - 1] || '').trim();
    if (!boardIsEmail_(email)) return;

    // 毎回すべて問い合わせると、GmailもSquareも無駄に叩く
    const checkedAt = row[BOARD_CUSTOMER_COL.checkedAt - 1];
    if (checkedAt instanceof Date && checkedAt.getTime() > due) return;

    const customer = {
      email: email,
      name: row[BOARD_CUSTOMER_COL.name - 1],
      squareId: String(row[BOARD_CUSTOMER_COL.squareId - 1] || '').trim()
    };

    // 署名日はまだ分かっていないときだけ探す。一度入れたら上書きしない
    if (!row[BOARD_CUSTOMER_COL.signedAt - 1]) {
      const signedAt = squareFindSignedDate_(customer);
      if (signedAt) {
        sheet.getRange(i + 2, BOARD_CUSTOMER_COL.signedAt).setValue(signedAt);
        boardLog_('Square', row[BOARD_CUSTOMER_COL.id - 1] + ' の契約書署名を確認しました（' +
          Utilities.formatDate(signedAt, Session.getScriptTimeZone(), 'yyyy/MM/dd') + '）');
        changed++;
      }
    }

    const label = squareCardLabel_(customer.squareId);
    if (label !== String(row[BOARD_CUSTOMER_COL.card - 1] || '')) {
      sheet.getRange(i + 2, BOARD_CUSTOMER_COL.card).setValue(label);
      boardLog_('Square', row[BOARD_CUSTOMER_COL.id - 1] + ' のカード登録: ' + (label || 'なし'));
      changed++;
    }
    sheet.getRange(i + 2, BOARD_CUSTOMER_COL.checkedAt).setValue(now);
  });

  return changed;
}

/**
 * 保存されたカードの表示。無ければ空。
 * **有効期限も出す。** 期限が切れると月々の請求が止まるが、
 * 止まってから気づいたのでは遅い。
 */
function squareCardLabel_(squareCustomerId) {
  if (!squareCustomerId) return '';
  let card;
  try {
    card = squareFindCardOnFile_(squareCustomerId);
  } catch (err) {
    boardLog_('Square', 'カードの確認に失敗: ' + err.message);
    return '';
  }
  if (!card) return '';

  const month = Number(card.exp_month || 0);
  const year = Number(card.exp_year || 0);
  const expiry = month && year
    ? year + '/' + (month < 10 ? '0' + month : month) + 'まで'
    : '有効期限不明';
  return String(card.card_brand || 'カード') + ' ****' + String(card.last_4 || '????') +
    '（' + expiry + '）';
}

function squareCheckCompletions() {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const settings = boardGetSettings_(ss);
  let done = 0;

  rows.forEach(function (row, i) {
    if (String(row[BOARD_COL.status - 1] || '').trim() !== BOARD_STATUS_SIGNING) return;
    if (row[BOARD_COL.signedAt - 1]) return;

    const customer = boardFindCustomer_(ss, row[BOARD_COL.customerId - 1]);
    if (!customer || !boardIsEmail_(customer.email)) return;

    const caseId = row[BOARD_COL.caseId - 1];
    const invoiceId = squareResolveInvoiceId_(ss, i + 2, row, customer);
    if (!invoiceId) {
      boardLog_('Square', caseId + '：Squareに請求書が見つからないため確認できません（' + customer.email + '）');
      return;
    }

    const invoice = squareGetInvoice_(invoiceId);
    const paid = invoice && (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID');
    // 顧客タブに残した署名日を先に見る。手で入れた日付もここで効く
    const signedAt = customer.signedAt instanceof Date
      ? customer.signedAt : squareFindSignedDate_(customer);

    if (!paid || !signedAt) {
      boardLog_('Square', caseId + '：支払い ' +
        (invoice ? invoice.status : '取得できず') + ' ／ 署名 ' +
        (signedAt ? '確認済み' : '未確認') + ' のため、まだ完了としません');
      return;
    }

    sheet.getRange(i + 2, BOARD_COL.signedAt).setValue(signedAt);
    sheet.getRange(i + 2, BOARD_COL.status).setValue('発送待ち');
    boardSetTodoFormula_(sheet, i + 2);
    boardSetOwnerFormula_(sheet, i + 2);
    boardLog_('Square', caseId + ' の支払いと署名を確認しました');

    const sent = squareSendCompletionMail_(ss, settings, i + 2, customer);
    squareNotifyCompletion_(settings, caseId, customer, ss.getUrl(), sent);
    done++;
  });

  return done;
}

/**
 * 案件に紐づく請求書IDを求める。
 * Squareの画面で直接作った請求書は案件に記録が無いため、
 * その場合は顧客をたどってSquare側から探し、見つかれば案件へ書き戻す。
 */
function squareResolveInvoiceId_(ss, caseRow, row, customer) {
  const stored = String(row[BOARD_COL.invoiceId - 1] || '').trim();
  if (stored) return stored;

  const squareCustomerId = customer.squareId || squareFindCustomerId_(customer.email);
  if (!squareCustomerId) return '';
  if (!customer.squareId && customer.row) {
    ss.getSheetByName(BOARD_SHEET_CUSTOMERS)
      .getRange(customer.row, BOARD_CUSTOMER_COL.squareId).setValue(squareCustomerId);
  }

  const invoice = squareFindInvoiceForCustomer_(squareCustomerId);
  if (!invoice) return '';

  ss.getSheetByName(BOARD_SHEET_CASES).getRange(caseRow, BOARD_COL.invoiceId).setValue(invoice.id);
  boardLog_('Square', row[BOARD_COL.caseId - 1] + ' の請求書 ' + invoice.id + ' を紐づけました');
  return invoice.id;
}

/** メールアドレスからSquareの顧客を探す。見つからなくても作成はしない。 */
function squareFindCustomerId_(email) {
  try {
    const found = squareFetch_('POST', '/customers/search', {
      query: { filter: { email_address: { exact: email } } },
      limit: 1
    });
    return found.customers && found.customers.length > 0 ? found.customers[0].id : '';
  } catch (err) {
    boardLog_('Square', '顧客の検索に失敗: ' + err.message);
    return '';
  }
}

/** その顧客宛の、登録手数料の請求書のうち最も新しいもの。 */
function squareFindInvoiceForCustomer_(squareCustomerId) {
  try {
    const locations = squareListLocations_();
    const data = squareFetch_('POST', '/invoices/search', {
      query: {
        filter: {
          location_ids: locations.map(function (l) { return l.id; }),
          customer_ids: [squareCustomerId]
        },
        sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' }
      },
      limit: 20
    });
    const invoices = data.invoices || [];
    const matched = invoices.filter(function (inv) {
      return String(inv.title || '').indexOf(SQUARE_INVOICE_TITLE) >= 0;
    });
    return (matched[0] || invoices[0]) || null;
  } catch (err) {
    boardLog_('Square', '請求書の検索に失敗: ' + err.message);
    return null;
  }
}

function squareIsInvoicePaid_(invoiceId) {
  if (!invoiceId) return false;
  const invoice = squareGetInvoice_(invoiceId);
  if (!invoice) return false;
  return invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID';
}

/**
 * 署名完了メールを探す。
 *
 * 契約書はSquare上の顧客に対して発行されるため、業務ボードに登録している
 * 連絡先とメールアドレスが違うことがある。そのためSquare側の顧客情報も
 * 手がかりに加え、メールアドレスか氏名のどちらかが一致すれば対象とする。
 */
function squareFindSignedDate_(customer) {
  const keys = squareIdentityKeys_(customer);
  if (keys.length === 0) return null;

  const query = 'from:' + SQUARE_SIGN_SENDER +
    ' ("' + SQUARE_SIGN_KEYWORD + '" OR "' + SQUARE_SIGN_KEYWORD_ALT + '")' +
    ' newer_than:' + SQUARE_SIGN_LOOKBACK_DAYS + 'd';
  let threads;
  try {
    threads = GmailApp.search(query, 0, 50);
  } catch (err) {
    boardLog_('Square', '署名メールの検索に失敗: ' + err.message);
    return null;
  }

  let latest = null;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (String(message.getFrom() || '').indexOf(SQUARE_SIGN_SENDER) < 0) return;
      const subject = String(message.getSubject() || '');
      const body = String(message.getBody() || '');
      // 件名の言い回しが変わっても、本文の手がかりで拾えるようにする
      if (subject.indexOf(SQUARE_SIGN_KEYWORD) < 0 && body.indexOf(SQUARE_SIGN_KEYWORD_ALT) < 0) return;

      const haystack = squareNormalizeIdentity_(subject + ' ' + body);
      const hit = keys.some(function (key) { return haystack.indexOf(key) >= 0; });
      if (!hit) return;
      if (!latest || message.getDate() > latest) latest = message.getDate();
    });
  });
  return latest;
}

/** その顧客を見分けるための文字列。メールアドレスと氏名。 */
function squareIdentityKeys_(customer) {
  const keys = [];
  const add = function (value) {
    const key = squareNormalizeIdentity_(value);
    if (key.length >= 3 && keys.indexOf(key) < 0) keys.push(key);
  };

  add(customer.email);
  add(customer.name);

  if (customer.squareId) {
    const remote = squareGetCustomer_(customer.squareId);
    if (remote) {
      add(remote.email_address);
      add(String(remote.family_name || '') + String(remote.given_name || ''));
      add(String(remote.given_name || '') + String(remote.family_name || ''));
      add(remote.company_name);
    }
  }
  return keys;
}

function squareNormalizeIdentity_(text) {
  return String(text || '').toLowerCase().replace(/[\s　]/g, '');
}

function squareGetCustomer_(customerId) {
  try {
    return squareFetch_('GET', '/customers/' + customerId).customer || null;
  } catch (err) {
    boardLog_('Square', '顧客の取得に失敗: ' + err.message);
    return null;
  }
}

/**
 * 手続き完了のご連絡（T4）をお客様へ送る。
 *
 * このシステムで唯一、下書きを挟まずに自動送信する処理。
 * 定型文をそのまま使い、AIは通さない。設定で止められる。
 */
function squareSendCompletionMail_(ss, settings, caseRow, customer) {
  if (String(settings['手続き完了の自動送信'] || 'オン').trim() === 'オフ') return false;
  if (!boardIsEmail_(customer.email)) return false;

  let built;
  try {
    built = boardBuildTemplateText_(ss, caseRow, 'T4');
  } catch (err) {
    boardLog_('Square', '手続き完了のご連絡を作れませんでした: ' + err.message);
    return false;
  }

  const options = { name: 'ササゲパス' };
  const alias = settings['送信元エイリアス'];
  if (alias && GmailApp.getAliases().indexOf(alias) >= 0) options.from = alias;

  try {
    GmailApp.sendEmail(customer.email, built.subject, built.body, options);
  } catch (err) {
    boardLog_('Square', '手続き完了のご連絡の送信に失敗: ' + err.message);
    return false;
  }

  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  sheet.getRange(caseRow, BOARD_COL.lastContact).setValue(new Date());
  mailAppendHistory_(ss, {
    customerId: sheet.getRange(caseRow, BOARD_COL.customerId).getValue(),
    from: customer.email,
    subject: built.subject,
    summary: '支払いと署名の確認後、自動で送信しました。',
    aiFirst: built.body,
    finalText: built.body,
    status: MAIL_STATUS_SENT,
    threadId: ''
  });
  boardLog_('Square', customer.email + ' へ手続き完了のご連絡を送信しました');
  return true;
}

function squareNotifyCompletion_(settings, caseId, customer, sheetUrl, sentMail) {
  const to = String(settings['通知先メールアドレス'] || '').trim();
  if (!to) return;
  const name = customer.company || customer.name || customer.email;
  MailApp.sendEmail({
    to: to,
    subject: '【ご報告】' + name + ' ─ お支払いと署名が完了しました',
    body: [
      caseId + '　' + name + ' 様',
      '',
      '220円のお支払いと、契約書へのご署名がどちらも確認できました。',
      'ステータスを「発送待ち」に進めています。',
      '',
      sentMail
        ? '「手続き完了のご連絡」をお客様へ自動送信しました（発送のご案内済み）。'
        : '※「手続き完了のご連絡」は送信していません。設定またはログをご確認ください。',
      '',
      'このあとお客様から商品が発送されると、',
      'メールの内容から自動で「発送済み」に切り替わり、',
      '作業チームへの共有内容が案件ボードにまとまります。',
      '',
      sheetUrl
    ].join('\n'),
    name: 'ササゲパス業務ボード'
  });
}

/** 手順2: 実際に送信されたかを Square 側の状態で確認し、記録する。 */
function squareConfirmSent(caseRow) {
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const row = Number(caseRow);
  const invoiceId = String(sheet.getRange(row, BOARD_COL.invoiceId).getValue() || '').trim();
  if (!invoiceId) throw new Error('先に請求書を作成してください。');

  const invoice = squareGetInvoice_(invoiceId);
  if (!invoice) throw new Error('請求書の状態を取得できませんでした。');
  if (invoice.status === 'DRAFT') {
    throw new Error('この請求書はまだ下書きのままです。\nSquareの画面で送信を完了してから、もう一度押してください。');
  }

  sheet.getRange(row, BOARD_COL.invoiceSent).setValue(new Date());
  sheet.getRange(row, BOARD_COL.status).setValue(BOARD_STATUS_SIGNING);
  boardSetTodoFormula_(sheet, row);
  boardLog_('Square', invoiceId + ' の送信を確認しました（状態: ' + invoice.status + '）');
  return { message: '送信を確認しました。ステータスを「' + BOARD_STATUS_SIGNING + '」に更新しました。' };
}

/**
 * 案件に対する登録手数料の請求書を「下書き」として作成する。
 * この時点ではお客様には届かない。契約書を添付したうえで Square 画面から送信する。
 */
function squareCreateDraftForCase(caseRow) {
  boardUseCurrentColumns_();
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

  const customerId = squareEnsureCustomer_(ss, customer);
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
  boardUseCurrentColumns_();
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
  boardUseCurrentColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const invoiceId = squareVerifyInvoiceId_(ss, Number(caseRow));
  if (!invoiceId) return { invoiceId: '', status: '', url: '' };
  const invoice = squareGetInvoice_(invoiceId);
  return {
    invoiceId: invoiceId,
    status: invoice ? invoice.status : '(取得できません)',
    url: (invoice && invoice.public_url) || squareDashboardUrl_(invoiceId)
  };
}

/**
 * 案件に記録された請求書がSquare側にまだあるか確かめる。
 * 消された請求書のIDが残っていると新しく作れなくなるため、
 * 見つからなければ記録を外して作り直せるようにする。
 */
function squareVerifyInvoiceId_(ss, caseRow) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  const invoiceId = String(sheet.getRange(caseRow, BOARD_COL.invoiceId).getValue() || '').trim();
  if (!invoiceId) return '';
  if (!squareGetToken_()) return invoiceId;

  const invoice = squareGetInvoice_(invoiceId);
  if (invoice && invoice.status !== 'CANCELED') return invoiceId;

  sheet.getRange(caseRow, BOARD_COL.invoiceId).setValue('');
  boardLog_('Square', sheet.getRange(caseRow, BOARD_COL.caseId).getValue() +
    '：Squareに請求書が無いため記録を外しました（' + invoiceId + '）');
  return '';
}

/**
 * 顧客タブの内容を Square の顧客の形にする。
 *
 * **氏名は「代表者名義」を使う。** 請求と契約書の名義になるため、
 * 窓口の担当者名ではなく代表者を載せる。空のときだけ担当者名で代用する。
 *
 * 姓と名は分けて持っていないため、空白があればそこで分け、無ければ姓に入れる。
 * 日本語の氏名は姓に入れたほうが「川越蘭子 様」と自然に並ぶ。
 */
function squareCustomerPayload_(customer) {
  const name = String(customer.representative || '').trim() || String(customer.name || '').trim();
  const parts = name.split(/[\s　]+/).filter(function (p) { return p; });

  // 姓と名は必ず両方を送る。片方を省くと Square は前の値を残すため、
  // 「姓 川越健太／名 川越健太」のように古い名前が居座る
  const payload = {
    family_name: parts.length > 1 ? parts[0] : name,
    given_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
    email_address: customer.email
  };

  // ここから下はシートが空なら送らない。Square側で手入力した値を消さないため
  const company = String(customer.company || '').trim();
  if (company) payload.company_name = company;
  const phone = squarePhone_(customer.tel);
  if (phone) payload.phone_number = phone;
  const address = squareAddress_(customer.billZip, customer.billAddress);
  if (address) payload.address = address;
  return payload;
}

/** 「2360031」「236-0031」どちらでも 236-0031 の形にそろえる。 */
function squareZip_(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length !== 7) return String(value || '').trim() || undefined;
  return digits.slice(0, 3) + '-' + digits.slice(3);
}

/** 先頭の0が落ちた電話番号を戻す。Squareは形式に厳しいため数字だけにする。 */
function squarePhone_(value) {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  // シートが数値として持つと先頭の0が消える（07012634540 → 7012634540）
  if (digits.length === 9 || digits.length === 10) digits = '0' + digits;
  return digits;
}

/** 「神奈川県横浜市金沢区六浦3-20-3-101」を都道府県と残りに分ける。 */
function squareAddress_(zip, line) {
  const text = String(line || '').trim();
  const postal = squareZip_(zip);
  if (!text && !postal) return null;

  const m = text.match(/^(.{2,3}?[都道府県])(.*)$/);
  return {
    address_line_1: (m ? m[2] : text).trim() || undefined,
    administrative_district_level_1: m ? m[1] : undefined,
    postal_code: postal,
    country: 'JP'
  };
}

/**
 * Square の顧客を用意する。
 *
 * **すでにある顧客も毎回更新する。** 見つかったらそのまま使う作りだと、
 * 住所や会社名を後から聞き出しても Square 側が空のままになる。
 */
/**
 * 請求書を作る前に、Square の顧客をシートの内容に合わせる。
 *
 * すでに顧客IDを持っていても**毎回書き戻す**。
 * 住所や会社名はあとからお客様に伺って埋まるため、
 * 作ったときのまま放置すると Square 側だけ古い（空の）状態で残る。
 */
function squareEnsureCustomer_(ss, customer) {
  if (customer.squareId) {
    try {
      squareFetch_('PUT', '/customers/' + customer.squareId, squareCustomerPayload_(customer));
    } catch (err) {
      boardLog_('Square', customer.email + ' の顧客情報を更新できませんでした: ' + err.message);
    }
    return customer.squareId;
  }

  const id = squareFindOrCreateCustomer_(customer);
  ss.getSheetByName(BOARD_SHEET_CUSTOMERS)
    .getRange(customer.row, BOARD_CUSTOMER_COL.squareId).setValue(id);
  return id;
}

function squareFindOrCreateCustomer_(customer) {
  const payload = squareCustomerPayload_(customer);
  const found = squareFetch_('POST', '/customers/search', {
    query: { filter: { email_address: { exact: customer.email } } },
    limit: 1
  });

  if (found.customers && found.customers.length > 0) {
    const id = found.customers[0].id;
    try {
      squareFetch_('PUT', '/customers/' + id, payload);
    } catch (err) {
      boardLog_('Square', customer.email + ' の顧客情報を更新できませんでした: ' + err.message);
    }
    return id;
  }

  const created = squareFetch_('POST', '/customers', Object.assign(
    { idempotency_key: Utilities.getUuid() }, payload
  ));
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

// ------------------------------------------------------------
// 月々のご利用料金の請求
// ------------------------------------------------------------

/**
 * 未請求の返送をお客様ごとにまとめ、Squareに請求書の下書きを作る。
 *
 * **月で区切らず「未請求かどうか」で拾う。** 先月請求し忘れた返送も自動的に含まれる。
 * 送信はSquareの画面で内容を確かめてから行っていただく。
 */
function squareCreateMonthlyInvoices() {
  boardUseCurrentColumns_();
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!squareGetToken_()) {
    ui.alert('Squareのアクセストークンが未登録です。\n設定メニューから登録してください。');
    return;
  }

  const month = squareBillingMonth_(new Date());
  const groups = squareCollectBillable_(ss);
  const ids = Object.keys(groups);
  if (ids.length === 0) {
    ui.alert('請求の対象になる返送がありません。\n\n' +
      '「返送開始のお知らせ」を送ると対象になります。下書きのままでは対象外です。');
    return;
  }

  const answer = ui.alert('今月の請求書を作成',
    month.label + 'として、' + ids.length + ' 件の請求書の下書きをSquareに作ります。\n' +
    '支払い期限は ' + Utilities.formatDate(month.due, Session.getScriptTimeZone(), 'yyyy年M月d日') + ' です。\n\n' +
    '下書きを作るだけで、送信はSquareの画面で行います。よろしいですか？',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  const location = squareListLocations_()[0];
  if (!location) {
    ui.alert('Squareの店舗情報を取得できませんでした。');
    return;
  }

  const done = [];
  const skipped = [];
  ids.forEach(function (customerId) {
    try {
      const result = squareCreateInvoiceFor_(ss, location, month, customerId, groups[customerId]);
      done.push(result.customer + '　' + result.qty + '点　' + squareYen_(result.amount));
    } catch (err) {
      skipped.push(groups[customerId].customer + '：' + err.message);
      boardLog_('請求', groups[customerId].customer + ' の請求書を作れませんでした: ' + err.message);
    }
  });

  boardRefreshUnbilled_(ss);
  boardLog_('請求', month.label + '：' + done.length + ' 件の請求書を作成しました');

  ui.alert('今月の請求書を作成',
    month.label + '\n\n' +
    '■ 作成できた請求書（' + done.length + ' 件）\n' +
    (done.length ? '　' + done.join('\n　') : '　なし') + '\n\n' +
    (skipped.length
      ? '■ 作成できなかったお客様（' + skipped.length + ' 件）\n　' + skipped.join('\n　') +
        '\n\nカードが未登録の場合は、先に登録手数料の請求書でご登録いただいてください。\n\n'
      : '') +
    'Squareの画面で内容を確認し、送信してください。',
    ui.ButtonSet.OK);
}

/**
 * 請求の対象になる月。
 * 月末に実行する運用だが、月初にずれ込むこともあるため、5日までは前月分とみなす。
 */
function squareBillingMonth_(today) {
  const at = new Date(today.getTime());
  if (at.getDate() <= 5) at.setMonth(at.getMonth() - 1);
  const year = at.getFullYear();
  const month = at.getMonth();
  return {
    year: year,
    month: month,
    key: year + '/' + ('0' + (month + 1)).slice(-2),
    label: 'ササゲパス利用料金' + year + '年' + (month + 1) + '月分',
    // 支払い期限は請求月の翌月5日
    due: new Date(year, month + 1, 5)
  };
}

/** 未請求（送信済）の返送を、お客様ごとにまとめる。 */
function squareCollectBillable_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_SHIPMENTS);
  const groups = {};
  if (!sheet || sheet.getLastRow() < 2) return groups;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_SHIPMENT_HEADERS.length).getValues()
    .forEach(function (row, i) {
      if (BOARD_SHIPMENT_BILLABLE.indexOf(String(row[BOARD_SHIPMENT_COL.status - 1] || '').trim()) < 0) return;
      const customerId = String(row[BOARD_SHIPMENT_COL.customerId - 1] || '').trim();
      const qty = Number(row[BOARD_SHIPMENT_COL.qty - 1] || 0);
      const unitPrice = Number(row[BOARD_SHIPMENT_COL.unitPrice - 1] || 0);
      // 点数か単価が入っていない行は、金額を出せないので含めない
      if (!customerId || qty <= 0 || unitPrice <= 0) return;

      if (!groups[customerId]) {
        groups[customerId] = { customer: row[BOARD_SHIPMENT_COL.customer - 1], items: [] };
      }
      groups[customerId].items.push({
        row: i + 2,
        caseId: String(row[BOARD_SHIPMENT_COL.caseId - 1] || '').trim(),
        date: row[BOARD_SHIPMENT_COL.date - 1],
        qty: qty,
        unitPrice: unitPrice
      });
    });
  return groups;
}

/** お客様1人ぶんの請求書を作り、返送履歴と請求書シートに記録する。 */
function squareCreateInvoiceFor_(ss, location, month, customerId, group) {
  const customer = boardFindCustomer_(ss, customerId);
  if (!customer || !boardIsEmail_(customer.email)) throw new Error('メールアドレスが登録されていません');

  const squareId = squareEnsureCustomer_(ss, customer);
  const card = squareFindCardOnFile_(squareId);
  if (!card) throw new Error('保存されたカードがありません');

  const order = squareCreateUsageOrder_(location.id, squareId, month, group.items);
  const tpl = boardFindTemplate_(ss, 'S2');
  const due = Utilities.formatDate(month.due, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const invoice = squareFetch_('POST', '/invoices', {
    idempotency_key: Utilities.getUuid(),
    invoice: {
      location_id: location.id,
      order_id: order.id,
      primary_recipient: { customer_id: squareId },
      delivery_method: 'EMAIL',
      title: month.label,
      description: tpl ? tpl.body : '',
      payment_requests: [{
        request_type: 'BALANCE',
        due_date: due,
        // 保存されたカードから自動で引き落とす
        automatic_payment_source: 'CARD_ON_FILE',
        card_id: card.id
      }],
      accepted_payment_methods: { card: true },
      sale_or_service_date: due
    }
  }).invoice;

  const qty = group.items.reduce(function (sum, item) { return sum + item.qty; }, 0);
  const amount = group.items.reduce(function (sum, item) { return sum + item.qty * item.unitPrice; }, 0);

  // 返送履歴に、どの請求にまとまったかを書き戻す
  const ships = ss.getSheetByName(BOARD_SHEET_SHIPMENTS);
  group.items.forEach(function (item) {
    ships.getRange(item.row, BOARD_SHIPMENT_COL.status).setValue(SHIP_STATUS_INVOICED);
    ships.getRange(item.row, BOARD_SHIPMENT_COL.billingMonth).setValue(month.key);
    ships.getRange(item.row, BOARD_SHIPMENT_COL.invoiceId).setValue(invoice.id);
  });

  squareRecordInvoice_(ss, {
    month: month.key,
    customerId: customerId,
    customer: group.customer,
    targets: group.items.map(function (i) { return i.caseId + ' ' + boardFormatDate_(i.date); }).join('\n'),
    qty: qty,
    amount: amount,
    invoiceId: invoice.id
  });

  return { customer: group.customer, qty: qty, amount: amount };
}

/** 明細は返送1回ぶんで1行。単価は税抜で、消費税は明細ごとに加算する。 */
function squareCreateUsageOrder_(locationId, squareCustomerId, month, items) {
  const data = squareFetch_('POST', '/orders', {
    idempotency_key: Utilities.getUuid(),
    order: {
      location_id: locationId,
      customer_id: squareCustomerId,
      line_items: items.map(function (item) {
        return {
          name: item.caseId + '　' + boardFormatDate_(item.date) + ' 返送分',
          quantity: String(item.qty),
          base_price_money: { amount: item.unitPrice, currency: SQUARE_CURRENCY },
          applied_taxes: [{ tax_uid: 'usage-tax' }]
        };
      }),
      taxes: [{
        uid: 'usage-tax',
        name: SQUARE_TAX_NAME,
        percentage: SQUARE_TAX_PERCENTAGE,
        type: 'ADDITIVE',
        scope: 'LINE_ITEM'
      }]
    }
  });
  return data.order;
}

/** そのお客様の、使える保存済みカード。複数あれば新しいほうを使う。 */
function squareFindCardOnFile_(squareCustomerId) {
  const data = squareFetch_('GET', '/cards?customer_id=' + encodeURIComponent(squareCustomerId));
  const cards = (data.cards || []).filter(function (card) { return card.enabled !== false; });
  return cards.length > 0 ? cards[cards.length - 1] : null;
}

function squareRecordInvoice_(ss, data) {
  const sheet = ss.getSheetByName(BOARD_SHEET_INVOICES);
  if (!sheet) return;

  const values = new Array(BOARD_INVOICE_HEADERS.length).fill('');
  values[BOARD_INVOICE_COL.month - 1] = data.month;
  values[BOARD_INVOICE_COL.customerId - 1] = data.customerId;
  values[BOARD_INVOICE_COL.customer - 1] = data.customer;
  values[BOARD_INVOICE_COL.targets - 1] = data.targets;
  values[BOARD_INVOICE_COL.qty - 1] = data.qty;
  values[BOARD_INVOICE_COL.amount - 1] = data.amount;
  values[BOARD_INVOICE_COL.status - 1] = INVOICE_STATUS_DRAFT;
  values[BOARD_INVOICE_COL.createdAt - 1] = new Date();
  values[BOARD_INVOICE_COL.invoiceId - 1] = data.invoiceId;
  sheet.appendRow(values);

  const row = sheet.getLastRow();
  sheet.getRange(row, BOARD_INVOICE_COL.url)
    .setFormula('=HYPERLINK("' + squareDashboardUrl_(data.invoiceId) + '","Squareで開く")');
  boardForceRowHeight_(sheet, row, 1);
}

function squareYen_(amount) {
  return '¥' + Number(amount || 0).toLocaleString('ja-JP') + '（税抜）';
}

/**
 * 請求書が送られたか、支払われたかを Square から取り込む。
 *
 * 返送履歴の状態も一緒に進める。
 * 送信済 → 請求済、支払い済 → 支払い済。取り消された請求書は未請求に戻す。
 */
function squareRefreshInvoices(ss) {
  const target = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = target.getSheetByName(BOARD_SHEET_INVOICES);
  if (!sheet || sheet.getLastRow() < 2 || !squareGetToken_()) return 0;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BOARD_INVOICE_HEADERS.length).getValues();
  const moved = [];

  rows.forEach(function (row, i) {
    const status = String(row[BOARD_INVOICE_COL.status - 1] || '').trim();
    if (status === INVOICE_STATUS_PAID || status === INVOICE_STATUS_CANCELED) return;
    const invoiceId = String(row[BOARD_INVOICE_COL.invoiceId - 1] || '').trim();
    if (!invoiceId) return;

    const invoice = squareGetInvoice_(invoiceId);
    if (!invoice) {
      // Squareから消えている。請求のやり直しができるよう未請求に戻す
      sheet.getRange(i + 2, BOARD_INVOICE_COL.status).setValue(INVOICE_STATUS_CANCELED);
      squareResetShipments_(target, invoiceId);
      moved.push(row[BOARD_INVOICE_COL.customer - 1] + '→取消');
      return;
    }

    const next = squareInvoiceStateLabel_(invoice.status);
    if (next === INVOICE_STATUS_CANCELED) {
      sheet.getRange(i + 2, BOARD_INVOICE_COL.status).setValue(next);
      squareResetShipments_(target, invoiceId);
      moved.push(row[BOARD_INVOICE_COL.customer - 1] + '→取消');
      return;
    }
    if (next === status) return;

    sheet.getRange(i + 2, BOARD_INVOICE_COL.status).setValue(next);
    if (next === INVOICE_STATUS_SENT) {
      if (!row[BOARD_INVOICE_COL.sentAt - 1]) {
        sheet.getRange(i + 2, BOARD_INVOICE_COL.sentAt).setValue(new Date());
      }
      squareMarkShipments_(target, invoiceId, SHIP_STATUS_BILLED);
    }
    if (next === INVOICE_STATUS_PAID) {
      if (!row[BOARD_INVOICE_COL.sentAt - 1]) {
        sheet.getRange(i + 2, BOARD_INVOICE_COL.sentAt).setValue(new Date());
      }
      sheet.getRange(i + 2, BOARD_INVOICE_COL.paidAt).setValue(new Date());
      squareMarkShipments_(target, invoiceId, SHIP_STATUS_PAID);
    }
    moved.push(row[BOARD_INVOICE_COL.customer - 1] + '→' + next);
  });

  if (moved.length > 0) {
    boardRefreshUnbilled_(target);
    boardLog_('請求', moved.length + ' 件の請求書の状態を更新しました（' + moved.join('、') + '）');
  }
  return moved.length;
}

/** Squareの請求書の状態を、シートの言い方に直す。 */
function squareInvoiceStateLabel_(status) {
  if (status === 'PAID' || status === 'REFUNDED') return INVOICE_STATUS_PAID;
  if (status === 'CANCELED' || status === 'FAILED') return INVOICE_STATUS_CANCELED;
  if (status === 'DRAFT') return INVOICE_STATUS_DRAFT;
  // UNPAID / SCHEDULED / PARTIALLY_PAID などは、送られたが入金が済んでいない状態
  return INVOICE_STATUS_SENT;
}

function squareMarkShipments_(ss, invoiceId, status) {
  const sheet = ss.getSheetByName(BOARD_SHEET_SHIPMENTS);
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, BOARD_SHIPMENT_COL.invoiceId, sheet.getLastRow() - 1, 1).getValues()
    .forEach(function (row, i) {
      if (String(row[0] || '').trim() !== invoiceId) return;
      sheet.getRange(i + 2, BOARD_SHIPMENT_COL.status).setValue(status);
    });
}

/** 取り消された請求書に紐づく返送を、未請求に戻す。 */
function squareResetShipments_(ss, invoiceId) {
  const sheet = ss.getSheetByName(BOARD_SHEET_SHIPMENTS);
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, BOARD_SHIPMENT_COL.invoiceId, sheet.getLastRow() - 1, 1).getValues()
    .forEach(function (row, i) {
      if (String(row[0] || '').trim() !== invoiceId) return;
      sheet.getRange(i + 2, BOARD_SHIPMENT_COL.status).setValue(SHIP_STATUS_SENT);
      sheet.getRange(i + 2, BOARD_SHIPMENT_COL.invoiceId).setValue('');
      sheet.getRange(i + 2, BOARD_SHIPMENT_COL.billingMonth).setValue('');
    });
}
