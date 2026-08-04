/** Загрузка отчётов Ozon на дашборде + отображение метрик */

const STORAGE_KEY = "ozon_uploaded_reports";

function fmt(n) {
  if (n == null || n === "") return "—";
  return Math.round(n).toLocaleString("ru-RU");
}

function fmtPct(n) {
  if (n == null) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function fmtRub(n) {
  if (n == null) return "—";
  return `${fmt(n)} ₽`;
}

function loadStoredReports() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredReports(reports) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

function renderReportBlock(report) {
  const s = report.summary;
  const m = report.meta;
  const alerts = OzonReportParser.alertsFromReport(report);
  const periodLabel = m.period_label || m.period_key;

  let alertHtml = "";
  if (alerts.length) {
    alertHtml =
      "<ul class='alert-list'>" +
      alerts
        .slice(0, 8)
        .map(
          (a) =>
            `<li class="${a.level === "critical" ? "crit" : "warn"}">${a.text}</li>`
        )
        .join("") +
      "</ul>";
  } else {
    alertHtml = "<p class='muted'>Критичных проблем по конверсии нет.</p>";
  }

  let rows = "";
  for (const p of report.products.slice(0, 20)) {
    const drrFlag = p.drr_pct != null && p.drr_pct > 25 ? " ⚠" : "";
    rows += `<tr>
      <td><b>${p.offer_id || p.name.slice(0, 28)}</b></td>
      <td class="num">${fmt(p.ordered_units)}</td>
      <td class="num">${fmt(p.views_search)}</td>
      <td class="num">${fmt(p.views_pdp)}</td>
      <td class="num">${fmtPct(p.conv_pdp_to_order_pct)}</td>
      <td class="num">${fmtPct(p.conv_cart_pdp_pct)}</td>
      <td class="num">${p.drr_pct != null ? Math.round(p.drr_pct) + "%" + drrFlag : "—"}</td>
      <td class="num">${p.revenue_dyn_pct != null ? (p.revenue_dyn_pct > 0 ? "+" : "") + Math.round(p.revenue_dyn_pct) + "%" : "—"}</td>
    </tr>`;
  }

  return `
    <div class="report-card" data-period="${m.period_key}">
      <div class="report-head">
        <div>
          <div class="report-title">${periodLabel}</div>
          <div class="sub">${m.file_name} · сформирован ${m.formed_at || "—"}</div>
        </div>
        <button type="button" class="btn-ghost btn-remove" data-period="${m.period_key}">Убрать</button>
      </div>
      <div class="metrics">
        <div class="metric"><div class="lbl">Заказы</div><div class="val">${fmt(s.ordered_units)}</div></div>
        <div class="metric"><div class="lbl">Выручка</div><div class="val">${fmtRub(s.revenue_rub)}</div></div>
        <div class="metric"><div class="lbl">Просмотры карточки</div><div class="val">${fmt(s.views_pdp)}</div></div>
        <div class="metric"><div class="lbl">Конверсия PDP→заказ</div><div class="val">${fmtPct(s.conv_pdp_to_order_pct)}</div></div>
        <div class="metric"><div class="lbl">Поиск → карточка</div><div class="val">${fmt(s.views_search)}</div><div class="note">${fmtPct(s.conv_search_to_pdp_pct)} переход</div></div>
        <div class="metric"><div class="lbl">SKU в отчёте</div><div class="val">${s.sku_count}</div></div>
      </div>
      <h3 class="mini-h">Что поправить</h3>
      ${alertHtml}
      <h3 class="mini-h">Все артикулы</h3>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Артикул</th><th>Заказы</th><th>Поиск</th><th>Карточка</th>
            <th>Конв.</th><th>Корзина</th><th>ДРР</th><th>Δ оборот</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderAllReports(reports) {
  const el = document.getElementById("upload-results");
  const keys = Object.keys(reports);
  if (!keys.length) {
    el.innerHTML = "<p class='muted'>Отчёт не загружен — перетащи Excel сюда или нажми «Выбрать файл».</p>";
    document.getElementById("upload-status").textContent = "";
    return;
  }
  const order = ["yesterday", "7d", "28d", "today", "mtd"];
  keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  el.innerHTML = keys.map((k) => renderReportBlock(reports[k])).join("");
  document.getElementById("upload-status").textContent =
    `Загружено периодов: ${keys.map((k) => reports[k].meta.period_label || k).join(", ")}`;

  el.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pk = btn.dataset.period;
      const stored = loadStoredReports();
      delete stored[pk];
      saveStoredReports(stored);
      renderAllReports(stored);
      syncOpsMetrics(stored);
    });
  });
}

function syncOpsMetrics(reports) {
  const y = reports.yesterday?.summary;
  const w = reports["7d"]?.summary;
  const el7 = document.getElementById("live-conv-7d");
  const note7 = document.getElementById("live-conv-7d-note");
  const noteY = document.getElementById("live-conv-yesterday-note");
  if (el7 && w?.conv_pdp_to_order_pct != null) {
    el7.textContent = fmtPct(w.conv_pdp_to_order_pct);
    if (note7) note7.textContent = `из отчёта · ${reports["7d"].meta.file_name}`;
  }
  if (noteY && y?.conv_pdp_to_order_pct != null) {
    noteY.textContent = `конв ${fmtPct(y.conv_pdp_to_order_pct)} · ${reports.yesterday.meta.file_name}`;
  } else if (noteY && !y) {
    noteY.textContent = "";
  }
}

async function handleFiles(fileList) {
  const stored = loadStoredReports();
  const status = document.getElementById("upload-status");
  status.textContent = "Читаю файл…";

  for (const file of fileList) {
    if (!file.name.match(/\.xlsx$/i)) continue;
    const buf = await file.arrayBuffer();
    const report = OzonReportParser.parseWorkbookArrayBuffer(buf, file.name);
    stored[report.meta.period_key] = report;
  }

  saveStoredReports(stored);
  renderAllReports(stored);
  syncOpsMetrics(stored);
}

function initUpload() {
  const zone = document.getElementById("upload-zone");
  const input = document.getElementById("file-input");

  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => handleFiles(e.target.files));

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    handleFiles(e.dataTransfer.files);
  });

  document.getElementById("btn-clear-all")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    renderAllReports({});
    syncOpsMetrics({});
  });

  const stored = loadStoredReports();
  renderAllReports(stored);
  syncOpsMetrics(stored);
}

document.addEventListener("DOMContentLoaded", initUpload);
