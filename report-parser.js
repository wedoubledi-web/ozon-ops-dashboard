/** Парсер отчёта Ozon analytics_report*.xlsx — зеркало ozon_analytics_report.py */

const PERIOD_LABEL_MAP = {
  "7 дней": "7d",
  "7 дн": "7d",
  вчера: "yesterday",
  "1 день": "yesterday",
  "1 дн": "yesterday",
  сегодня: "today",
  "28 дней": "28d",
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
};

function periodKeyFromLabel(label) {
  if (!label) return "7d";
  const k = PERIOD_LABEL_MAP[String(label).trim().toLowerCase()];
  return k || "7d";
}

function num(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") return val;
  const n = parseFloat(String(val).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function skuFromLink(link) {
  if (!link) return null;
  const m = String(link).match(/\/product\/(\d+)/);
  return m ? m[1] : null;
}

function parseSheetRows(rows, fileName) {
  const meta = { file_name: fileName };
  for (let r = 0; r < 3; r++) {
    const label = rows[r]?.[0];
    const val = rows[r]?.[1];
    if (label === "Дата формирования:") meta.formed_at = val != null ? String(val) : null;
    if (label === "Период отчета:") meta.period_label = val != null ? String(val) : null;
    if (label === "Мои товары:") meta.my_products_only = val != null ? String(val) : null;
  }

  const headerRow = rows[4] || [];
  const colByHeader = {};
  headerRow.forEach((h, i) => {
    if (h) colByHeader[String(h).trim()] = i;
  });

  const products = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    if (name === "Среднее значение по товарам" || name === "Название товара") continue;

    const linkCol = colByHeader["Ссылка на товар"] ?? 1;
    const link = row[linkCol];
    const sku = skuFromLink(link);
    if (!sku) continue;

    const item = {
      sku,
      name,
      link: link ? String(link) : "",
      offer_id: "",
    };
    for (const [hdr, key] of Object.entries(HEADER_MAP)) {
      const c = colByHeader[hdr];
      if (c != null) item[key] = num(row[c]);
    }
    if (item.views_pdp && item.ordered_units) {
      item.conv_pdp_to_order_pct = Math.round((item.ordered_units / item.views_pdp) * 10000) / 100;
    }
    products.push(item);
  }

  const active = products.filter((p) => (p.views_pdp || 0) > 0 || (p.ordered_units || 0) > 0);
  const summary = {
    ordered_units: active.reduce((s, p) => s + (p.ordered_units || 0), 0),
    revenue_rub: active.reduce((s, p) => s + (p.revenue_rub || 0), 0),
    views_pdp: active.reduce((s, p) => s + (p.views_pdp || 0), 0),
    views_search: active.reduce((s, p) => s + (p.views_search || 0), 0),
    views_total: active.reduce((s, p) => s + (p.views_total || 0), 0),
    sku_count: active.length,
  };
  if (summary.views_pdp) {
    summary.conv_pdp_to_order_pct = Math.round((summary.ordered_units / summary.views_pdp) * 10000) / 100;
  }
  if (summary.views_search) {
    summary.conv_search_to_pdp_pct = Math.round((summary.views_pdp / summary.views_search) * 10000) / 100;
  }

  meta.period_key = periodKeyFromLabel(meta.period_label);
  meta.parsed_at = new Date().toISOString();

  active.sort((a, b) => (b.ordered_units || 0) - (a.ordered_units || 0));

  return { meta, summary, products: active };
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
    if (pk === "7d" && p.stock_end != null && p.stock_end > 0 && p.stock_end < 20 && (p.ads_units || 0) >= 1) {
      alerts.push({ level: "warn", text: `Мало на складе (${Math.round(p.stock_end)} шт) — ${offer}` });
    }
    if (p.conv_pdp_to_order_pct != null && p.conv_pdp_to_order_pct < 1 && (p.views_pdp || 0) >= 200) {
      alerts.push({ level: "critical", text: `Низкая конверсия ${p.conv_pdp_to_order_pct}% — ${offer}` });
    }
  }
  return alerts;
}

function parseWorkbookArrayBuffer(buf, fileName) {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return parseSheetRows(rows, fileName);
}

window.OzonReportParser = {
  parseWorkbookArrayBuffer,
  parseSheetRows,
  alertsFromReport,
  periodKeyFromLabel,
};
