/* РНП 2.0 — диагностика воронки. Null ≠ 0. Потери этапов не суммировать. */
(function (root) {
  const DEFAULT_CONFIG = {
    window_days: 7,
    status: [
      { id: "strong", min: 10, label: "СИЛЬНЕЕ", tone: "strong" },
      { id: "even", min: -10, label: "СОПОСТАВИМО", tone: "even" },
      { id: "mild", min: -20, label: "УМЕРЕННАЯ ПРОСАДКА", tone: "mild" },
      { id: "heavy", min: -35, label: "СИЛЬНАЯ ПРОСАДКА", tone: "heavy" },
      { id: "critical", min: null, label: "КРИТИЧЕСКАЯ ПРОСАДКА", tone: "critical" }
    ],
    sample_min: { ctr: 500, card_cart: 50, cart_order: 20, order_purchase: 10 },
    oos_warn_missing_days: 5,
    oos_period_days: 28,
    trend: { even_pp: 0.3 },
    change_types: ["Главная", "Инфографика", "Цена", "SEO", "Реклама", "Поставка", "Отзывы", "Rich content", "Видео", "Другое"]
  };
  const STAGES = [
    ["ctr", "Показ → Карточка", "views", "Показы"],
    ["card_cart", "Карточка → Корзина", "pdp", "Посещения"],
    ["cart_order", "Корзина → Заказ", "carts", "Корзины"],
    ["order_purchase", "Заказ → Выкуп", "orders", "Заказы"]
  ];

  function n(v) {
    if (v == null || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  function ratio(num, den) {
    if (num == null || den == null || !den) return null;
    return num / den;
  }
  function median(vals) {
    const a = vals.filter((x) => x != null).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function relativeGap(ours, bench) {
    if (ours == null || bench == null || !bench) return null;
    return (ours / bench - 1) * 100;
  }
  function deltaPp(ours, bench) {
    if (ours == null || bench == null) return null;
    return (ours - bench) * 100;
  }

  function sellerMetrics(row, window) {
    row = row || {};
    const card = row.card && typeof row.card === "object" ? row.card : {};
    const src = Object.assign({}, card, row);
    const w = window === "28d" ? "28d" : "7d";
    const views = n(src["views_" + w]);
    const search = n(src["search_views_" + w]);
    let catalog = n(src["catalog_views_" + w]);
    if (catalog == null && views != null && search != null) catalog = Math.max(views - search, 0);
    const pdp = n(src["pdp_views_" + w]);
    let carts = n(src["carts_" + w]);
    let orders = n(card["orders_" + w]);
    if (orders == null) orders = n(src["orders_" + w]);
    const crPdp = n(src["cr_pdp_cart_" + w]);
    if (carts == null && pdp != null && crPdp != null) carts = Math.round((pdp * crPdp) / 100);
    const purchase = n(src["redemption_" + w]);
    const ctr = ratio(pdp, views);
    const cardCart = crPdp != null ? crPdp / 100 : ratio(carts, pdp);
    const cartOrder = ratio(orders, carts);
    const orderPurchase = purchase == null ? null : purchase / 100;
    const purchases = orders != null && orderPurchase != null ? orders * orderPurchase : null;
    const price = n(src.price_rub != null ? src.price_rub : src.price);
    const sc = n(src["cr_search_cart_" + w]);
    return {
      sku: src.sku || row.sku,
      seller: src.seller || "",
      name: src.name || "",
      views, search, catalog,
      search_share: ratio(search, views),
      catalog_share: ratio(catalog, views),
      pdp, carts, orders, purchases,
      ctr, card_cart: cardCart, cart_order: cartOrder, order_purchase: orderPurchase,
      card_order: ratio(orders, pdp),
      impression_order: ratio(orders, views),
      orders_per_1000: orders != null && views ? (orders / views) * 1000 : null,
      purchases_per_1000: purchases != null && views ? (purchases / views) * 1000 : null,
      search_cart: sc == null ? null : sc / 100,
      price,
      price_min: n(src.price_min),
      drr: n(src["drr_" + w]),
      redemption: purchase,
      stock: n(src.stock),
      in_stock_days: n(src.days_oos),
      delivery: src.delivery || "",
      delivery_days: n(src.delivery_days),
      rating: n(src.rating),
      reviews: n(src.reviews)
    };
  }

  function medianMetrics(rows) {
    const keys = ["ctr", "card_cart", "cart_order", "order_purchase", "card_order", "impression_order", "orders_per_1000", "purchases_per_1000", "price", "search_share", "drr", "redemption", "in_stock_days"];
    const out = {};
    keys.forEach((k) => {
      out[k] = median(rows.map((r) => r[k]));
    });
    out.seller = rows.length ? "Медиана " + rows.length + " конкурентов" : "Медиана";
    out.sku = null;
    return out;
  }

  function statusOf(gap, config) {
    if (gap == null) return { id: "unknown", label: "НЕТ ДАННЫХ", tone: "unknown" };
    const rules = (config.status || []).slice();
    const numbered = rules.filter((r) => r.min != null).sort((a, b) => b.min - a.min);
    for (const rule of numbered) if (gap >= rule.min) return { id: rule.id, label: rule.label, tone: rule.tone };
    const last = rules.find((r) => r.min == null);
    return last ? { id: last.id, label: last.label, tone: last.tone } : { id: "unknown", label: "НЕТ ДАННЫХ", tone: "unknown" };
  }

  function sampleOk(stage, den, config) {
    const need = (config.sample_min || {})[stage];
    if (need == null) return true;
    return den != null && den >= need;
  }

  function lostCtr(ours, bench) {
    if (ours.views == null || bench.ctr == null || ours.pdp == null) return null;
    const extra = ours.views * bench.ctr - ours.pdp;
    if (extra <= 0) return 0;
    let through = ours.card_order;
    if (through == null) {
      if (ours.card_cart == null || ours.cart_order == null) return null;
      through = ours.card_cart * ours.cart_order;
    }
    return extra * through;
  }
  function lostCardCart(ours, bench) {
    if (ours.pdp == null || bench.card_cart == null || ours.carts == null) return null;
    const extra = ours.pdp * bench.card_cart - ours.carts;
    if (extra <= 0) return 0;
    if (ours.cart_order == null) return null;
    return extra * ours.cart_order;
  }
  function lostCartOrder(ours, bench) {
    if (ours.carts == null || bench.cart_order == null || ours.orders == null) return null;
    const lost = ours.carts * bench.cart_order - ours.orders;
    return lost <= 0 ? 0 : lost;
  }
  function lostPurchases(ours, bench) {
    if (ours.orders == null || bench.order_purchase == null || ours.purchases == null) return null;
    const lost = ours.orders * bench.order_purchase - ours.purchases;
    return lost <= 0 ? 0 : lost;
  }
  function fullBenchOrders(ours, bench) {
    if (ours.views == null || bench.ctr == null || bench.card_cart == null || bench.cart_order == null) return null;
    return ours.views * bench.ctr * bench.card_cart * bench.cart_order;
  }

  function trendStatus(ours, prev, bench, evenPp) {
    if (ours == null || bench == null) return null;
    const below = ours < bench;
    if (prev == null) return { id: below ? "below" : "above", label: below ? "ниже benchmark" : "выше benchmark", delta_pp: null };
    const delta = (ours - prev) * 100;
    const improving = delta > evenPp;
    const worsening = delta < -evenPp;
    if (below && worsening) return { id: "below_worse", label: "ниже benchmark и ухудшается", delta_pp: delta, tone: "critical" };
    if (below && improving) return { id: "below_better", label: "ниже benchmark, но улучшается", delta_pp: delta, tone: "mild" };
    if (!below && worsening) return { id: "above_worse", label: "выше benchmark, но ухудшается", delta_pp: delta, tone: "mild" };
    if (!below && improving) return { id: "above_better", label: "выше benchmark и улучшается", delta_pp: delta, tone: "strong" };
    return { id: below ? "below_flat" : "above_flat", label: below ? "ниже benchmark" : "выше benchmark", delta_pp: delta, tone: "even" };
  }

  const CHECK = {
    ctr: ["главное фото", "мобильную читаемость", "оффер на обложке", "цену и скидку", "рейтинг и отзывы", "доставку", "релевантность трафика"],
    card_cart: ["первые 3–5 слайдов", "соответствие обложки карточке", "оффер и комплектацию", "цену / price gap", "отзывы и рейтинг", "доказательства преимуществ", "видео и rich content", "срок доставки"],
    cart_order: ["итоговую цену", "цену конкурента", "акции и скидки", "доставку", "наличие", "условия покупки"],
    order_purchase: ["отмены и возвраты", "логистику и сроки", "упаковку", "ожидание vs факт", "отзывы после получения"]
  };
  const FACT = {
    ctr: "Показ → Карточка ниже benchmark.",
    card_cart: "В карточку заходят, в корзину кладут хуже benchmark.",
    cart_order: "Намерение есть, заказ завершают хуже benchmark.",
    order_purchase: "Заказы есть, выкуп ниже benchmark."
  };

  function diagnose(ourRow, competitorRows, opts) {
    const config = (opts && opts.config) || DEFAULT_CONFIG;
    const window = (opts && opts.window) || "7d";
    const benchmark = opts && opts.benchmark != null ? opts.benchmark : "median";
    const ours = sellerMetrics(ourRow, window);
    const comps = (competitorRows || []).map((r) => sellerMetrics(r, window));
    const usable = comps.filter((r) => r.views != null);
    let bench, benchLabel, benchSku;
    if (benchmark === "median") {
      bench = medianMetrics(usable);
      benchLabel = bench.seller;
      benchSku = null;
    } else {
      const picked = comps.find((r) => String(r.sku) === String(benchmark));
      if (!picked) {
        bench = medianMetrics(usable);
        benchLabel = bench.seller;
        benchSku = null;
      } else {
        bench = picked;
        benchLabel = picked.seller || String(picked.sku);
        benchSku = picked.sku;
      }
    }
    const prev = opts && opts.prevOur ? sellerMetrics(opts.prevOur, window) : null;
    const evenPp = Number((config.trend && config.trend.even_pp) || 0.3);
    const denoms = { ctr: ours.views, card_cart: ours.pdp, cart_order: ours.carts, order_purchase: ours.orders };
    const lostFn = { ctr: lostCtr, card_cart: lostCardCart, cart_order: lostCartOrder, order_purchase: lostPurchases };
    const stages = STAGES.map(([id, title, denKey, denLabel]) => {
      const ourCr = ours[id];
      const benchCr = bench[id];
      const gap = relativeGap(ourCr, benchCr);
      return {
        id, name: title,
        our_cr: ourCr == null ? null : ourCr * 100,
        bench_cr: benchCr == null ? null : benchCr * 100,
        delta_pp: deltaPp(ourCr, benchCr),
        relative_gap: gap,
        status: statusOf(gap, config),
        lost: lostFn[id](ours, bench),
        lost_unit: id === "order_purchase" ? "purchases" : "orders",
        denominator: denoms[id],
        denominator_label: denLabel,
        reliable: sampleOk(id, denoms[id], config),
        trend: trendStatus(ourCr, prev ? prev[id] : null, benchCr, evenPp)
      };
    });
    const reasons = [];
    if (ours.views == null) reasons.push("нет показов кабинета");
    if (!usable.length) reasons.push("нет конкурентов с воронкой за окно");
    const missing = stages.filter((s) => s.our_cr == null).map((s) => s.name);
    if (missing.length) reasons.push("нет данных: " + missing.join(", "));
    const oosPeriod = Number(config.oos_period_days || 28);
    const oos = ours.in_stock_days == null ? null : Math.max(oosPeriod - ours.in_stock_days, 0);
    const warnOos = Number(config.oos_warn_missing_days || 5);
    if (oos != null && oos >= warnOos) reasons.push("без остатка ≈ " + Math.round(oos) + " дн. из " + oosPeriod);
    const unreliable = stages.filter((s) => !s.reliable && s.our_cr != null).map((s) => s.name);
    if (unreliable.length) reasons.push("малая выборка: " + unreliable.join(", "));
    let quality;
    if (!reasons.length) quality = { status: "high", label: "Высокое" };
    else if (ours.views == null || !usable.length) quality = { status: "low", label: "Низкое" };
    else quality = { status: "mid", label: "Среднее" };
    quality.reasons = reasons;
    const ranked = stages
      .filter((s) => s.id !== "order_purchase" && s.lost != null && s.lost > 0 && s.reliable && s.our_cr != null)
      .sort((a, b) => b.lost - a.lost);
    const crGaps = stages.filter((s) => s.relative_gap != null);
    const worst = crGaps.length ? crGaps.reduce((a, b) => (a.relative_gap < b.relative_gap ? a : b)) : null;
    const strongs = stages.filter((s) => (s.relative_gap || 0) >= 10);
    const strong = strongs.length ? strongs.reduce((a, b) => (a.relative_gap > b.relative_gap ? a : b)) : null;
    let priceGap = null;
    if (ours.price != null && bench.price) {
      priceGap = { our: ours.price, bench: bench.price, rub: ours.price - bench.price, pct: (ours.price / bench.price - 1) * 100 };
    }
    const actions = stages.filter((s) => s.relative_gap != null && s.relative_gap < -10).map((stage) => {
      let hypo = null;
      if ((stage.id === "card_cart" || stage.id === "cart_order") && priceGap && priceGap.pct >= 3) {
        hypo = "Цена выше benchmark на " + priceGap.pct.toFixed(1) + "%. Проверить как возможный фактор.";
      }
      return { stage: stage.id, fact: FACT[stage.id] + " Relative gap " + stage.relative_gap.toFixed(1) + "%.", check: CHECK[stage.id], hypothesis: hypo };
    });
    const benchOrders = fullBenchOrders(ours, bench);
    const extraFull = benchOrders != null && ours.orders != null ? Math.max(benchOrders - ours.orders, 0) : null;
    return {
      comparable: quality.status !== "low",
      quality, window,
      benchmark: { mode: benchSku == null ? "median" : "sku", label: benchLabel, sku: benchSku },
      ours, bench,
      traffic: {
        views: ours.views, search: ours.search, catalog: ours.catalog,
        search_share: ours.search_share == null ? null : ours.search_share * 100,
        catalog_share: ours.catalog_share == null ? null : ours.catalog_share * 100,
        search_cart: ours.search_cart == null ? null : ours.search_cart * 100
      },
      stages,
      secondary: {
        card_order: ours.card_order == null ? null : ours.card_order * 100,
        impression_order: ours.impression_order == null ? null : ours.impression_order * 100,
        orders_per_1000: ours.orders_per_1000,
        purchases_per_1000: ours.purchases_per_1000,
        bench_orders_per_1000: bench.orders_per_1000
      },
      context: {
        price: ours.price, price_min: ours.price_min, drr: ours.drr, redemption: ours.redemption,
        stock: ours.stock, in_stock_days: ours.in_stock_days, oos_days: oos,
        delivery: ours.delivery, rating: ours.rating, reviews: ours.reviews
      },
      price_gap: priceGap,
      lost: Object.fromEntries(stages.map((s) => [s.id, s.lost])),
      full_benchmark_orders: benchOrders,
      full_extra_orders: extraFull,
      priority: ranked,
      worst_cr: worst,
      strong,
      actions,
      decision: {
        dont_touch: stages.filter((s) => (s.relative_gap || 0) >= 10),
        watch: stages.filter((s) => s.relative_gap != null && s.relative_gap >= -35 && s.relative_gap < -10),
        fix_first: ranked.slice(0, 1)
      },
      oos_warning: oos != null && oos >= warnOos
    };
  }

  function portfolio(pairs, config) {
    return (pairs || []).map((p) => {
      const d = diagnose(p.our || {}, p.competitors || [], { config, benchmark: "median" });
      if (!d.priority.length) return null;
      const top = d.priority[0];
      return { sku: p.sku, label: p.label || p.offer_id || p.sku, stage: top.id, stage_name: top.name, lost: top.lost, quality: d.quality.status, orders_per_1000: d.secondary.orders_per_1000, worst_gap: d.worst_cr && d.worst_cr.relative_gap, drr: d.ours.drr };
    }).filter(Boolean).sort((a, b) => b.lost - a.lost);
  }

  function logKey() { return "ozonFunnelLog"; }
  function loadLog() { try { return JSON.parse(localStorage.getItem(logKey()) || "[]"); } catch (e) { return []; } }
  function saveLog(rows) { localStorage.setItem(logKey(), JSON.stringify(rows)); }
  function addLog(entry) {
    const rows = loadLog();
    rows.push(Object.assign({ id: String(Date.now()) }, entry));
    saveLog(rows);
    return rows;
  }
  function logsFor(sku) { return loadLog().filter((x) => String(x.sku) === String(sku)).sort((a, b) => a.date.localeCompare(b.date)); }

  function beforeAfter(sku, currentOurs) {
    const logs = logsFor(sku);
    if (!logs.length) return null;
    const last = logs[logs.length - 1];
    const before = last.metrics;
    if (!before || !currentOurs) return { last, before: null, after: null };
    const keys = ["ctr", "card_cart", "cart_order", "order_purchase", "orders_per_1000"];
    const after = {};
    const rows = keys.map((k) => {
      const b = before[k], a = currentOurs[k];
      let rel = null;
      if (b != null && a != null && b !== 0) rel = (a / b - 1) * 100;
      return { key: k, before: b, after: a, rel };
    });
    const ctr = rows.find((r) => r.key === "ctr");
    const cc = rows.find((r) => r.key === "card_cart");
    const o1000 = rows.find((r) => r.key === "orders_per_1000");
    let guard = null;
    if (ctr && cc && ctr.rel != null && cc.rel != null && ctr.rel >= 10 && cc.rel <= -10) {
      guard = "CTR вырос, но качество послекликового трафика упало.";
    }
    if (ctr && o1000 && ctr.rel != null && o1000.rel != null && ctr.rel < 0 && o1000.rel > 0) {
      guard = (guard ? guard + " " : "") + "CTR снизился, но Orders/1000 выросли — изменение может быть коммерчески успешным.";
    }
    return { last, rows, guard };
  }

  root.FunnelDiag = {
    DEFAULT_CONFIG, sellerMetrics, diagnose, portfolio, statusOf,
    loadLog, addLog, logsFor, beforeAfter
  };
})(typeof window !== "undefined" ? window : globalThis);
