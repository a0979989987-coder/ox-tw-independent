import { twProvider } from "./api.js?v=20261005-recovery20";

let input = "";
let status = "idle";
let quote = null;
let errorText = "";
let controller = null;
let requestId = 0;

const css = `
#market-unavailable-card .tw-lookup { margin:14px 0; padding:15px; border:1px solid var(--line); border-radius:16px; background:var(--panel); }
#market-unavailable-card .tw-lookup h3 { margin:0 0 4px; font-size:17px; }
#market-unavailable-card .tw-lookup p { margin:5px 0; color:var(--muted); font-size:11px; line-height:1.5; }
#market-unavailable-card .tw-lookup-form { display:flex; flex-wrap:wrap; gap:8px; margin-top:11px; }
#market-unavailable-card .tw-lookup-form input { flex:1 1 150px; min-width:0; min-height:40px; padding:0 11px; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:var(--panel); font:inherit; }
#market-unavailable-card .tw-lookup button { min-height:40px; padding:0 12px; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:var(--panel); font:inherit; cursor:pointer; }
#market-unavailable-card .tw-lookup button:disabled { opacity:.55; cursor:wait; }
#market-unavailable-card .tw-lookup-quick { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
#market-unavailable-card .tw-lookup-quick button { min-height:34px; font-size:12px; }
#market-unavailable-card .tw-lookup-result { display:flex; flex-wrap:wrap; align-items:baseline; gap:5px 13px; margin-top:12px; padding:12px; border:1px solid var(--line); border-radius:12px; }
#market-unavailable-card .tw-lookup-result strong { font-size:18px; }
#market-unavailable-card .tw-lookup-result b { color:var(--ink); font-size:19px; }
#market-unavailable-card .tw-lookup-result small { color:var(--muted); font-size:11px; }
#market-unavailable-card .tw-lookup-error { color:var(--red) !important; }
`;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function number(value, digits = 2) {
  const parsed = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(parsed) : "—";
}

function percent(value) {
  const parsed = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? `${parsed > 0 ? "+" : ""}${parsed.toFixed(2)}%` : "—";
}

function content() {
  let result = "<p>輸入台股代號查詢官方最新可得日收盤資料；此結果不代表 OX 分級。</p>";
  if (status === "loading") result = `<p>正在查詢 ${escapeHTML(input)}…</p>`;
  if (status === "error") result = `<p class="tw-lookup-error">${escapeHTML(errorText)}</p>`;
  if (status === "ready" && quote) {
    result = `<div class="tw-lookup-result"><strong>${escapeHTML(quote.symbol)} ${escapeHTML(quote.name || "")}</strong><small>${quote.market === "TPEX" ? "上櫃" : quote.market === "TWSE" ? "上市" : "台股"}</small><b>NT$${number(quote.price ?? quote.close)}</b><span>${percent(quote.changePct)}</span></div>
      <p>成交股數 ${number(quote.volume, 0)} · 成交額 NT$${number(quote.turnoverTwd, 0)} · 資料日 ${escapeHTML(quote.dataDate || "未提供")} · 來源：TWSE／TPEx 官方日資料，非盤中即時報價。</p>`;
  }
  return `<form class="tw-lookup-form" data-tw-lookup-form><input name="symbol" type="search" inputmode="text" maxlength="8" autocomplete="off" value="${escapeHTML(input)}" placeholder="輸入代號，例如 2330" aria-label="台股代號"><button type="submit" ${status === "loading" ? "disabled" : ""}>${status === "loading" ? "查詢中" : "查詢報價"}</button></form>
    <div class="tw-lookup-quick" aria-label="常看台股">${["2330", "2317", "2454", "6488"].map(symbol => `<button type="button" data-tw-quick="${symbol}">${symbol}</button>`).join("")}</div>
    <div role="status" aria-live="polite">${result}</div>`;
}

function update() {
  const host = document.querySelector("#twr-lookup-content");
  if (host) host.innerHTML = content();
}

async function lookupSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  input = symbol;
  if (!/^[A-Z0-9]{4,8}$/.test(symbol)) {
    status = "error";
    errorText = "請輸入有效的台股代號。";
    update();
    return;
  }
  cancelTWLookup();
  const currentController = new AbortController();
  const currentId = ++requestId;
  controller = currentController;
  status = "loading";
  update();
  try {
    const data = await twProvider.getQuote(symbol, { signal: currentController.signal });
    if (currentController.signal.aborted || currentId !== requestId) return;
    const latest = data?.price ?? data?.close;
    if (latest === null || latest === undefined || latest === "" || !Number.isFinite(Number(latest))) throw new Error("資料源沒有回傳有效報價。");
    quote = data;
    status = "ready";
  } catch (error) {
    if (currentController.signal.aborted || currentId !== requestId) return;
    quote = null;
    status = "error";
    errorText = error?.message || "查詢暫時失敗。";
  } finally {
    if (currentId === requestId) controller = null;
  }
  if (document.body?.dataset.market === "tw") update();
}

export function cancelTWLookup() {
  requestId += 1;
  controller?.abort();
  controller = null;
  if (status === "loading") status = "idle";
}

export function renderTWLookup() {
  return `<section class="tw-lookup" aria-label="台股個股報價查詢"><h3>個股報價查詢</h3><p>可直接查上市、上櫃個股，不必先出現在雷達榜單。</p><div id="twr-lookup-content">${content()}</div></section>`;
}

export function bindTWLookup(root) {
  if (!document.getElementById("ox-tw-lookup-style")) {
    const style = document.createElement("style");
    style.id = "ox-tw-lookup-style";
    style.textContent = css;
    document.head.append(style);
  }
  const section = root.querySelector(".tw-lookup");
  section?.addEventListener("input", event => {
    if (event.target.matches('[name="symbol"]')) input = event.target.value;
  });
  section?.addEventListener("submit", event => {
    if (!event.target.matches("[data-tw-lookup-form]")) return;
    event.preventDefault();
    lookupSymbol(event.target.elements.symbol.value);
  });
  section?.addEventListener("click", event => {
    const button = event.target.closest("[data-tw-quick]");
    if (button) lookupSymbol(button.dataset.twQuick);
  });
}
