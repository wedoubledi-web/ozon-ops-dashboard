/** Загрузка отчётов Ozon + сравнение с конкурентами (7д) */

const STORAGE_KEY = "ozon_dashboard_v2";
const STORAGE_KEY_OLD = "ozon_uploaded_reports";

function fmt(n) {
  if (n == null || n === "") return "—";
  return Math.round(n).toLocaleString("ru-RU");
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function fmtRub(n) {
  if (n == null) return "—";
  return `${fmt(n)} ₽`;
}

function emptyStore() {
  return { mine: {}, competitor: {} };
}

function migrateStore(raw) {
  if (!raw) return emptyStore();
  if (raw.mine || raw.competitor) return { mine: raw.mine || {}, competitor: raw.competitor || {} };
  // старый формат: { "7d": report, "yesterday": report }
  const store = emptyStore();
  for (const [k, v] of Object.entries(raw)) {
    const kind = v?.meta?.report_kind === "competitor" ? "competitor" : "mine";
    store[kind][k] = v;
  }
  return store;
}

function loadStore() {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    if (v2) return migrateStore(JSON.parse(v2));
    const old = localStorage.getItem(STORAGE_KEY_OLD);
    if (old) {
      const migrated = migrateStore(JSON.parse(old));
      saveStore(migrated);
      localStorage.removeItem(STORAGE_KEY_OLD);
      return migrated;
    }
  } catch (e) {
    console.warn("store load error", e);
  }
  return emptyStore();
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    setStatus("Не удалось сохранить в браузере — место переполнено?", "err");
  }
}

function setStatus(msg, type) {
  const el = document.getElementById("upload-status");
  if (!el) return;
  el.textContent = msg;
  el.className = type === "err" ? "status-err" : type === "ok" ? "status-ok" : "";
}

function setStatusList(items) {
  const el = document.getElementById("upload-status");
  if (!el) return;
  if (!items.length) {
    el.textContent = "";
    el.className = "";
    return;
  }
  el.innerHTML = items.map((i) => `<div class="${i.type}">${i.text}</div>`).join("");
}

function renderReportBlock(report, kind) {
  const s = report.summary;
  const m = report.meta;
  const alerts = OzonReportParser.alertsFromReport(report);
  const periodLabel = m.period_label || m.period_key;
  const kindLabel = kind === "competitor" ? "Конкуренты" : "Наши";

  let alertHtml = "";
  if (alerts.length) {
    alertHtml =
      "<ul class='alert-list'>" +
      alerts
        .slice(0, 8)
        .map((a) => `<li class="${a.level === "critical" ? "crit" : "warn"}">${escapeHtml(a.text)}</li>`)
        .join("") +
      "</ul>";
  } else {
    alertHtml = "<p class='muted'>Критичных проблем нет.</p>";
  }

  let rows = "";
  for (const p of report.products.slice(0, 25)) {
    const drrFlag = p.drr_pct != null && p.drr_pct > 25 ? " ⚠" : "";
    const label = escapeHtml(p.offer_id || p.name.slice(0, 28));
    rows += `<tr>
      <td><b>${label}</b>${p.seller ? `<div class="sub">${escapeHtml(p.seller)}</div>` : ""}</td>
      <td class="num">${fmt(p.ordered_units)}</td>
      <td class="num">${fmt(p.views_search)}</td>
      <td class="num">${fmt(p.views_pdp)}</td>
      <td class="num">${fmtPct(p.conv_pdp_to_order_pct)}</td>
      <td class="num">${fmtPct(p.conv_cart_pdp_pct)}</td>
      <td class="num">${p.drr_pct != null ? Math.round(p.drr_pct) + "%" + drrFlag : "—"}</td>
    </tr>`;
  }

  return `
    <div class="report-card" data-kind="${kind}" data-period="${m.period_key}">
      <div class="report-head">
        <div>
          <div class="report-title">${kindLabel} · ${escapeHtml(periodLabel)}</div>
          <div class="sub">${escapeHtml(m.file_name)} · ${escapeHtml(m.formed_at || "—")}</div>
        </div>
        <button type="button" class="btn-ghost btn-remove" data-kind="${kind}" data-period="${m.period_key}">Убрать</button>
      </div>
      <div class="metrics">
        <div class="metric"><div class="lbl">Заказы</div><div class="val">${fmt(s.ordered_units)}</div></div>
        <div class="metric"><div class="lbl">Выручка</div><div class="val">${fmtRub(s.revenue_rub)}</div></div>
        <div class="metric"><div class="lbl">Просмотры карточки</div><div class="val">${fmt(s.views_pdp)}</div></div>
        <div class="metric"><div class="lbl">Конверсия</div><div class="val">${fmtPct(s.conv_pdp_to_order_pct)}</div></div>
        <div class="metric"><div class="lbl">SKU</div><div class="val">${s.sku_count}</div></div>
      </div>
      ${kind === "mine" ? `<h3 class="mini-h">Что поправить</h3>${alertHtml}` : ""}
      <h3 class="mini-h">Таблица</h3>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Товар</th><th>Заказы</th><th>Поиск</th><th>Карточка</th><th>Конв.</th><th>Корзина</th><th>ДРР</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDeltaPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n)}%`;
}

function fmtDeltaPp(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(1)} п.п.`;
}

function renderDayOverDay(store) {
  const el = document.getElementById("day-over-day-results");
  if (!el) return;

  const opsDaily = window.__OPS_DAILY__ || {};
  const uploaded = store.mine?.yesterday;
  const data = OzonReportParser.buildDayOverDayRows(uploaded, opsDaily);

  if (data.source === "none") {
    el.innerHTML =
      "<p class='muted'>Загрузи <b>наш отчёт за «Вчера»</b> (What to sell) — покажем, как метрики изменились относительно позавчера. Пока работает авто-сводка ниже после прогона.</p>";
    return;
  }

  const s = data.summary || {};
  const srcNote =
    data.source === "upload"
      ? `отчёт · ${escapeHtml(data.file || "")}`
      : "авто-сводка (charts API)";

  let rows = "";
  for (const r of data.rows) {
    const rowCls =
      r.conv_delta_pp != null && r.conv_delta_pp <= -1
        ? "row-lose"
        : r.orders_delta_pct != null && r.orders_delta_pct <= -30
          ? "row-lose"
          : r.conv_delta_pp != null && r.conv_delta_pp >= 1
            ? "row-win"
            : "";
    rows += `<tr class="${rowCls}">
      <td><b>${escapeHtml(r.label)}</b></td>
      <td class="num">${fmt(r.orders_prev)} → ${fmt(r.orders)}</td>
      <td class="num">${fmtDeltaPct(r.orders_delta_pct)}</td>
      <td class="num">${fmt(r.pdp_prev)} → ${fmt(r.pdp)}</td>
      <td class="num">${fmtDeltaPct(r.pdp_delta_pct)}</td>
      <td class="num">${fmtPct(r.conv_prev)} → ${fmtPct(r.conv)}</td>
      <td class="num">${fmtDeltaPp(r.conv_delta_pp)}</td>
    </tr>`;
  }

  const drops = data.rows.filter(
    (r) =>
      (r.conv_delta_pp != null && r.conv_delta_pp <= -1) ||
      (r.orders_delta_pct != null && r.orders_delta_pct <= -30) ||
      (r.pdp_delta_pct != null && r.pdp_delta_pct <= -25)
  );

  let insight = "";
  if (drops.length) {
    insight =
      "<ul class='alert-list'>" +
      drops
        .slice(0, 6)
        .map((r) => {
          const parts = [];
          if (r.orders_delta_pct != null) parts.push(`заказы ${fmtDeltaPct(r.orders_delta_pct)}`);
          if (r.pdp_delta_pct != null) parts.push(`карточка ${fmtDeltaPct(r.pdp_delta_pct)}`);
          if (r.conv_delta_pp != null) parts.push(`конв ${fmtDeltaPp(r.conv_delta_pp)}`);
          return `<li class="warn">${escapeHtml(r.label)}: ${parts.join(", ")}</li>`;
        })
        .join("") +
      "</ul>";
  } else {
    insight = "<p class='muted'>Резкой просадки вчера vs позавчera нет.</p>";
  }

  const prevLabel =
    data.prev_from && data.prev_to ? `позавчera ${data.prev_from}` : "позавчera";

  el.innerHTML = `
    <div class="compare-summary metrics">
      <div class="metric"><div class="lbl">Заказы вчера</div><div class="val">${fmt(s.ordered_units)}</div></div>
      <div class="metric"><div class="lbl">Просмотры карточки</div><div class="val">${fmt(s.pdp_views)}</div></div>
      <div class="metric"><div class="lbl">Конверсия вчера</div><div class="val">${fmtPct(s.conv_pdp_to_order_pct)}</div></div>
      <div class="metric"><div class="lbl">Источник</div><div class="val" style="font-size:1rem">${srcNote}</div></div>
    </div>
    <p class="hint">Сравнение: <b>вчера</b> vs <b>${escapeHtml(prevLabel)}</b> · ${escapeHtml(data.period)}</p>
    <h3 class="mini-h">Просели вчера</h3>
    ${insight}
    <h3 class="mini-h">По артикулам</h3>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Артикул</th><th>Заказы</th><th>Δ заказы</th><th>Карточка</th><th>Δ карточка</th><th>Конверсия</th><th>Δ конв.</th>
        </tr></thead>
        <tbody>${rows || "<tr><td colspan=7 class='muted'>Нет строк</td></tr>"}</tbody>
      </table>
    </div>`;

  const elOrders = document.getElementById("live-yesterday-orders");
  const elConv = document.getElementById("live-yesterday-conv");
  const elConvDelta = document.getElementById("live-yesterday-conv-delta");
  if (elOrders && s.ordered_units != null) elOrders.textContent = fmt(s.ordered_units);
  if (elConv && s.conv_pdp_to_order_pct != null) elConv.textContent = fmtPct(s.conv_pdp_to_order_pct);
  if (elConvDelta && data.rows.length) {
    const avgDelta =
      data.rows.filter((r) => r.conv_delta_pp != null).reduce((a, r) => a + r.conv_delta_pp, 0) /
      Math.max(1, data.rows.filter((r) => r.conv_delta_pp != null).length);
    if (Number.isFinite(avgDelta)) elConvDelta.textContent = fmtDeltaPp(avgDelta);
  }
}
  const el = document.getElementById("compare-results");
  if (!el) return;

  const mine7 = store.mine["7d"];
  const comp7 = store.competitor["7d"];

  if (!mine7 && !comp7) {
    el.innerHTML = "<p class='muted'>Загрузи наш отчёт и отчёт конкурентов за <b>7 дней</b> — здесь появится сравнение по парам SKU.</p>";
    return;
  }
  if (!mine7) {
    el.innerHTML = "<p class='muted status-warn-inline">Есть отчёт конкурентов — добавь <b>наш отчёт за 7 дней</b> (слот «Наши товары»).</p>";
    return;
  }
  if (!comp7) {
    el.innerHTML = "<p class='muted status-warn-inline">Есть наш отчёт — добавь <b>отчёт конкурентов за 7 дней</b> (Аналитика → Товары на Ozon).</p>";
    return;
  }

  const cmp = OzonReportParser.buildWeeklyComparison(mine7, comp7);
  let rows = "";
  for (const r of cmp.rows) {
    const rowCls = r.status === "lose" ? "row-lose" : r.status === "win" ? "row-win" : "";
    const gapTxt = r.gap > 0 ? `−${fmt(r.gap)}` : r.gap < 0 ? `+${fmt(Math.abs(r.gap))}` : "0";
    rows += `<tr class="${rowCls}">
      <td><b>${escapeHtml(r.label)}</b><div class="sub">${escapeHtml(r.who)}</div></td>
      <td class="num">${fmt(r.our_orders)}</td>
      <td class="num">${fmt(r.comp_orders)}</td>
      <td class="num">${gapTxt}</td>
      <td class="num">${r.share != null ? r.share + "%" : "—"}</td>
      <td class="num">${fmtPct(r.our_conv)}</td>
      <td class="num">${fmtPct(r.comp_conv)}</td>
    </tr>`;
  }

  const losers = cmp.rows.filter((r) => r.gap > 5).slice(0, 5);
  let insight = "";
  if (losers.length) {
    insight =
      "<ul class='alert-list'>" +
      losers.map((r) => `<li class="warn">${escapeHtml(r.label)}: конкурент +${fmt(r.gap)} шт/7д (доля ${r.share}%)</li>`).join("") +
      "</ul>";
  } else {
    insight = "<p class='muted'>По парам SKU критичного отставания нет.</p>";
  }

  el.innerHTML = `
    <div class="compare-summary metrics">
      <div class="metric"><div class="lbl">Мы · заказы 7д</div><div class="val">${fmt(cmp.total_mine)}</div></div>
      <div class="metric"><div class="lbl">Конкуренты · заказы 7д</div><div class="val">${fmt(cmp.total_comp)}</div></div>
      <div class="metric"><div class="lbl">Наша доля по парам</div><div class="val">${cmp.share_total != null ? cmp.share_total + "%" : "—"}</div></div>
    </div>
    <p class="hint">Период: ${escapeHtml(cmp.period)} · наш: ${escapeHtml(cmp.mine_file || "")} · конк.: ${escapeHtml(cmp.comp_file || "")}</p>
    <h3 class="mini-h">Где отстаём</h3>
    ${insight}
    <h3 class="mini-h">Все пары SKU</h3>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Товар</th><th>Мы</th><th>Конк.</th><th>Δ</th><th>Доля</th><th>Конв. мы</th><th>Конв. конк.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderAllReports(store) {
  const el = document.getElementById("upload-results");
  const blocks = [];
  const order = ["yesterday", "7d", "28d", "today", "mtd"];

  for (const kind of ["mine", "competitor"]) {
    const keys = Object.keys(store[kind] || {}).sort(
      (a, b) => order.indexOf(a) - order.indexOf(b)
    );
    for (const k of keys) blocks.push(renderReportBlock(store[kind][k], kind));
  }

  if (!blocks.length) {
    el.innerHTML = "<p class='muted'>Отчёты не загружены.</p>";
  } else {
    el.innerHTML = blocks.join("");
  }

  el.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const storeNow = loadStore();
      const kind = btn.dataset.kind;
      const period = btn.dataset.period;
      if (storeNow[kind]) delete storeNow[kind][period];
      saveStore(storeNow);
      refreshUI(storeNow);
    });
  });

  renderDayOverDay(store);
  renderComparison(store);
  syncOpsMetrics(store);
}

function syncOpsMetrics(store) {
  const y = store.mine.yesterday?.summary;
  const w = store.mine["7d"]?.summary;
  const el7 = document.getElementById("live-conv-7d");
  const note7 = document.getElementById("live-conv-7d-note");
  const noteY = document.getElementById("live-conv-yesterday-note");

  if (el7) {
    if (w?.conv_pdp_to_order_pct != null) {
      el7.textContent = fmtPct(w.conv_pdp_to_order_pct);
      if (note7) note7.textContent = `из отчёта · ${store.mine["7d"].meta.file_name}`;
    }
  }
  if (noteY) {
    if (y?.conv_pdp_to_order_pct != null) {
      noteY.textContent = `конв ${fmtPct(y.conv_pdp_to_order_pct)} · ${store.mine.yesterday.meta.file_name}`;
    } else {
      noteY.textContent = "";
    }
  }
}

function refreshUI(store) {
  renderAllReports(store);
}

async function handleFiles(fileList, forcedKind) {
  const store = loadStore();
  const messages = [];

  if (!fileList?.length) return;

  for (const file of fileList) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      messages.push({ type: "status-err", text: `${file.name}: нужен .xlsx или .csv` });
      continue;
    }
    try {
      const buf = await file.arrayBuffer();
      const report = OzonReportParser.parseFileArrayBuffer(buf, file.name, forcedKind);
      const kind = report.meta.report_kind === "competitor" ? "competitor" : "mine";
      const pk = report.meta.period_key;

      if (!store[kind]) store[kind] = {};
      store[kind][pk] = report;

      const kindRu = kind === "competitor" ? "конкуренты" : "наши";
      let extra = "";
      if (kind === "mine" && pk === "yesterday") {
        extra = " · сравнение с позавчera обновлено";
      } else if (kind === "mine" && pk !== "yesterday") {
        extra = " · для сравнения вчера/позавчera нужен период «Вчера»";
      } else if (kind === "competitor" && pk !== "7d") {
        extra = " · для сравнения с конкурентами лучше период «7 дней»";
      }
      messages.push({
        type: "status-ok",
        text: `✓ ${file.name} → ${kindRu}, ${report.meta.period_label || pk}, ${report.products.length} SKU${extra}`,
      });
    } catch (e) {
      messages.push({ type: "status-err", text: `✗ ${file.name}: ${e.message || "ошибка чтения"}` });
    }
  }

  saveStore(store);
  refreshUI(store);
  setStatusList(messages);
}

function bindDropZone(zoneId, inputId, kind) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") input.click();
  });
  input.addEventListener("change", (e) => {
    handleFiles(e.target.files, kind);
    e.target.value = "";
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    handleFiles(e.dataTransfer.files, kind);
  });
}

function initUpload() {
  bindDropZone("upload-zone-mine", "file-input-mine", "mine");
  bindDropZone("upload-zone-comp", "file-input-comp", "competitor");

  document.getElementById("btn-clear-all")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_OLD);
    refreshUI(emptyStore());
    setStatus("Все загруженные отчёты удалены", "ok");
  });

  refreshUI(loadStore());
}

document.addEventListener("DOMContentLoaded", initUpload);
