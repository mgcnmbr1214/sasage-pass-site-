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

/** 「ボタン」を置く行。チェックを入れると動き、終わると自動で外れる。 */
const PRICE_ROW_BUTTONS = 8;
const PRICE_COL_UPDATE = 1;
const PRICE_COL_RELOAD = 4;
const PRICE_ROW_STAMP = 9;

const PRICE_HEAD_MENUS = '■ メニューの単価';
const PRICE_HEAD_TIERS = '■ 数量割引';
const PRICE_MENU_HEADERS = ['種別', 'ID', '名前', '単価', '有効', '説明'];
const PRICE_TIER_HEADERS = ['段の名前', '下限点数', '割引の種類', '値', '有効', ''];

const PRICE_HISTORY_HEADERS = ['日時', '変えた内容', '据え置いたお客様', '控え（JSON）'];

/** 表の使い方。**シートを開いた人が、これだけ読めば分かるように。** */
const PRICE_GUIDE = [
  '【料金設計】ササゲパスの料金は、すべてこの表が大もとです。',
  '直せるのは「単価」「有効」「下限点数」「値」だけです。グレーの列（種別・ID・名前）は直しても反映されません。',
  '直したら、下の「料金を更新する」に ✓ を入れてください。処理が終わると ✓ は自動で外れます。',
  '✓ を入れると → ①見積もりフォームの表示価格　②依頼フォームの内容　③請求書の単価　が、すべてこの表の値になります。',
  '　　　　　　　→ 変えたメニューをご依頼中のお客様がいれば、単価を据え置くかどうかを確認する画面が出ます。',
  '　　　　　　　→ 更新前の内容は「料金履歴」タブに残るので、元に戻せます。',
  '※ 初期セットアップを実行すると、この表はいまの料金で書き直されます（更新していない編集は消えます）。'
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

  // ボタン
  sheet.getRange(PRICE_ROW_BUTTONS, PRICE_COL_UPDATE)
    .insertCheckboxes().setValue(false);
  sheet.getRange(PRICE_ROW_BUTTONS, PRICE_COL_UPDATE + 1)
    .setValue('← 料金を更新する').setFontWeight('bold').setFontColor('#A32D2D');
  sheet.getRange(PRICE_ROW_BUTTONS, PRICE_COL_RELOAD)
    .insertCheckboxes().setValue(false);
  sheet.getRange(PRICE_ROW_BUTTONS, PRICE_COL_RELOAD + 1)
    .setValue('← 表を読み込み直す（編集を捨てて、いまの料金に戻す）').setFontColor('#5A6A8A');
  sheet.getRange(PRICE_ROW_BUTTONS, 1, 1, width).setBackground('#F1EFE8');

  const history = ss.getSheetByName(PRICE_HISTORY_SHEET);
  const count = history && history.getLastRow() > 1 ? history.getLastRow() - 1 : 0;
  sheet.getRange(PRICE_ROW_STAMP, 1).setValue(
    '表を書き出した日時: ' + priceNow_() + '　／　料金履歴 ' + count + ' 件'
  ).setFontColor('#8A97B8');

  let row = PRICE_ROW_BUTTONS + 3;
  row = priceWriteTable_(sheet, row, PRICE_HEAD_MENUS, PRICE_MENU_HEADERS, menuRows, [4, 5]);
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

/** 見出し＋表を1つ書いて、次に使える行番号を返す。編集していい列だけ白く残す。 */
function priceWriteTable_(sheet, row, title, headers, rows, editable) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold').setFontColor('#2C3E63');
  const head = row + 1;
  sheet.getRange(head, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#F1EFE8');
  if (rows.length > 0) {
    sheet.getRange(head + 1, 1, rows.length, headers.length).setValues(rows);
    // **直しても反映されない列は、グレーにして見分けられるようにする**
    for (let c = 1; c <= headers.length; c++) {
      if (editable.indexOf(c) >= 0) continue;
      sheet.getRange(head + 1, c, rows.length, 1).setFontColor('#8A97B8');
    }
    editable.forEach(function (c) {
      sheet.getRange(head + 1, c, rows.length, 1).setBackground('#FFFFFF').setFontWeight('bold');
    });
  }
  return head + rows.length;
}

/** メニュー・オプション・サイト選択を、上から順に1行ずつ。 */
function priceMenuRows_(config) {
  const rows = [];
  (config.menus || []).forEach(function (menu) {
    rows.push(['メニュー', menu.id, menu.name, '', menu.enabled !== false, priceOneLine_(menu.description)]);
    (menu.items || []).forEach(function (item) {
      if (item.type === 'text') {
        rows.push(['記述項目', item.id, '└ ' + item.name, '', item.enabled !== false, 'お客様に自由に書いていただく欄（料金なし）']);
        return;
      }
      rows.push(['オプション', item.id, '└ ' + item.name,
        Number(item.unitPrice || 0), item.enabled !== false, priceOneLine_(item.description)]);

      const mode = item.subChoicePricingMode;
      if (mode === 'count') {
        rows.push(['選択1つあたり', item.id + '#count', '　└ 選んだ数 × この単価',
          Number(item.subChoiceCountUnitPrice || 0), true, '下の選択肢は、個別の単価ではなく「選んだ数」で計算します']);
      }
      (item.subChoices || []).forEach(function (choice) {
        rows.push([mode === 'choice' ? 'サイト選択' : 'サイト選択（料金なし）',
          choice.id, '　└ ' + choice.name,
          mode === 'choice' ? Number(choice.unitPrice || 0) : '',
          choice.enabled !== false,
          mode === 'choice' ? '' : '選んでも単価は変わりません']);
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
  for (let r = menuAt + 2; r <= last; r++) {
    const kind = String(values[r - 1][0] || '').trim();
    if (!kind) break;
    const id = String(values[r - 1][1] || '').trim();
    if (!id) continue;
    items[id] = {
      kind: kind,
      name: String(values[r - 1][2] || '').trim(),
      price: values[r - 1][3],
      enabled: values[r - 1][4] !== false
    };
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
  return { items: items, tiers: tiers };
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
 * シートのチェックボックスを「ボタン」として使う。
 *
 * スプレッドシートに図形のボタンをスクリプトから置くことはできない。
 * チェックを入れる → ここが動く → チェックが自動で外れる、という形にしている。
 */
function priceOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== PRICE_SHEET) return;
  if (e.range.getRow() !== PRICE_ROW_BUTTONS) return;
  if (e.value !== 'TRUE') return;

  const col = e.range.getColumn();
  try {
    if (col === PRICE_COL_UPDATE) priceUpdate_();
    else if (col === PRICE_COL_RELOAD) priceReload_();
    else return;
  } catch (err) {
    boardLog_('料金', 'エラー: ' + err.message);
    SpreadsheetApp.getUi().alert('料金の更新に失敗しました。' + String.fromCharCode(10, 10) + err.message);
  } finally {
    e.range.setValue(false);
  }
}

/** 編集を捨てて、いまの Config の値で表を書き直す。 */
function priceReload_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  priceRenderSheet_(ss);
  SpreadsheetApp.getUi().alert('いまの料金で表を書き直しました。');
}

/**
 * 表の値を料金の大もとへ書き戻す。
 *
 * ここを押した瞬間から、見積もりフォーム・依頼フォーム・請求書の単価が変わる。
 * **変える前の中身は必ず料金履歴に残す。** 戻せないと怖くて押せない。
 */
function priceUpdate_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();

  const sheet = ss.getSheetByName(PRICE_SHEET);
  const before = getConfig_();
  const table = priceReadSheet_(sheet);

  const config = JSON.parse(JSON.stringify(before));
  const changes = priceApplyToConfig_(config, table);

  if (changes.length === 0) {
    SpreadsheetApp.getUi().alert('表といまの料金に違いがありませんでした。何も変えていません。');
    return;
  }

  // 据え置きの差額は、書き換える前に出しておく
  const affected = priceAffectedCustomers_(ss, before, config);

  priceSaveHistory_(ss, changes, before);
  writeConfig_(normalizeConfig_(config));
  priceRenderSheet_(ss);
  boardLog_('料金', '料金を更新しました（' + changes.length + ' 件）: ' +
    changes.map(function (c) { return c.name + ' ' + c.before + '→' + c.after; }).join('／'));

  const warning = priceTierWarning_(priceTierRows_(config));
  const summary = changes.map(function (c) { return '・' + c.name + '　' + c.before + ' → ' + c.after; })
    .join(String.fromCharCode(10)) +
    (warning ? String.fromCharCode(10, 10) + warning : '');

  if (affected.length === 0) {
    SpreadsheetApp.getUi().alert(
      '料金を更新しました（' + changes.length + ' 件）。' + String.fromCharCode(10, 10) +
      summary + String.fromCharCode(10, 10) +
      '単価が変わるお客様はいませんでした。'
    );
    return;
  }

  // 据え置くかどうかは人が決める。**勝手には入れない**
  const html = HtmlService.createTemplateFromFile('PriceAdjust');
  html.changes = changes;
  html.affected = affected;
  SpreadsheetApp.getUi().showModalDialog(
    html.evaluate().setWidth(700).setHeight(580), '単価を据え置きますか'
  );
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

/**
 * 画面で選ばれたお客様に、据え置きぶんの単価調整を入れる。
 *
 * **足し算で入れる。** 値上げを重ねれば、そのぶん積み上がるのが正しい。
 * 理由も1行ずつ足していく。上書きすると、前回何をしたのか分からなくなる。
 */
function priceApplyAdjustments(picked, label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  boardUseCurrentColumns_();
  const list = Array.isArray(picked) ? picked : [];
  if (list.length === 0) return { message: '据え置きは入れませんでした。' };

  const sheet = ss.getSheetByName(BOARD_SHEET_CUSTOMERS);
  const applied = [];
  list.forEach(function (item) {
    const customerId = String(item.customerId || '').trim();
    const delta = Number(item.delta || 0);
    if (!customerId || !delta) return;

    const found = boardFindCustomerRow_(ss, customerId);
    if (!found) return;

    const cell = sheet.getRange(found.row, BOARD_CUSTOMER_COL.priceAdjust);
    const next = Number(cell.getValue() || 0) + delta;
    cell.setValue(next);

    const noteCell = sheet.getRange(found.row, BOARD_CUSTOMER_COL.adjustNote);
    const line = String(label || '料金改定') + '（' + priceNow_() + '）　' +
      (delta > 0 ? '+' : '') + delta + '円/点';
    const was = String(noteCell.getValue() || '').trim();
    noteCell.setValue(was ? was + String.fromCharCode(10) + line : line);

    applied.push(customerId + ' ' + (delta > 0 ? '+' : '') + delta + '円 → 単価調整 ' + next);
  });

  if (applied.length > 0) {
    boardLog_('料金', '単価を据え置きました: ' + applied.join('／'));
    priceStampHistory_(ss, applied.join(String.fromCharCode(10)));
  }
  return { message: applied.length + ' 名のお客様に据え置きを入れました。' };
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
