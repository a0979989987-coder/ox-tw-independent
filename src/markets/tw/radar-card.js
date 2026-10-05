// The card accepts only normalized, provider-backed facts. Missing fields stay missing.
// Future /radar response: { radar: [...], modes: { risk: [...], disposal: [...],
// release: [...], earnings: [...] } }. Each mode is explicit provider membership.
// A mode row may carry disposition: { status, riskLevel, riskDays, releaseDays,
// repeatRiskDays, startDate, endDate, batchMinutes, condition, margin, short,
// dayTrade, fullDelivery }. No exchange rule is implemented here.
export const TW_RADAR_MODES = Object.freeze([
  { id: "chart", label: "圖表雷達" },
  { id: "risk", label: "風險股" },
  { id: "disposal", label: "處置中" },
  { id: "release", label: "即將出關" },
  { id: "watchlist", label: "自選" }
]);

export const escapeTW = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

const numeric = value => value === null || value === undefined || value === ""
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === "string" ? value.trim() : "";
const positiveInt = value => value !== null && value !== undefined && value !== "" &&
  Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const knownBoolean = value => typeof value === "boolean" ? value : null;
const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";

export function normalizeTWStockCard(source) {
  if (!source || typeof source !== "object") return null;
  const symbol = text(source.symbol || source.code).toUpperCase();
  if (!/^[0-9A-Z]{4,8}$/.test(symbol)) return null;
  const disposition = source.disposition && typeof source.disposition === "object" ? source.disposition : {};
  return {
    ...source,
    symbol,
    name: text(source.name),
    industry: text(source.industry),
    price: numeric(source.price),
    change: numeric(source.change),
    changePct: numeric(source.changePct),
    turnoverTwd: numeric(source.turnoverTwd),
    turnoverRate: numeric(source.turnoverRate),
    disposition: {
      status: ["risk", "active", "release", "earnings"].includes(disposition.status) ? disposition.status : "",
      scheduled: disposition.scheduled === true,
      riskLabel: text(disposition.riskLabel),
      riskBasis: text(disposition.riskBasis),
      noticeDate: safeDate(disposition.noticeDate),
      noticeText: text(disposition.noticeText),
      noticeTextDate: safeDate(disposition.noticeTextDate),
      announcementDate: safeDate(disposition.announcementDate),
      detail: text(disposition.detail),
      measures: text(disposition.measures),
      announcementCount: positiveInt(disposition.announcementCount),
      resumeDate: safeDate(disposition.resumeDate),
      asOf: safeDate(disposition.asOf),
      checkedAt: text(disposition.checkedAt),
      sourceUrl: text(disposition.sourceUrl),
      riskSourceUrl: text(disposition.riskSourceUrl),
      riskLevel: text(disposition.riskLevel),
      riskProgress: numeric(disposition.riskProgress) !== null && Number(disposition.riskProgress) >= 0 && Number(disposition.riskProgress) <= 100 ? Number(disposition.riskProgress) : null,
      noRepeatRisk: knownBoolean(disposition.noRepeatRisk),
      exemption: knownBoolean(disposition.exemption),
      futures: knownBoolean(disposition.futures),
      riskDays: positiveInt(disposition.riskDays),
      releaseDays: positiveInt(disposition.releaseDays),
      repeatRiskDays: positiveInt(disposition.repeatRiskDays),
      startDate: safeDate(disposition.startDate),
      endDate: safeDate(disposition.endDate),
      batchMinutes: [2, 5, 10, 20, 30, 45, 60].includes(Number(disposition.batchMinutes)) ? Number(disposition.batchMinutes) : null,
      condition: text(disposition.condition),
      margin: knownBoolean(disposition.margin),
      short: knownBoolean(disposition.short),
      dayTrade: knownBoolean(disposition.dayTrade),
      fullDelivery: knownBoolean(disposition.fullDelivery)
    }
  };
}

// Explicit membership only: price action is never used to guess exchange disposition rules.
export function rowsForTWMode(state, mode, classicRows, watchlist) {
  if (mode === "classic") return classicRows;
  if (mode === "watchlist") {
    if (!watchlist?.size) return [];
    const available = new Map(classicRows.map(row => [row.symbol, row]));
    // Announcement rows have more status fields than the ordinary quote rows.
    for (const category of ["risk", "disposal", "release"]) {
      for (const row of state?.data?.radarModes?.[category] || []) {
        const normalized = normalizeTWStockCard(row);
        if (normalized) available.set(normalized.symbol, normalized);
      }
    }
    return [...watchlist].map(symbol => available.get(symbol) ||
      normalizeTWStockCard({ symbol, name: symbol, disposition: { riskLabel: "行情資料待更新" } }))
      .filter(Boolean);
  }
  const supplied = state?.data?.radarModes?.[mode];
  if (Array.isArray(supplied)) return supplied.map(normalizeTWStockCard).filter(Boolean);
  if (mode === "hot") return classicRows.filter(row => row.price !== null)
    .sort((a, b) => (b.turnoverTwd ?? -1) - (a.turnoverTwd ?? -1));
  return [];
}

function fmt(value, max = 2) {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: max }).format(value);
}

function riskLabel(row) {
  const d = row.disposition;
  if (d.scheduled && d.startDate) return `${d.startDate.slice(5).replace('-', '/')} 起處置`;
  if (d.riskLabel) return d.riskLabel;
  if (d.repeatRiskDays !== null) return `最快 ${d.repeatRiskDays} 日後再次處置`;
  if (d.noRepeatRisk === true) return "近期無再次處置風險";
  if (d.riskDays !== null) return `最快 ${d.riskDays} 日後進入處置`;
  if (d.status === 'active' || d.status === 'release') return "目前處置中";
  if (d.status) return "風險資料待更新";
  return row.setup || row.breakoutState || "風險資料待更新";
}

function bottomLabel(row) {
  const d = row.disposition;
  if (d.status === "release") return d.releaseDays === null ? "出關時間待更新" : d.releaseDays === 0 ? "今日處置結束" : `${d.releaseDays} 交易日後出關`;
  if (d.status === "active" || d.scheduled) return d.startDate && d.endDate
    ? `處置期間 ${d.startDate.slice(5).replace("-", "/")} - ${d.endDate.slice(5).replace("-", "/")}` : "處置期間待更新";
  if (d.exemption === true) return "豁免條件存在";
  if (d.condition) return d.condition;
  if (d.status === "earnings") return "自結發布";
  return "";
}

export function renderTWStockCard(source, watchlist) {
  const row = normalizeTWStockCard(source);
  if (!row) return "";
  const watched = watchlist.has(row.symbol);
  const direction = row.changePct > 0 ? "up" : row.changePct < 0 ? "down" : "flat";
  const d = row.disposition;
  // A risk meter is meaningful only when the official provider supplies its
  // progress. Never render a placeholder meter for ordinary daily quotes.
  const hasRiskProgress = d.riskProgress !== null && d.noRepeatRisk !== true;
  const hasBatch = d.batchMinutes !== null;
  const tags = [["資", d.margin], ["券", d.short], ["沖", d.dayTrade], ["期", d.futures]];
  const change = `${row.changePct > 0 ? "▲" : row.changePct < 0 ? "▼" : ""}${row.change === null ? "—" : fmt(Math.abs(row.change))}`;
  const pct = row.changePct === null ? "—" : `${fmt(Math.abs(row.changePct))}%`;
  const candle = renderTWCurrentCandle(row.currentCandle ? [row.currentCandle] : []);
  return `<article class="tw-stock-card" role="button" tabindex="0" aria-label="查看 ${escapeTW(row.name || row.symbol)} 風險與處置資訊" data-twr-symbol="${escapeTW(row.symbol)}">
    <div class="tw-stock-top">
      <div class="tw-stock-identity"><strong title="${escapeTW(row.name)}">${escapeTW(row.name || "名稱待更新")}</strong><span>${escapeTW(row.symbol)}</span></div>
      <span class="tw-stock-industry" title="${escapeTW(row.industry)}">${escapeTW(row.industry || "—")}</span>
      <button class="tw-stock-watch ${watched ? "active" : ""}" type="button" data-twr-watch="${escapeTW(row.symbol)}" aria-label="${watched ? "取消收藏" : "收藏"} ${escapeTW(row.name || row.symbol)}" aria-pressed="${watched}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.4l6.2-.9z"/></svg></button>
    </div>
    <div class="tw-stock-quote ${direction}">
      <div class="tw-stock-price"><span class="tw-stock-single-k" ${candle ? '' : `data-twr-mini="${escapeTW(row.symbol)}"`} aria-label="官方最近交易日日 K · 非即時" title="官方最近交易日日 K · 非即時">${candle || '—'}</span><strong>${fmt(row.price)}</strong></div>
      <span class="tw-stock-change">${change} <small>(${pct})</small></span>
    </div>
    <div class="tw-stock-risk-area ${!hasRiskProgress ? 'no-progress' : ''}">
      <div class="tw-stock-status ${riskLabel(row).includes('最快')?'urgent':''}">${escapeTW(riskLabel(row))}</div>
      ${hasRiskProgress || hasBatch ? `<div class="tw-stock-risk-row">
        ${hasRiskProgress ? `<div class="tw-stock-risk" title="${escapeTW(d.riskLevel || "風險程度")}">
          <span class="tw-stock-risk-icon known" aria-hidden="true">◆</span>
          <div class="tw-stock-risk-track" role="progressbar" aria-label="${escapeTW(d.riskLevel || "風險程度")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.riskProgress}"><i style="width:${d.riskProgress}%"></i></div>
        </div>` : ""}
        ${hasBatch ? `<span class="tw-stock-batch">${d.batchMinutes}分盤</span>` : ""}
      </div>` : ""}
    </div>
    <div class="tw-stock-stats">
      <div class="tw-stock-flags">${tags.map(([label, active]) => `<i class="${active === null ? "unknown" : active ? "on" : "off"}" title="${label}：${active === null ? "資料待更新" : active ? "是" : "否"}">${label}</i>`).join("")}</div>
      <div class="tw-stock-metric"><span>成交值</span><b>${row.turnoverTwd === null ? "—" : `${fmt(row.turnoverTwd / 1e8, 2)}億`}</b></div>
      <div class="tw-stock-metric" title="${escapeTW(row.turnoverBasis || '官方週轉率')}"><span>週轉率</span><b>${row.turnoverRate === null ? "—" : `${fmt(row.turnoverRate)}%`}</b></div>
    </div>
    ${bottomLabel(row) ? `<div class="tw-stock-bottom">${escapeTW(bottomLabel(row))}</div>` : ""}
  </article>`;
}

export function renderTWCurrentCandle(candles) {
  // Show precisely one supplied session, including doji and its high/low wicks.
  // Do not silently substitute an older valid candle for a missing latest session.
  const latest = Array.isArray(candles) ? candles.at(-1) : null;
  return latest ? renderTWCandles([latest], { width: 12, height: 26, count: 1 }) : "";
}

export function renderTWCandles(candles, { width = 160, height = 36, count = 20 } = {}) {
  const valid = (Array.isArray(candles) ? candles : []).filter(c =>
    [c.open, c.high, c.low, c.close].every(v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))) &&
    Number(c.high) >= Math.max(Number(c.open), Number(c.close)) &&
    Number(c.low) <= Math.min(Number(c.open), Number(c.close))
  ).slice(-count);
  if (!valid.length) return "";
  const min = Math.min(...valid.map(c => Number(c.low)));
  const max = Math.max(...valid.map(c => Number(c.high)));
  const y = value => 3 + (max - Number(value)) / (max - min || 1) * (height - 6);
  const step = width / valid.length;
  const body = Math.max(1.5, Math.min(6, step * .56));
  const shapes = valid.map((c, i) => {
    const x = (i + .5) * step;
    const color = Number(c.close) > Number(c.open) ? "#f16a70" : Number(c.close) < Number(c.open) ? "#48b78e" : "#d6d1c8";
    const top = Math.min(y(c.open), y(c.close));
    const size = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    return `<g fill="${color}" stroke="${color}"><path d="M${x.toFixed(1)} ${y(c.high).toFixed(1)}V${y(c.low).toFixed(1)}" stroke-width="1"/><rect x="${(x-body/2).toFixed(1)}" y="${top.toFixed(1)}" width="${body.toFixed(1)}" height="${size.toFixed(1)}" stroke="none"/></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="官方日 K 走勢">${shapes}</svg>`;
}
