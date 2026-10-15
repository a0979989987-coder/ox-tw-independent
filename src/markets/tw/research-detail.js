import { twProvider } from './api.js?v=20261005-recovery20';
import { escape, number, pct, money, direction } from './research-ui.js';
import { readWatchlist, toggleWatch, savedResearch } from './research-data.js?v=20261001-twhome1';
import { bundleEntry, awaitBundleSymbol } from './patterns/bundle.js?v=20261005-load16';
import { FRAME_LABELS, sessionFrameNote } from './patterns/model.js';
import { stockDetailCandles, stockDetailChart } from './research-stock-chart.js';
import {highlightsContent} from './home-highlights.js?v=20261005-briefingdate';
export function closeResearchDetails() { document.querySelectorAll('.twx-dialog').forEach(d => { d.close(); d.remove(); }); }
export function researchDialog(title, { className = '', onClose } = {}) {
  closeResearchDetails();
  const node = document.createElement('dialog'); node.className = `twx-dialog ${className}`.trim();
  node.setAttribute('aria-label', title);
  node.innerHTML = `<header><strong tabindex="-1" autofocus>${escape(title)}</strong><button type="button" data-close aria-label="關閉">×</button></header><div class="twx-detail-content"></div>`;
  document.body.append(node); node.showModal();
  // Opening a modal should not paint a keyboard focus box around its X.
  node.querySelector('header strong').focus({ preventScroll: true });
  const close = () => { node.classList.add('leaving'); setTimeout(() => { node.close(); node.remove(); }, 180); };
  node.addEventListener('close', () => onClose?.(), { once: true });
  node.addEventListener('cancel', e => { e.preventDefault(); close(); });
  node.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === node) close(); });
  return node;
}
export function updateHomeHighlights(home,phase,research){
 const node=document.querySelector('.twx-dialog[data-home-highlights]');if(!node)return;
 node.dataset.homeHighlights=phase;node.setAttribute('aria-label',phase==='before'?'盤前重點':'盤後重點');
 node.querySelector('header strong').textContent=phase==='before'?'盤前重點':'盤後重點';
 node.querySelector('.twx-detail-content').innerHTML=highlightsContent(home,phase,research);
}
export function showHomeHighlights(home,phase,research){
 const node=researchDialog(phase==='before'?'盤前重點':'盤後重點');node.dataset.homeHighlights=phase;
 node.setAttribute('aria-label',phase==='before'?'盤前重點':'盤後重點');
 updateHomeHighlights(home,phase,research);return node;
}
export function watchClick(button) {
  const selected = toggleWatch(button.dataset.watch);
  if (selected === null) { button.title = '無法儲存收藏，請確認瀏覽器儲存空間'; return; }
  button.classList.toggle('selected', selected); button.textContent = selected ? '★' : '☆'; button.setAttribute('aria-pressed', String(selected));
}
export function showSector(sector) {
  const node = researchDialog(sector.name, { className: 'twx-sector-detail' });
  const rows = [...(sector.rows || [])].sort((a, b) => (b.netTwd ?? -Infinity) - (a.netTwd ?? -Infinity)), watched = readWatchlist();
  node.querySelector('.twx-detail-content').innerHTML = `${sector.date ? `<p class="twx-muted">板塊資料日 ${escape(sector.date)}</p>` : ''}<div class="twx-detail-metrics"><span>當日法人估算<b class="${direction(sector.flow)}">${money(sector.flow)}</b></span><span>產業漲跌<b class="${direction(sector.changePct)}">${pct(sector.changePct)}</b></span><span>買超家數<b>${number(sector.buyCount, 0)} / ${number(sector.covered, 0)}</b></span></div><div class="twx-detail-metrics"><span>近五日累計<b>${money(sector.flow5)}</b></span><span>近月累計<b>${money(sector.flow20)}</b></span><span>買入力道<b>${money(sector.momentum)}／日</b></span></div><div class="twx-member-heading"><strong>成分股 · ${rows.length} 檔</strong><small>依法人買賣超</small></div><p class="twx-muted">點股票名稱直接進圖表；點數值列查看個股詳情。</p><p class="twx-muted">成分股與報價資料日 ${escape(sector.memberDate || '尚未提供')}${sector.date && sector.memberDate && sector.date !== sector.memberDate ? ' · 與上方回放日期不同' : ''}</p><table class="twx-member-table"><thead><tr><th>股票</th><th>收盤／漲跌</th><th>法人估算</th><th><span class="twx-sr-only">自選</span></th></tr></thead><tbody>${rows.map(stock => `<tr data-stock-detail="${escape(stock.symbol)}" tabindex="0" aria-label="查看 ${escape(stock.name)} ${escape(stock.symbol)} 個股詳情"><td><button type="button" data-open-stock-chart="${escape(stock.symbol)}" aria-label="${escape(stock.name)} ${escape(stock.symbol)} 直接開啟圖表"><strong>${escape(stock.name)} ↗</strong><small>${escape(stock.symbol)} · ${stock.market === 'TWSE' ? '上市' : stock.market === 'TPEX' ? '上櫃' : '—'}</small></button></td><td class="${direction(stock.changePct)}">${number(stock.price)}<small>${pct(stock.changePct)}</small></td><td class="${direction(stock.netTwd)}">${money(stock.netTwd)}</td><td><button type="button" class="twx-star ${watched.has(stock.symbol) ? 'selected' : ''}" data-watch="${escape(stock.symbol)}" aria-label="收藏 ${escape(stock.name)}" aria-pressed="${watched.has(stock.symbol)}">${watched.has(stock.symbol) ? '★' : '☆'}</button></td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<p class="twx-empty">此板塊尚無可用的成分股資料。</p>'}`;
  node.addEventListener('click', e => {
    const star = e.target.closest('[data-watch]'); if (star) { e.stopPropagation(); watchClick(star); return; }
    const chart = e.target.closest('[data-open-stock-chart]'); if (chart) { openResearchStockChart(chart.dataset.openStockChart); return; }
    const row = e.target.closest('[data-stock-detail]');
    if (row) showStock(rows.find(s => s.symbol === row.dataset.stockDetail), { date: sector.memberDate, sectorDate: sector.date, onBack: () => showSector(sector) });
  });
  node.addEventListener('keydown', event => {
    if (event.target.matches('[data-stock-detail]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); }
  });
  return node;
}

export function openResearchStockChart(symbol) {
  if (!/^\d{4,6}[A-Z]?$/.test(symbol || '')) return;
  closeResearchDetails();
  // Use the same mobile-safe application entry as stock search, not a
  // synthetic click on the dock's long-press gesture handler.
  if (window.OXTW?.openStock) window.OXTW.openStock(symbol);
  else {
    document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol', { detail: { symbol } }));
    window.switchAppView?.('radar');
  }
}

export async function showStock(stock, { date = savedResearch()?.date, sectorDate, onBack } = {}) {
  if (!stock) return;
  let request, closed = false, daily = [], chartDate = date, frame = '1D';
  const node = researchDialog(`${stock.name} ${stock.symbol}`, { className: 'twx-stock-detail', onClose() { closed = true; request?.abort(); } });
  node.querySelector('header strong').innerHTML = `<button type="button" class="twx-stock-title" data-open-stock-chart="${escape(stock.symbol)}">${escape(stock.name)} ${escape(stock.symbol)} ↗</button>`;
  node.querySelector('.twx-detail-content').innerHTML = `${onBack ? '<button type="button" class="twx-back-sector" data-back-sector>‹ 返回板塊</button>' : ''}<div class="twx-stock-price"><span>收盤 · TWD<small>資料日 ${escape(date || '尚未提供')}</small></span><strong>${number(stock.price)}</strong></div><section class="twx-stock-chart"><div class="twx-stock-chart-head"><label>K 線 <select data-stock-frame aria-label="個股詳情 K 線級別">${Object.entries(FRAME_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><button type="button" data-retry-candles aria-label="重新載入個股 K 線">↻</button></div><div class="twx-kline" aria-live="polite">日 K 載入中…</div><p class="twx-muted" data-candle-status></p></section><div class="twx-detail-metrics"><span>漲跌<b class="${direction(stock.changePct)}">${pct(stock.changePct)}</b></span><span>成交額<b>${Number.isFinite(stock.turnoverTwd) ? number(stock.turnoverTwd / 1e8) + ' 億' : '—'}</b></span><span>法人估算<b class="${direction(stock.netTwd)}">${money(stock.netTwd)}</b></span></div><div class="twx-detail-metrics">${[['外資', stock.foreignTwd], ['投信', stock.trustTwd], ['自營商', stock.dealerTwd]].map(([label, v]) => `<span>${label}<b class="${direction(v)}">${money(v)}</b></span>`).join('')}</div><p class="twx-muted">${escape(stock.market === 'TWSE' ? '上市' : stock.market === 'TPEX' ? '上櫃' : '')} · ${escape(stock.industry || '')}${sectorDate ? ` · 板塊回放 ${escape(sectorDate)}` : ''}</p><button type="button" class="twx-open-stock-chart" data-open-stock-chart="${escape(stock.symbol)}">查看 K 線圖 ↗</button>`;
  const chart = node.querySelector('.twx-kline'), stamp = node.querySelector('[data-candle-status]');
  const render = () => {
    const candles = stockDetailCandles(daily, frame, chartDate);
    chart.innerHTML = stockDetailChart(candles, `${stock.name} ${FRAME_LABELS[frame]}`) || '此級別尚無已完成 K 線';
    stamp.textContent = `TWSE／TPEx · ${FRAME_LABELS[frame]} K · ${candles.length} 根 · ${candles.length ? `${candles[0].date} ～ ${candles.at(-1).lastDate || candles.at(-1).date}` : '—'} · 未復權${sessionFrameNote(frame, candles.at(-1)?.lastDate || candles.at(-1)?.date) ? ' · ' + sessionFrameNote(frame, candles.at(-1)?.lastDate || candles.at(-1)?.date) : ''}`;
  };
  const load = async () => {
    request?.abort(); const controller = request = new AbortController();
    stamp.textContent = '正在取得官方 K 線…';
    try {
      let indexed = bundleEntry(stock.symbol, '1D');
      if (!indexed) { try { await awaitBundleSymbol(stock.symbol, controller.signal); } catch (error) { if (controller.signal.aborted) throw error; } indexed = bundleEntry(stock.symbol, '1D'); }
      const result = indexed?.data || await twProvider.getCandles(stock.symbol, { interval: '1D', range: '2Y', adjusted: false, signal: controller.signal, timeoutMs: 15000 });
      if (closed || !node.isConnected || controller.signal.aborted || request !== controller) return;
      daily = result.candles || []; chartDate = result.dataDate || result.asOf || date || daily.at(-1)?.date;
      render();
    } catch {
      if (closed || !node.isConnected || controller.signal.aborted || request !== controller) return;
      if (!daily.length) chart.textContent = 'K 線暫時無法載入';
      stamp.textContent = '請點右上重新載入，或開啟完整圖表。';
    }
  };
  node.addEventListener('click', event => {
    const chart = event.target.closest('[data-open-stock-chart]');
    if (chart) openResearchStockChart(chart.dataset.openStockChart);
    else if (event.target.closest('[data-back-sector]')) onBack?.();
    else if (event.target.closest('[data-retry-candles]')) void load();
  });
  node.addEventListener('change', event => { if (event.target.matches('[data-stock-frame]')) { frame = event.target.value; if (daily.length) render(); } });
  await load(); return node;
}
