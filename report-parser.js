/** Парсер отчёта Ozon analytics_report*.xlsx */

const PERIOD_LABEL_MAP = {
  "7 дней": "7d",
  "7 дн": "7d",
  вчера: "yesterday",
  "1 день": "yesterday",
  "1 дн": "yesterday",
  сегодня: "today",
  "28 дней": "28d",
  "28 дн": "28d",
};

const HEADER_MAP = {
  "Заказано, штуки": "ordered_units",
  "Заказано на сумму, ₽": "revenue_rub",
  "Динамика оборота, %": "revenue_dyn_pct",
  "Остаток на конец периода, штуки": "stock_end",
  "Показы всего": "views_total",
  "Просмотры в поиске и каталоге": "views_search",
  "Просмотры карточки": "views_pdp",
  "Конверсия из показа в заказ, %": "conv_view_to_order_pct",
  "В корзину из поиска и каталога, %": "conv_cart_search_pct",
  "В корзину из карточки, %": "conv_cart_pdp_pct",
  "Доля рекламных расходов, %": "drr_pct",
  "Доля выкупа, %": "buyout_pct",
  "Упущенные продажи": "missed_sales_rub",
  "Среднесуточные продажи, штуки": "ads_units",
  "Средняя цена, ₽": "avg_price_rub",
};

function periodKeyFromLabel(label) {
  if (!label) return "7d";
  const k = PERIOD_LABEL_MAP[String(label).trim().toLowerCase()];
  return k || "7d";
}

function num(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const n = parseFloat(String(val).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function skuFromLink(link) {
  if (!link) return null;
  const m = String(link).match(/\/product\/(\d+)/);
  return m ? m[1] : null;
}

function findHeaderRowIndex(rows) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    if (row.some((c) => String(c || "").trim() === "Название товара")) return r;
    if (row.some((c) => String(c || "").trim() === "Заказано, штуки")) return r;
  }
  return 4;
}

function detectReportKind(meta, fileName, forcedKind) {
  if (forcedKind) return forcedKind;
  const fn = (fileName || "").toLowerCase();
  if (/конкурент|competitor|beltovar|товары на ozon/.test(fn)) return "competitor";
  const mp = (meta.my_products_only || "").toLowerCase();
  if (mp === "нет" || mp === "no") return "competitor";
  if (mp === "да" || mp === "yes") return "mine";
  return "mine";
}

function parseSheetRows(rows, fileName, forcedKind) {
  if (!rows || rows.length < 5) {
    throw new Error("Файл слишком короткий — это не отчёт Ozon?");
  }

  const meta = { file_name: fileName };
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const label = rows[r]?.[0];
    const val = rows[r]?.[1];
    if (label === "Дата формирования:") meta.formed_at = val != null ? String(val) : null;
    if (label === "Период отчета:") meta.period_label = val != null ? String(val) : null;
    if (label === "Мои товары:") meta.my_products_only = val != null ? String(val) : null;
  }

  const headerIdx = findHeaderRowIndex(rows);
  const headerRow = rows[headerIdx] || [];
  const colByHeader = {};
  headerRow.forEach((h, i) => {
    if (h) colByHeader[String(h).trim()] = i;
  });

  if (colByHeader["Заказано, штуки"] == null && colByHeader["Ссылка на товар"] == null) {
    throw new Error("Не нашёл колонки отчёта Ozon — проверь, что это analytics_report.xlsx");
  }

  const products = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    if (
      name === "Среднее значение по товарам" ||
      name === "Название товара" ||
      name.startsWith("Итого")
    ) {
      continue;
    }

    const linkCol = colByHeader["Ссылка на товар"] ?? 1;
    const link = row[linkCol];
    const sku = skuFromLink(link);
    if (!sku) continue;

    const sellerCol = colByHeader["Продавец"];
    const item = {
      sku,
      name,
      link: link ? String(link) : "",
      seller: sellerCol != null && row[sellerCol] ? String(row[sellerCol]) : "",
      offer_id: "",
    };
    const pair = (window.OzonCompetitorPairs?.SKU_PAIRS || []).find(
      (p) => p.mine === sku || p.comp === sku
    );
    if (pair) item.offer_id = pair.label;
    for (const [hdr, key] of Object.entries(HEADER_MAP)) {
      const c = colByHeader[hdr];
      if (c != null) item[key] = num(row[c]);
    }
    if (item.views_pdp && item.ordered_units) {
      item.conv_pdp_to_order_pct = Math.round((item.ordered_units / item.views_pdp) * 10000) / 100;
    }
    products.push(item);
  }

  if (!products.length) {
    throw new Error("В файле нет строк с товарами — проверь период и фильтры в Ozon");
  }

  const active = products.filter((p) => (p.views_pdp || 0) > 0 || (p.ordered_units || 0) > 0);
  const list = active.length ? active : products;

  const summary = {
    ordered_units: list.reduce((s, p) => s + (p.ordered_units || 0), 0),
    revenue_rub: list.reduce((s, p) => s + (p.revenue_rub || 0), 0),
    views_pdp: list.reduce((s, p) => s + (p.views_pdp || 0), 0),
    views_search: list.reduce((s, p) => s + (p.views_search || 0), 0),
    views_total: list.reduce((s, p) => s + (p.views_total || 0), 0),
    sku_count: list.length,
  };
  if (summary.views_pdp) {
    summary.conv_pdp_to_order_pct = Math.round((summary.ordered_units / summary.views_pdp) * 10000) / 100;
  }
  if (summary.views_search) {
    summary.conv_search_to_pdp_pct = Math.round((summary.views_pdp / summary.views_search) * 10000) / 100;
  }

  meta.period_key = periodKeyFromLabel(meta.period_label);
  meta.parsed_at = new Date().toISOString();
  meta.report_kind = detectReportKind(meta, fileName, forcedKind);

  list.sort((a, b) => (b.ordered_units || 0) - (a.ordered_units || 0));

  return { meta, summary, products: list };
}

function alertsFromReport(report) {
  const alerts = [];
  const pk = report.meta.period_key;
  for (const p of report.products) {
    const offer = p.offer_id || p.name.slice(0, 40);
    if (pk === "7d" && p.drr_pct != null && p.drr_pct > 25) {
      alerts.push({ level: "critical", text: `ДРР ${Math.round(p.drr_pct)}% — ${offer}` });
    }
    if (pk === "yesterday" && p.drr_pct != null && p.drr_pct > 40 && (p.ordered_units || 0) >= 1) {
      alerts.push({ level: "warn", text: `ДРР ${Math.round(p.drr_pct)}% вчера — ${offer}` });
    }
    const minViews = pk === "yesterday" ? 30 : 100;
    if (p.conv_cart_pdp_pct != null && p.conv_cart_pdp_pct < 5 && (p.views_pdp || 0) >= minViews) {
      alerts.push({ level: "warn", text: `Слабая корзина ${p.conv_cart_pdp_pct.toFixed(1)}% — ${offer}` });
    }
    if (pk === "7d" && p.revenue_dyn_pct != null && p.revenue_dyn_pct <= -30 && (p.ordered_units || 0) >= 2) {
      alerts.push({ level: "warn", text: `Оборот ↓${Math.abs(Math.round(p.revenue_dyn_pct))}% — ${offer}` });
    }
    if (p.conv_pdp_to_order_pct != null && p.conv_pdp_to_order_pct < 1 && (p.views_pdp || 0) >= 200) {
      alerts.push({ level: "critical", text: `Низкая конверсия ${p.conv_pdp_to_order_pct}% — ${offer}` });
    }
  }
  return alerts;
}

function parseWorkbookArrayBuffer(buf, fileName, forcedKind) {
  if (typeof XLSX === "undefined") {
    throw new Error("Библиотека Excel не загрузилась — обнови страницу");
  }
  let wb;
  try {
    wb = XLSX.read(buf, { type: "array" });
  } catch (e) {
    throw new Error("Не удалось прочитать Excel: " + (e.message || "битый файл"));
  }
  if (!wb.SheetNames?.length) throw new Error("В файле нет листов");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return parseSheetRows(rows, fileName, forcedKind);
}

function indexBySku(products) {
  const m = {};
  for (const p of products || []) m[String(p.sku)] = p;
  return m;
}

function buildWeeklyComparison(mineReport, compReport) {
  const pairs = window.OzonCompetitorPairs?.SKU_PAIRS || [];
  const mine = indexBySku(mineReport?.products);
  const comp = indexBySku(compReport?.products);

  const rows = [];
  let totalMine = 0;
  let totalComp = 0;

  for (const pair of pairs) {
    const our = mine[pair.mine];
    const c = comp[pair.comp];
    const ourOrders = our?.ordered_units || 0;
    const compOrders = c?.ordered_units || 0;
    totalMine += ourOrders;
    totalComp += compOrders;
    const gap = compOrders - ourOrders;
    const total = ourOrders + compOrders;
    const share = total > 0 ? Math.round((ourOrders / total) * 1000) / 10 : null;
    rows.push({
      label: pair.label,
      who: pair.who,
      our_sku: pair.mine,
      comp_sku: pair.comp,
      our_orders: ourOrders,
      comp_orders: compOrders,
      gap,
      share,
      our_conv: our?.conv_pdp_to_order_pct,
      comp_conv: c?.conv_pdp_to_order_pct,
      our_pdp: our?.views_pdp,
      comp_pdp: c?.views_pdp,
      comp_seller: c?.seller || pair.who,
      status: gap > 5 ? "lose" : gap < -2 ? "win" : "parity",
    });
  }

  rows.sort((a, b) => b.gap - a.gap);

  return {
    rows,
    total_mine: totalMine,
    total_comp: totalComp,
    share_total: totalMine + totalComp > 0 ? Math.round((totalMine / (totalMine + totalComp)) * 1000) / 10 : null,
    mine_file: mineReport?.meta?.file_name,
    comp_file: compReport?.meta?.file_name,
    period: mineReport?.meta?.period_label || "7 дней",
  };
}

window.OzonReportParser = {
  parseWorkbookArrayBuffer,
  parseSheetRows,
  alertsFromReport,
  periodKeyFromLabel,
  buildWeeklyComparison,
  indexBySku,
};
