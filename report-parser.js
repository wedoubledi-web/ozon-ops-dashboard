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

function periodFromFileName(fileName) {
  const fn = String(fileName || "").toLowerCase();
  if (/вчera|yesterday|1-?day|1d|1_?dn/.test(fn)) return "Вчера";
  if (/7d|7-?day|7_?days|7_?dn/.test(fn)) return "7 дней";
  return null;
}

function skuFromRow(row, colByHeader, linkCol) {
  const link = row[linkCol];
  let sku = skuFromLink(link);
  if (sku) return sku;
  if (link && /^\d{8,}$/.test(String(link).trim())) return String(link).trim();
  for (const hdr of ["SKU", "Ozon SKU", "Ozon ID", "sku", "Артикул"]) {
    const c = colByHeader[hdr];
    if (c == null || row[c] == null) continue;
    const digits = String(row[c]).replace(/\D/g, "");
    if (digits.length >= 8) return digits;
  }
  for (const cell of row) {
    sku = skuFromLink(cell);
    if (sku) return sku;
  }
  return null;
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
  if (!rows || rows.length < 2) {
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
  if (!meta.period_label) {
    const fromFn = periodFromFileName(fileName);
    if (fromFn) meta.period_label = fromFn;
    else if (forcedKind === "competitor") meta.period_label = "7 дней";
    else if (forcedKind === "mine") meta.period_label = "Вчера";
  }

  const headerIdx = findHeaderRowIndex(rows);
  const headerRow = rows[headerIdx] || [];
  const colByHeader = {};
  headerRow.forEach((h, i) => {
    if (h) colByHeader[String(h).trim()] = i;
  });

  if (colByHeader["Заказано, штуки"] == null && colByHeader["Ссылка на товар"] == null) {
    throw new Error("Не нашёл колонки отчёта Ozon — проверь, что это analytics_report (.xlsx / .csv)");
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
    const sku = skuFromRow(row, colByHeader, linkCol);
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

  const report = { meta, summary, products: list };
  if (meta.period_key === "yesterday") {
    enrichYesterdayReport(report);
  }
  return report;
}

function prevFromDyn(cur, dynPct) {
  if (cur == null || dynPct == null || dynPct === -100) return null;
  const d = 1 + dynPct / 100;
  if (d === 0) return null;
  const v = cur / d;
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function enrichYesterdayReport(report) {
  for (const p of report.products) {
    p.revenue_prev = prevFromDyn(p.revenue_rub, p.revenue_dyn_pct);
    if (p.revenue_dyn_pct != null) p.revenue_dyn_pct = Number(p.revenue_dyn_pct);
  }
  report.meta.compare_label = "вчера vs позавчera";
}

function mergeSkuWithOps(product, opsSku) {
  if (!opsSku) return product;
  const p = { ...product };
  const o = opsSku;
  p.offer_id = p.offer_id || o.offer_id || "";
  p.orders_delta_pct = o.orders_delta_pct ?? p.orders_delta_pct;
  p.pdp_views_delta_pct = o.pdp_views_delta_pct ?? p.pdp_views_delta_pct;
  p.search_views_delta_pct = o.search_views_delta_pct ?? p.search_views_delta_pct;
  p.conv_delta_pp = o.conv_delta_pp ?? p.conv_delta_pp;
  p.conv_pdp_to_order_prev_pct = o.conv_pdp_to_order_prev_pct ?? p.conv_pdp_to_order_prev_pct;
  if (o.pdp_views != null) p.views_pdp = o.pdp_views;
  if (o.search_views != null) p.views_search = o.search_views;
  if (o.ordered_units != null) p.ordered_units = o.ordered_units;
  if (o.conv_pdp_to_order_pct != null) p.conv_pdp_to_order_pct = o.conv_pdp_to_order_pct;
  p.orders_prev = prevFromDyn(p.ordered_units, p.orders_delta_pct);
  p.pdp_prev = prevFromDyn(p.views_pdp, p.pdp_views_delta_pct);
  p.search_prev = prevFromDyn(p.views_search, p.search_views_delta_pct);
  if (p.conv_pdp_to_order_prev_pct == null && p.pdp_prev && p.orders_prev != null) {
    p.conv_pdp_to_order_prev_pct = Math.round((p.orders_prev / p.pdp_prev) * 10000) / 100;
  }
  if (p.conv_delta_pp == null && p.conv_pdp_to_order_pct != null && p.conv_pdp_to_order_prev_pct != null) {
    p.conv_delta_pp = Math.round((p.conv_pdp_to_order_pct - p.conv_pdp_to_order_prev_pct) * 100) / 100;
  }
  return p;
}

function buildDayOverDayRows(uploadedReport, opsDaily) {
  const opsBySku = indexBySku(opsDaily?.skus);
  const sourceProducts = uploadedReport?.products?.length
    ? uploadedReport.products
    : (opsDaily?.skus || []).map((o) => ({
        sku: o.sku,
        name: o.name,
        offer_id: o.offer_id,
        ordered_units: o.ordered_units,
        views_pdp: o.pdp_views,
        views_search: o.search_views,
        conv_pdp_to_order_pct: o.conv_pdp_to_order_pct,
      }));

  const rows = [];
  for (const prod of sourceProducts) {
    const merged = mergeSkuWithOps(prod, opsBySku[String(prod.sku)]);
    if (!(merged.ordered_units || merged.views_pdp || merged.orders_prev)) continue;
    rows.push({
      sku: merged.sku,
      label: merged.offer_id || merged.name?.slice(0, 32) || merged.sku,
      orders: merged.ordered_units || 0,
      orders_prev: merged.orders_prev,
      orders_delta_pct: merged.orders_delta_pct,
      pdp: merged.views_pdp || 0,
      pdp_prev: merged.pdp_prev,
      pdp_delta_pct: merged.pdp_views_delta_pct,
      conv: merged.conv_pdp_to_order_pct,
      conv_prev: merged.conv_pdp_to_order_prev_pct,
      conv_delta_pp: merged.conv_delta_pp,
      revenue_dyn_pct: merged.revenue_dyn_pct,
    });
  }
  rows.sort((a, b) => {
    const ad = a.conv_delta_pp ?? 0;
    const bd = b.conv_delta_pp ?? 0;
    if (ad !== bd) return ad - bd;
    return (a.orders_delta_pct ?? 0) - (b.orders_delta_pct ?? 0);
  });
  return {
    rows,
    source: uploadedReport ? "upload" : opsDaily?.skus?.length ? "auto" : "none",
    file: uploadedReport?.meta?.file_name,
    period: uploadedReport?.meta?.period_label || "Вчера",
    prev_from: opsDaily?.prev_from,
    prev_to: opsDaily?.prev_to,
    summary: uploadedReport?.summary || opsDaily?.summary,
  };
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

function fileExt(fileName) {
  const m = String(fileName || "").match(/\.([^.]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function decodeCsvText(buf) {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function detectCsvDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const semi = (sample.match(/;/g) || []).length;
  const comma = (sample.match(/,/g) || []).length;
  return semi > comma ? ";" : ",";
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === delim && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function rowsFromCsvManual(text) {
  const FS = detectCsvDelimiter(text);
  return text
    .split(/\r?\n/)
    .filter((l) => l.length)
    .map((l) => splitCsvLine(l, FS));
}

function rowsLookLikeOzon(rows) {
  return (
    rows.length >= 2 &&
    rows.some((r) => r && r.some((c) => String(c || "").includes("Название товара")))
  );
}

function rowsFromCsv(buf) {
  const text = decodeCsvText(buf);
  const manual = rowsFromCsvManual(text);
  if (rowsLookLikeOzon(manual)) return manual;
  throw new Error(
    "CSV не похож на отчёт Ozon — нужны колонки «Название товара» и «Ссылка на товар». Скачай из Аналитика → What to sell"
  );
}

function rowsFromXlsx(buf) {
  const wb = XLSX.read(buf, { type: "array" });
  if (!wb.SheetNames?.length) throw new Error("В файле нет листов");
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

function readRowsFromFile(buf, fileName) {
  const ext = fileExt(fileName);
  if (ext === "csv") return rowsFromCsv(buf);
  if (ext === "xlsx" || ext === "xls") {
    if (typeof XLSX === "undefined") {
      throw new Error("Для xlsx нужна библиотека таблиц — обнови страницу или загрузи csv");
    }
    return rowsFromXlsx(buf);
  }
  throw new Error("Формат не поддерживается — нужен .xlsx или .csv");
}

function parseFileArrayBuffer(buf, fileName, forcedKind) {
  let rows;
  try {
    rows = readRowsFromFile(buf, fileName);
  } catch (e) {
    throw new Error(e.message || "Не удалось прочитать файл");
  }
  return parseSheetRows(rows, fileName, forcedKind);
}

/** @deprecated alias */
function parseWorkbookArrayBuffer(buf, fileName, forcedKind) {
  return parseFileArrayBuffer(buf, fileName, forcedKind);
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
  parseFileArrayBuffer,
  parseWorkbookArrayBuffer,
  parseSheetRows,
  alertsFromReport,
  periodKeyFromLabel,
  buildWeeklyComparison,
  buildDayOverDayRows,
  indexBySku,
  enrichYesterdayReport,
};
