/**
 * 料金設計。**ササゲパスの料金の大もとは、ここ1か所だけ。**
 *
 * これまで料金は Config シートのA1セルに、3万文字のJSONとして入っていた。
 * 見積もりフォームの管理画面からしか直せず、一覧して見渡すこともできなかった。
 *
 * 「料金設計」タブは、そのJSONをふつうの表にほどいたもの。
 * 単価を直して「料金を更新する」に✓を入れると、Config へ書き戻す。
 * 書き戻した瞬間から、見積もりフォーム・依頼フォーム・請求書の単価がその値になる。
 *
 * 　料金設計タブ ──[料金を更新する]──▶ Config!A1 ──▶ 見積もりフォーム
 * 　　　　　　　◀──[表を読み込み直す]──┘        └──▶ 依頼フォーム・請求書
 *
 * **触るのは単価と有効・無効だけ。** メニューの追加・削除・並べ替え・画像・説明文は
 * これまでどおり管理画面（?admin=1&key=…）で行う。表とフォームの編集機能を
 * 二重に持つと、どちらかが必ず壊れるため。
 */

const PRICE_SHEET = '料金設計';
const PRICE_HISTORY_SHEET = '料金履歴';

/** 「ボタン」を置く行。使い方の説明より下に置く。 */
const PRICE_ROW_BUTTONS = 11;
const PRICE_ROW_STAMP = 12;

const PRICE_HEAD_MENUS = '■ メニューの単価';
const PRICE_HEAD_TIERS = '■ 数量割引';
const PRICE_MENU_HEADERS = ['種別', 'ID（直せます）', '名前', '単価（円/点）', '出す', '説明'];
const PRICE_TIER_HEADERS = ['段の名前', '下限点数', '割引の種類', '値', '出す', 'ID'];

const PRICE_HISTORY_HEADERS = ['日時', '変えた内容', '据え置いたお客様', '控え（JSON）'];

/** 表の使い方。**シートを開いた人が、これだけ読めば分かるように。** */
const PRICE_GUIDE = [
  '【料金設計】ササゲパスの料金は、すべてこの表が大もとです。',
  '濃い字の列（ID・単価・出す・下限点数・値）が直せるところです。うすい字の列（種別・名前・説明）は直しても反映されません。',
  'IDはどの行も自由に直せます。半角の英数字とアンダースコアで、分かりやすい名前を付けてください（例: photo_bg）。',
  '',
  '　手順1　白い列を直す　　手順2　下の青いボタン「料金を更新する」を押す',
  '　手順3　出てきた画面で、何がどう変わるかを確かめる　　手順4　画面の「この内容で更新する」を押す',
  '',
  '※ 表を直しただけでは、まだ何も変わりません。画面のボタンを押してはじめて書き換わります。',
  '※ 更新すると、見積もりフォームの表示価格・依頼フォーム・請求書の単価が、いっせいにこの表の値になります。',
  '※ 更新前の内容は「料金履歴」タブに丸ごと残ります。初期セットアップを実行すると、この表はいまの料金で書き直されます。'
];

// ------------------------------------------------------------
// シートを作る・描き直す
// ------------------------------------------------------------

/**
 * 料金設計タブを、いまの Config の中身で描き直す。
 * 初期セットアップのたびに呼ぶ。手で直した途中の値は失われるので、
 * 更新し忘れがないよう最終更新の日時を添えておく。
 */
function priceRenderSheet_(ss) {
  const config = getConfig_();
  let sheet = ss.getSheetByName(PRICE_SHEET);
  if (!sheet) sheet = ss.insertSheet(PRICE_SHEET);

  const menuRows = priceMenuRows_(config);
  const tierRows = priceTierRows_(config);
  const width = PRICE_MENU_HEADERS.length;
  const total = PRICE_ROW_BUTTONS + 3 + menuRows.length + 3 + tierRows.length + 4;

  if (sheet.getMaxRows() < total) sheet.insertRowsAfter(sheet.getMaxRows(), total - sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns())
    .clearContent().clearDataValidations().setBackground(null).setFontColor(null).setFontWeight(null);

  // 使い方
  PRICE_GUIDE.forEach(function (line, i) {
    sheet.getRange(i + 1, 1).setValue(line);
  });
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  sheet.getRange(1, 1, PRICE_GUIDE.length, 1).setFontColor('#3D4A66');

  priceDrawButtons_(sheet);

  const history = ss.getSheetByName(PRICE_HISTORY_SHEET);
  const count = history && history.getLastRow() > 1 ? history.getLastRow() - 1 : 0;
  sheet.getRange(PRICE_ROW_STAMP, 1).setValue(
    '表を書き出した日時: ' + priceNow_() + '　／　料金履歴 ' + count + ' 件'
  ).setFontColor('#8A97B8');

  let row = PRICE_ROW_BUTTONS + 3;
  row = priceWriteTable_(sheet, row, PRICE_HEAD_MENUS, PRICE_MENU_HEADERS, menuRows, [2, 4, 5]);
  row += 2;
  priceWriteTable_(sheet, row,
    PRICE_HEAD_TIERS + '（当月に発送されたぶんの、お預かり点数の合計で段が決まります）',
    PRICE_TIER_HEADERS, tierRows, [2, 4, 5]);

  const warning = priceTierWarning_(tierRows);
  if (warning) {
    sheet.getRange(row + tierRows.length + 3, 1).setValue(warning)
      .setFontColor('#A32D2D').setFontWeight('bold');
  }

  [140, 150, 260, 90, 70, 420].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setFrozenRows(PRICE_ROW_BUTTONS + 1);
  boardLog_('料金', '料金設計タブを書き出しました（メニュー ' + menuRows.length + ' 行、数量割引 ' + tierRows.length + ' 行）');
  return sheet;
}

/**
 * 見出し＋表を1つ書いて、次に使える行番号を返す。
 *
 * **直せる列は白く、直しても反映されない列はグレーにする。**
 * どこを触っていいのか、色だけで分かるようにしておく。
 */
function priceWriteTable_(sheet, row, title, headers, rows, editable) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold').setFontColor('#2C3E63');
  const head = row + 1;
  sheet.getRange(head, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#F1EFE8');
  if (rows.length === 0) return head;

  const body = sheet.getRange(head + 1, 1, rows.length, headers.length);
  body.setValues(rows).setBackground('#FFFFFF').setFontWeight(null).setFontColor('#8A97B8');

  editable.forEach(function (c) {
    sheet.getRange(head + 1, c, rows.length, 1).setFontColor('#26324A').setFontWeight('bold');
  });
  // 有効・無効は、TRUE / FALSE の文字よりチェックのほうが分かりやすい
  sheet.getRange(head + 1, 5, rows.length, 1).insertCheckboxes().setHorizontalAlignment('center');
  sheet.getRange(head + 1, 4, rows.length, 1).setHorizontalAlignment('right');

  // メニューの見出し行は、下の項目と見分けがつくように色を敷く
  rows.forEach(function (r, i) {
    if (String(r[0]) !== 'メニュー') return;
    sheet.getRange(head + 1 + i, 1, 1, headers.length)
      .setBackground('#EDF1FB').setFontWeight('bold').setFontColor('#2C3E63');
  });

  return head + rows.length;
}

/** メニュー・オプション・サイト選択を、上から順に1行ずつ。 */
function priceMenuRows_(config) {
  const rows = [];
  (config.menus || []).forEach(function (menu) {
    let n = 0;
    let memo = 0;
    rows.push(['メニュー', menu.id, menu.name, '—', menu.enabled !== false,
      'この下の項目をお客様が選びます（メニュー自体に料金はありません）']);
    (menu.items || []).forEach(function (item) {
      if (item.type === 'text') {
        memo++;
        rows.push(['記入欄', item.id, '　└ ' + item.name, '—', item.enabled !== false,
          'お客様に自由に書いていただく欄（料金なし）']);
        return;
      }
      n++;
      rows.push(['選べる項目', item.id, '　└ ' + item.name,
        Number(item.unitPrice || 0), item.enabled !== false,
        priceOneLine_(item.description)]);

      const mode = item.subChoicePricingMode;
      if (mode === 'count') {
        rows.push(['選んだ数ぶん', item.id + '#count', '　　└ 選んだ数 × この単価',
          Number(item.subChoiceCountUnitPrice || 0), true, '下の選択肢は、個別の単価ではなく「選んだ数」で計算します']);
      }
      (item.subChoices || []).forEach(function (choice, k) {
        rows.push([mode === 'choice' ? 'サイト選択' : 'サイト選択',
          choice.id, '　　└ ' + choice.name,
          mode === 'choice' ? Number(choice.unitPrice || 0) : '—',
          choice.enabled !== false,
          mode === 'choice' ? '' : '選んでも単価は変わりません（上の項目の単価だけがかかります）']);
      });
    });
  });
  return rows;
}

/** 数量割引の段。見積もりフォームが実際に使っているのは quantityOptions.monthly のほう。 */
function priceTierRows_(config) {
  const monthly = (config.quantityOptions && config.quantityOptions.monthly) || [];
  return monthly.map(function (tier) {
    const type = tier.discountType === 'amount' ? '円引き' : (tier.discountType === 'rate' ? '％引き' : 'なし');
    const value = tier.discountType === 'amount'
      ? Number(tier.discountAmount || 0)
      : (tier.discountType === 'rate' ? Number(tier.discountRate || 0) : 0);
    return [tier.label, Number(tier.quantity || 0), type, value, tier.enabled !== false, tier.id];
  });
}

/**
 * 数量割引の段が、下限点数の小さい順に並んでいるか。
 *
 * 見積もりフォームはお客様が段を選ぶので、下限点数がでたらめでも気づけない。
 * **請求は下限点数で段を決めるため、ここが狂うと金額が狂う。**
 * 実際「月501点以上〜」の下限が0のままになっていた。
 */
function priceTierWarning_(tierRows) {
  const bad = [];
  let previous = -1;
  tierRows.forEach(function (row) {
    const min = Number(row[1] || 0);
    if (min <= previous) bad.push(row[0] + '（下限 ' + min + '点）');
    previous = min;
  });
  if (bad.length === 0) return '';
  return '⚠ 数量割引の下限点数が小さい順に並んでいません: ' + bad.join('、') +
    '　このままだと請求の割引が正しく決まりません。下限点数を直して「料金を更新する」を押してください。';
}

/**
 * 表の上に、押せるボタンを2つ置く。
 *
 * スプレッドシートに図形のボタンをスクリプトから置くことはできないが、
 * **画像なら置けて、押したときに動く関数も指定できる**（assignScript）。
 * 押しても、その場では何も書き換わらない。画面が出るだけ。
 */
function priceDrawButtons_(sheet) {
  sheet.getImages().forEach(function (image) { image.remove(); });
  sheet.setRowHeight(PRICE_ROW_BUTTONS, 52);

  const put = function (base64, column, fn) {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', fn + '.png');
    const image = sheet.insertImage(blob, column, PRICE_ROW_BUTTONS, 6, 8);
    image.assignScript(fn);
    return image;
  };

  put(PRICE_BUTTON_UPDATE_PNG, 1, 'priceOpenUpdate');
  put(PRICE_BUTTON_RELOAD_PNG, 3, 'priceReloadSheet');
}

function priceNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

function priceOneLine_(text) {
  return String(text || '').split(String.fromCharCode(10)).join(' ').slice(0, 120);
}

// ------------------------------------------------------------
// 表を読む
// ------------------------------------------------------------

/** 表の中身を読み取る。見出しを目印にするので、行が増減しても追える。 */
function priceReadSheet_(sheet) {
  const last = sheet.getLastRow();
  const values = sheet.getRange(1, 1, last, PRICE_MENU_HEADERS.length).getValues();

  const find = function (needle) {
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').indexOf(needle) === 0) return i + 1;
    }
    return 0;
  };
  const menuAt = find(PRICE_HEAD_MENUS);
  const tierAt = find(PRICE_HEAD_TIERS);
  if (!menuAt || !tierAt) throw new Error('料金設計タブの見出しが見つかりません。初期セットアップを実行してください。');

  const items = {};
  const rows = [];
  for (let r = menuAt + 2; r <= last; r++) {
    const kind = String(values[r - 1][0] || '').trim();
    if (!kind) break;
    const id = String(values[r - 1][1] || '').trim();
    if (!id) continue;
    const row = {
      kind: kind,
      id: id,
      name: String(values[r - 1][2] || '').trim(),
      price: values[r - 1][3],
      enabled: values[r - 1][4] !== false
    };
    items[id] = row;
    rows.push(row);
  }

  const tiers = [];
  for (let r = tierAt + 2; r <= last; r++) {
    const label = String(values[r - 1][0] || '').trim();
    if (!label) break;
    tiers.push({
      label: label,
      quantity: Math.max(0, Number(values[r - 1][1] || 0)),
      type: String(values[r - 1][2] || '').trim(),
      value: Number(values[r - 1][3] || 0),
      enabled: values[r - 1][4] !== false,
      id: String(values[r - 1][5] || '').trim()
    });
  }
  return { items: items, rows: rows, tiers: tiers };
}

/**
 * 表の値を Config の形に流し込む。**IDで突き合わせるので、名前・画像・説明文は触らない。**
 * 変わったところを { id, 名前, 前, 後 } の一覧で返す。
 */
function priceApplyToConfig_(config, table) {
  const changes = [];
  const note = function (id, name, before, after) {
    if (String(before) === String(after)) return;
    changes.push({ id: id, name: name, before: before, after: after });
  };

  (config.menus || []).forEach(function (menu) {
    const m = table.items[menu.id];
    if (m) {
      note(menu.id, menu.name, menu.enabled !== false ? '有効' : '無効', m.enabled ? '有効' : '無効');
      menu.enabled = m.enabled;
    }
    (menu.items || []).forEach(function (item) {
      const found = table.items[item.id];
      if (found) {
        note(item.id, menu.name + '：' + item.name, item.enabled !== false ? '有効' : '無効', found.enabled ? '有効' : '無効');
        item.enabled = found.enabled;
        if (item.type !== 'text') {
          const price = Math.max(0, Number(found.price || 0));
          note(item.id, menu.name + '：' + item.name, Number(item.unitPrice || 0), price);
          item.unitPrice = price;
        }
      }
      const counted = table.items[item.id + '#count'];
      if (counted && item.subChoicePricingMode === 'count') {
        const price = Math.max(0, Number(counted.price || 0));
        note(item.id + '#count', menu.name + '：' + item.name + '（選択1つあたり）',
          Number(item.subChoiceCountUnitPrice || 0), price);
        item.subChoiceCountUnitPrice = price;
      }
      (item.subChoices || []).forEach(function (choice) {
        const c = table.items[choice.id];
        if (!c) return;
        note(choice.id, menu.name + '：' + item.name + ' > ' + choice.name,
          choice.enabled !== false ? '有効' : '無効', c.enabled ? '有効' : '無効');
        choice.enabled = c.enabled;
        if (item.subChoicePricingMode === 'choice') {
          const price = Math.max(0, Number(c.price || 0));
          note(choice.id, menu.name + '：' + item.name + ' > ' + choice.name, Number(choice.unitPrice || 0), price);
          choice.unitPrice = price;
        }
      });
    });
  });

  const monthly = (config.quantityOptions && config.quantityOptions.monthly) || [];
  table.tiers.forEach(function (row, i) {
    const tier = monthly[i];
    if (!tier) return;
    const type = row.type === '円引き' ? 'amount' : (row.type === '％引き' ? 'rate' : 'none');
    const before = priceTierText_(tier);
    tier.label = row.label;
    tier.quantity = row.quantity;
    tier.enabled = row.enabled;
    tier.discountType = type;
    tier.discountRate = type === 'rate' ? Math.min(0.95, Math.max(0, row.value)) : 0;
    tier.discountAmount = type === 'amount' ? Math.max(0, row.value) : 0;
    note('tier_' + i, '数量割引：' + row.label, before, priceTierText_(tier));
  });

  // 古い discounts は見積もりフォームの控え。食い違ったままにしない
  config.discounts = monthly.map(function (tier) {
    return {
      label: tier.label,
      minMonthlyQty: Number(tier.quantity || 0),
      rate: tier.discountType === 'rate' ? Number(tier.discountRate || 0) : 0,
      discountType: tier.discountType === 'amount' ? 'amount' : 'rate',
      discountAmount: tier.discountType === 'amount' ? Number(tier.discountAmount || 0) : 0
    };
  });

  return changes;
}

function priceTierText_(tier) {
  const min = Number(tier.quantity || 0) + '点〜';
  if (tier.discountType === 'amount') return min + ' ' + Number(tier.discountAmount || 0) + '円引き';
  if (tier.discountType === 'rate') return min + ' ' + Math.round(Number(tier.discountRate || 0) * 100) + '％引き';
  return min + ' 割引なし';
}

// ------------------------------------------------------------
// 単価の計算
// ------------------------------------------------------------

/**
 * 選ばれた内容から、数量割引をかける前の単価を出す。
 *
 * **見積もりフォームと同じ関数を使う。** 別々に書くと、いつか必ず食い違う。
 */
function priceBaseUnitPrice_(config, selection) {
  const options = (selection && selection.options) || {};
  const estimate = calculateEstimate_({
    selectedMenus: Object.keys(options),
    selectedOptions: options,
    subChoices: (selection && selection.subChoices) || {},
    textResponses: {},
    quantities: {}          // 段はこちらで決めるので、フォームの選択は渡さない
  }, config);
  return { price: Number(estimate.baseUnitPrice || 0), summary: estimate.selectedSummary };
}

/**
 * 点数から、あてはまる数量割引の段を選ぶ。
 *
 * 見積もりフォームはお客様が選んだ段をそのまま使うが、請求は実績で決める。
 * **下限点数を超えているもののうち、いちばん上の段。**
 */
function priceTierFor_(config, qty) {
  const monthly = (config.quantityOptions && config.quantityOptions.monthly) || [];
  let best = null;
  monthly.forEach(function (tier) {
    if (tier.enabled === false) return;
    const min = Number(tier.quantity || 0);
    if (Number(qty || 0) < min) return;
    if (!best || min > Number(best.quantity || 0)) best = tier;
  });
  return best;
}

/** 割引をかけたあとの単価と、そこに至る説明文。 */
function priceUnitPrice_(config, selection, monthlyQty) {
  const base = priceBaseUnitPrice_(config, selection);
  const tier = priceTierFor_(config, monthlyQty);
  const result = applyMonthlyQuantityDiscount_(base.price, tier, config);
  return {
    base: base.price,
    unitPrice: Number(result.unitPrice || 0),
    tier: tier,
    tierLabel: tier ? tier.label : '通常料金',
    discountText: tier ? result.summary : 'なし'
  };
}

// ------------------------------------------------------------
// 選ばれた内容の控え
// ------------------------------------------------------------

/** 案件行から、選ばれた内容を取り出す。控えが無ければ依頼内容の文から復元する。 */
function priceSelectionOf_(config, values) {
  const raw = String(values[BOARD_COL.selection - 1] || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.options) return parsed;
    } catch (err) {
      // 壊れていれば文から読み直す
    }
  }
  return priceSelectionFromText_(config, values[BOARD_COL.detail - 1]);
}

/**
 * 「クリーニング：シミ抜き（¥100/点）」という文から、選ばれた項目のIDを割り出す。
 *
 * **控えの列を作る前の案件のための、一度きりの読み替え。**
 * 名前で突き合わせるので、メニュー名を変えたあとでは使えない。
 */
function priceSelectionFromText_(config, text) {
  const selection = { options: {}, subChoices: {} };
  String(text || '').split(String.fromCharCode(10)).forEach(function (line) {
    const body = line.trim();
    if (!body) return;
    const at = body.indexOf('：');
    if (at < 0) return;

    const menuName = body.slice(0, at).trim();
    const menu = (config.menus || []).filter(function (m) { return m.name === menuName; })[0];
    if (!menu) return;

    // 「項目名 > サブ1、サブ2」と「項目名（¥100/点）」の2つの形がある
    let rest = body.slice(at + 1).trim();
    const arrow = rest.indexOf(' > ');
    const subNames = arrow >= 0 ? rest.slice(arrow + 3).split('、') : [];
    if (arrow >= 0) rest = rest.slice(0, arrow).trim();
    const itemName = rest.replace(/（[^）]*）\s*$/, '').trim();

    const item = (menu.items || []).filter(function (it) { return it.name === itemName; })[0];
    if (!item) return;

    if (!selection.options[menu.id]) selection.options[menu.id] = [];
    if (selection.options[menu.id].indexOf(item.id) < 0) selection.options[menu.id].push(item.id);

    if (subNames.length === 0) return;
    const ids = (item.subChoices || []).filter(function (c) {
      return subNames.map(function (n) { return n.trim(); }).indexOf(c.name) >= 0;
    }).map(function (c) { return c.id; });
    if (ids.length === 0) return;
    if (!selection.subChoices[menu.id]) selection.subChoices[menu.id] = {};
    selection.subChoices[menu.id][item.id] = ids;
  });
  return selection;
}

/**
 * 控えの列が空の案件を、依頼内容の文から埋め直す。初期セットアップで一度だけ効く。
 * 読み取れなかったものはログに残す。**黙って空のままにしない。**
 */
function priceRestoreSelections_(ss) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const config = getConfig_();
  const rows = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, rows, BOARD_CASE_HEADERS.length).getValues();
  const range = sheet.getRange(2, BOARD_COL.selection, rows, 1);
  const current = range.getValues();

  let filled = 0;
  const failed = [];
  const next = values.map(function (row, i) {
    const caseId = String(row[BOARD_COL.caseId - 1] || '').trim();
    if (!caseId) return current[i];
    if (String(current[i][0] || '').trim()) return current[i];
    if (!String(row[BOARD_COL.detail - 1] || '').trim()) return current[i];

    const selection = priceSelectionFromText_(config, row[BOARD_COL.detail - 1]);
    if (Object.keys(selection.options).length === 0) { failed.push(caseId); return current[i]; }
    filled++;
    return [JSON.stringify(selection)];
  });

  if (filled > 0) {
    range.setValues(next);
    boardLog_('料金', '依頼内容から選択の控えを ' + filled + ' 件復元しました');
  }
  if (failed.length > 0) {
    boardLog_('料金', '選択の控えを復元できなかった案件: ' + failed.join('、') + '（料金の計算は現在の単価のままになります）');
  }
  return filled;
}

// ------------------------------------------------------------
// ボタン
// ------------------------------------------------------------

/**
 * 編集を捨てて、いまの料金で表を書き直す。メニューから呼ぶ。
 */
function priceReloadSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  priceRenderSheet_(ss);
  SpreadsheetApp.getUi().alert('いまの料金で表を書き直しました。');
}

// ------------------------------------------------------------
// 影響を受けるお客様
// ------------------------------------------------------------

/**
 * 料金を変えたことで単価が動くお客様を割り出す。
 *
 * 見送り以外の、そのお客様のいちばん新しい案件の選択内容で見る。
 * **進行中の案件が無くても拾う。** 次のご依頼でも同じ内容を選ばれるため。
 */
function priceAffectedCustomers_(ss, before, after) {
  const cases = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!cases || cases.getLastRow() < 2) return [];

  const rows = cases.getRange(2, 1, cases.getLastRow() - 1, BOARD_CASE_HEADERS.length).getValues();
  const newest = {};
  rows.forEach(function (row) {
    const caseId = String(row[BOARD_COL.caseId - 1] || '').trim();
    const customerId = String(row[BOARD_COL.customerId - 1] || '').trim();
    if (!caseId || !customerId) return;
    if (String(row[BOARD_COL.status - 1] || '').trim() === BOARD_STATUS_CLOSED) return;

    const rank = priceCaseRank_(caseId);
    if (newest[customerId] && newest[customerId].rank >= rank) return;
    newest[customerId] = { rank: rank, caseId: caseId, values: row };
  });

  const out = [];
  Object.keys(newest).sort().forEach(function (customerId) {
    const hit = newest[customerId];
    const selection = priceSelectionOf_(before, hit.values);
    if (Object.keys(selection.options || {}).length === 0) return;

    const was = priceBaseUnitPrice_(before, selection).price;
    const now = priceBaseUnitPrice_(after, selection).price;
    if (was === now) return;

    const customer = boardFindCustomerRow_(ss, customerId);
    const current = customer ? Number(customer.values[BOARD_CUSTOMER_COL.priceAdjust - 1] || 0) : 0;
    out.push({
      customerId: customerId,
      name: String(hit.values[BOARD_COL.customer - 1] || ''),
      caseId: hit.caseId,
      status: String(hit.values[BOARD_COL.status - 1] || ''),
      was: was,
      now: now,
      delta: was - now,          // これを足せば、これまでと同じ単価になる
      current: current,
      next: current + (was - now)
    });
  });
  return out;
}

/** 案件IDの新しさ。枝番が大きいほど新しい。 */
function priceCaseRank_(caseId) {
  const parts = boardCaseIdParts_(caseId);
  return parts ? parts.number * 1000 + parts.branch : 0;
}

// ------------------------------------------------------------
// 料金履歴
// ------------------------------------------------------------

/** 更新のたびに、変える前の中身をまるごと1行残す。**元に戻せるように。** */
function priceSaveHistory_(ss, changes, before) {
  let sheet = ss.getSheetByName(PRICE_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRICE_HISTORY_SHEET);
    sheet.getRange(1, 1, 1, PRICE_HISTORY_HEADERS.length).setValues([PRICE_HISTORY_HEADERS])
      .setFontWeight('bold').setBackground('#F1EFE8');
    sheet.setFrozenRows(1);
    [150, 420, 260, 200].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  }
  sheet.appendRow([
    priceNow_(),
    changes.map(function (c) { return c.name + '　' + c.before + ' → ' + c.after; })
      .join(String.fromCharCode(10)),
    '',
    JSON.stringify(before)
  ]);
  sheet.getRange(sheet.getLastRow(), 1, 1, PRICE_HISTORY_HEADERS.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('top');
}

/** いちばん新しい料金履歴に、あとから決まった据え置きの結果を書き足す。 */
function priceStampHistory_(ss, text) {
  const sheet = ss.getSheetByName(PRICE_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(sheet.getLastRow(), 3).setValue(text);
}

// ------------------------------------------------------------
// 料金の更新
// ------------------------------------------------------------

/**
 * 料金の更新画面をひらく。**ここでは何も書き換えない。**
 *
 * 以前はチェックボックスを入れた瞬間に書き換えていた。
 * 何が起きたのか分からず、動いたのかどうかも分からない、という状態になった。
 * いまは「画面を出す」だけにして、書き換えは画面のボタンから行う。
 */
function priceOpenUpdate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();

  const sheet = ss.getSheetByName(PRICE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('「料金設計」タブがありません。メニューの 設定 → 初期セットアップ を実行してください。');
    return;
  }

  const preview = priceBuildPreview_(ss);
  const html = HtmlService.createTemplateFromFile('PriceUpdate');
  html.data = JSON.stringify(preview);
  SpreadsheetApp.getUi().showModalDialog(
    html.evaluate().setWidth(720).setHeight(620), '料金の更新'
  );
}

/** 画面に出すぶんを、ぜんぶ先に作る。**書き換えはしない。** */
function priceBuildPreview_(ss) {
  const sheet = ss.getSheetByName(PRICE_SHEET);
  const before = getConfig_();
  const table = priceReadSheet_(sheet);

  const renames = priceRenames_(before, table);
  const after = JSON.parse(JSON.stringify(before));
  priceApplyRenames_(after, renames);
  const changes = priceApplyToConfig_(after, priceAliasCountKeys_(table, renames));

  return {
    changes: changes,
    renames: renames,
    affected: (changes.length > 0 || renames.length > 0) ? priceAffectedCustomers_(ss, before, after) : [],
    warning: priceTierWarning_(priceTierRows_(after))
  };
}

/**
 * 画面で決まった内容を、実際に書き換える。
 *
 * 1. 更新前の料金を料金履歴へ残す
 * 2. IDの付け替えを Config と案件ボードの選択の控えに反映する
 * 3. 単価と数量割引を Config へ書き戻す
 * 4. 「今までの単価のまま」を選ばれたお客様に単価調整を入れる
 * 5. 料金設計タブを新しい内容で書き直す
 */
function priceCommitUpdate(picked) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();

  const sheet = ss.getSheetByName(PRICE_SHEET);
  const before = getConfig_();
  const table = priceReadSheet_(sheet);

  const renames = priceRenames_(before, table);
  const after = JSON.parse(JSON.stringify(before));
  priceApplyRenames_(after, renames);
  const changes = priceApplyToConfig_(after, priceAliasCountKeys_(table, renames));

  if (changes.length === 0 && renames.length === 0) {
    return { summary: '表の内容は、いまの料金と同じでした。何も変えていません。', detail: '' };
  }

  priceSaveHistory_(ss, changes.concat(renames.map(function (r) {
    return { name: r.name + '（ID）', before: r.from, after: r.to };
  })), before);

  const renamed = renames.length > 0 ? priceRewriteSelections_(ss, renames) : 0;
  writeConfig_(normalizeConfig_(after));

  const kept = priceKeepPrices_(ss, picked, changes);
  priceRenderSheet_(ss);

  const lines = [];
  changes.forEach(function (c) { lines.push('・' + c.name + '　' + c.before + ' → ' + c.after); });
  renames.forEach(function (r) { lines.push('・' + r.name + ' の ID　' + r.from + ' → ' + r.to); });
  if (renamed > 0) lines.push('・案件ボードの選択の控え ' + renamed + ' 件を、新しいIDに書き換えました');
  kept.forEach(function (k) { lines.push('・' + k); });

  boardLog_('料金', '料金を更新しました: ' +
    changes.map(function (c) { return c.name + ' ' + c.before + '→' + c.after; }).join('／'));

  const summary = '料金を ' + (changes.length + renames.length) + ' 件書き換えました。' +
    (kept.length > 0 ? String.fromCharCode(10) + kept.length + ' 名のお客様は今までの単価のまま据え置きました。' : '') +
    (picked && picked.length === 0 && kept.length === 0
      ? String.fromCharCode(10) + '据え置きは行いませんでした。' : '');

  return { summary: summary, detail: lines.join(String.fromCharCode(10)) };
}

/** 「今までの単価のまま」を選ばれたお客様に、差額を単価調整として足す。 */
function priceKeepPrices_(ss, picked, changes) {
  const list = Array.isArray(picked) ? picked : [];
  if (list.length === 0) return [];

  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  const label = changes.length === 1
    ? changes[0].name + ' の単価変更'
    : '料金改定（' + changes.length + ' 件）';

  const done = [];
  list.forEach(function (item) {
    const customerId = String(item.customerId || '').trim();
    const delta = Number(item.delta || 0);
    if (!customerId || !delta) return;

    const found = boardFindCustomerRow_(ss, customerId);
    if (!found) return;

    // **足し算で入れる。** 値上げを重ねれば、そのぶん積み上がるのが正しい
    const cell = sheet.getRange(found.row, BOARD_CUSTOMER_COL.priceAdjust);
    const next = Number(cell.getValue() || 0) + delta;
    cell.setValue(next);

    const noteCell = sheet.getRange(found.row, BOARD_CUSTOMER_COL.adjustNote);
    const line = label + '（' + priceNow_() + '）　' + (delta > 0 ? '+' : '') + delta + '円/点';
    const was = String(noteCell.getValue() || '').trim();
    noteCell.setValue(was ? was + String.fromCharCode(10) + line : line);

    done.push(customerId + '　' + String(item.name || '') + ' 様を据え置き（単価調整 ' +
      (next > 0 ? '+' : '') + next + '円/点）');
  });

  if (done.length > 0) {
    boardLog_('料金', '単価を据え置きました: ' + done.join('／'));
    priceStampHistory_(ss, done.join(String.fromCharCode(10)));
  }
  return done;
}

// ------------------------------------------------------------
// IDの付け替え
// ------------------------------------------------------------

/**
 * 表で書き換えられたIDを拾う。
 *
 * IDは自動で作られたものが多く（`photo_option_bazsio7` など）、
 * 何のことか分からない。**読みやすい名前に直せるようにする。**
 * 表の行の並びは Config と同じ順なので、位置で突き合わせる。
 */
function priceRenames_(config, table) {
  const expected = priceMenuRows_(config);
  const rows = table.rows || [];

  // **同じIDが2つあると、どちらの単価か決められない**
  const count = {};
  rows.forEach(function (row) { count[row.id] = (count[row.id] || 0) + 1; });
  const doubled = Object.keys(count).filter(function (id) { return count[id] > 1; });
  if (doubled.length > 0) {
    throw new Error('同じIDが2つ以上あります: ' + doubled.join('、') +
      String.fromCharCode(10) + '重ならない名前に直してください。');
  }

  const out = [];
  expected.forEach(function (row, i) {
    const current = rows[i];
    if (!current) return;

    // 行を足したり消したりされていると、位置がずれる。名前が違えば触らない。
    // **シートから読んだ名前は前後の空白が落ちている。** 揃えてから比べる
    if (current.name !== String(row[2] || '').trim()) return;

    const oldId = String(row[1] || '').trim();
    const newId = String(current.id || '').trim();
    if (!newId || newId === oldId) return;
    if (oldId.indexOf('#') >= 0) return;          // 「選択1つあたり」の行は付け替えの対象にしない
    if (!/^[A-Za-z0-9_\-]+$/.test(newId)) {
      throw new Error('ID「' + newId + '」は使えません。' + String.fromCharCode(10) +
        '半角の英数字・アンダースコア・ハイフンだけにしてください（例: photo_flat）。');
    }
    out.push({ from: oldId, to: newId, name: String(row[2] || '').replace(/^[└　 ]+/, '') });
  });
  return out;
}

/**
 * 「選択1つあたり」の行は `<項目ID>#count` という名前で引いている。
 * 項目のIDを付け替えたら、こちらも新しいIDで引けるようにしておく。
 */
function priceAliasCountKeys_(table, renames) {
  renames.forEach(function (r) {
    const found = table.items[r.from + '#count'];
    if (found && !table.items[r.to + '#count']) table.items[r.to + '#count'] = found;
  });
  return table;
}

/** 付け替えたIDを Config に反映する。 */
function priceApplyRenames_(config, renames) {
  const map = {};
  renames.forEach(function (r) { map[r.from] = r.to; });
  (config.menus || []).forEach(function (menu) {
    if (map[menu.id]) menu.id = map[menu.id];
    (menu.items || []).forEach(function (item) {
      if (map[item.id]) item.id = map[item.id];
      (item.subChoices || []).forEach(function (choice) {
        if (map[choice.id]) choice.id = map[choice.id];
      });
    });
  });
}

/**
 * 案件ボードの「選択の控え」を、新しいIDに書き換える。
 * **ここを忘れると、過去の依頼から単価が引けなくなる。**
 */
function priceRewriteSelections_(ss, renames) {
  const sheet = ss.getSheetByName(BOARD_SHEET_CASES);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const map = {};
  renames.forEach(function (r) { map[r.from] = r.to; });
  const swap = function (id) { return map[id] || id; };

  const range = sheet.getRange(2, BOARD_COL.selection, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let changed = 0;

  const next = values.map(function (row) {
    const raw = String(row[0] || '').trim();
    if (!raw) return row;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return row; }
    if (!parsed || !parsed.options) return row;

    const options = {};
    Object.keys(parsed.options).forEach(function (menuId) {
      options[swap(menuId)] = (parsed.options[menuId] || []).map(swap);
    });
    const subChoices = {};
    Object.keys(parsed.subChoices || {}).forEach(function (menuId) {
      const inner = {};
      Object.keys(parsed.subChoices[menuId] || {}).forEach(function (itemId) {
        inner[swap(itemId)] = (parsed.subChoices[menuId][itemId] || []).map(swap);
      });
      subChoices[swap(menuId)] = inner;
    });

    parsed.options = options;
    parsed.subChoices = subChoices;
    const text = JSON.stringify(parsed);
    if (text === raw) return row;
    changed++;
    return [text];
  });

  if (changed > 0) range.setValues(next);
  return changed;
}

/** 自動で作られたIDか。読みやすい名前を勧めるかどうかの判断に使う。 */
function priceIsMachineId_(id) {
  return /_(option|text|choice)_[a-z0-9]{4,}$/.test(String(id || ''));
}

// ------------------------------------------------------------
// IDの整理
// ------------------------------------------------------------

/**
 * 自動で作られたIDを、メニューに合わせた読みやすい名前に付け替える。
 *
 * 見積もりフォームが作るIDは `photo_option_bazsio7` のような形で、
 * 表を見ても何のことか分からない。`photo_2` のようにメニューを頭に付け、
 * 上から順に番号を振る。**手で付けたIDには触らない。**
 * そのため、初期セットアップを何度実行しても同じ結果になる。
 */
function priceTidyIds_(ss) {
  const config = getConfig_();
  const used = {};
  (config.menus || []).forEach(function (menu) {
    used[menu.id] = true;
    (menu.items || []).forEach(function (item) {
      used[item.id] = true;
      (item.subChoices || []).forEach(function (c) { used[c.id] = true; });
    });
  });

  const pick = function (base) {
    if (!used[base]) { used[base] = true; return base; }
    for (let i = 2; i < 100; i++) {
      if (!used[base + '_' + i]) { used[base + '_' + i] = true; return base + '_' + i; }
    }
    return '';
  };

  const renames = [];
  (config.menus || []).forEach(function (menu) {
    let option = 0;
    let memo = 0;
    (menu.items || []).forEach(function (item) {
      const isText = item.type === 'text';
      if (isText) memo++; else option++;
      const base = isText ? menu.id + '_memo' + memo : menu.id + '_' + option;

      if (priceIsMachineId_(item.id)) {
        const to = pick(base);
        if (to) renames.push({ from: item.id, to: to, name: menu.name + '：' + item.name });
      }
      (item.subChoices || []).forEach(function (choice, k) {
        if (!priceIsMachineId_(choice.id)) return;
        const to = pick(menu.id + '_' + option + '_' + (k + 1));
        if (to) renames.push({ from: choice.id, to: to, name: menu.name + '：' + item.name + ' > ' + choice.name });
      });
    });
  });

  if (renames.length === 0) return 0;

  priceApplyRenames_(config, renames);
  const rewritten = priceRewriteSelections_(ss, renames);
  writeConfig_(normalizeConfig_(config));

  boardLog_('料金', 'IDを読みやすい名前に付け替えました（' + renames.length + ' 件）: ' +
    renames.slice(0, 6).map(function (r) { return r.from + '→' + r.to; }).join('／') +
    (renames.length > 6 ? ' ほか' : '') +
    '　選択の控え ' + rewritten + ' 件も書き換えました');
  return renames.length;
}
