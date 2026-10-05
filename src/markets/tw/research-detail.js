import { twProvider } from './api.js?v=20261005-recovery20';
import { renderTWCandles } from './radar-card.js';
import { escape, number, pct, money, direction, stockRows } from './research-ui.js';
import { readWatchlist, toggleWatch } from './research-data.js?v=20261001-twhome1';
import {highlightsContent} from './home-highlights.js?v=20261005-briefingdate';
export function closeResearchDetails() { document.querySelectorAll('.twx-dialog').forEach(d => { d.close(); d.remove(); }); }
function dialog(title) {
  closeResearchDetails();
  const node = document.createElement('dialog'); node.className = 'twx-dialog';
  node.innerHTML = `<header><strong>${escape(title)}</strong><button type="button" data-close aria-label="關閉">×</button></header><div class="twx-detail-content"></div>`;
  document.body.append(node); node.showModal();
  const close = () => { node.classList.add('leaving'); setTimeout(() => { node.close(); node.remove(); }, 180); };
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
 const node=dialog(phase==='before'?'盤前重點':'盤後重點');node.dataset.homeHighlights=phase;
 node.setAttribute('aria-label',phase==='before'?'盤前重點':'盤後重點');
 updateHomeHighlights(home,phase,research);return node;
}
export function watchClick(button) {
  const selected = toggleWatch(button.dataset.watch);
  if (selected === null) { button.title = '無法儲存收藏，請確認瀏覽器儲存空間'; return; }
  button.classList.toggle('selected', selected); button.textContent = selected ? '★' : '☆'; button.setAttribute('aria-pressed', String(selected));
}
export function showSector(sector) {
  const node = dialog(sector.name);
  node.querySelector('.twx-detail-content').innerHTML = `<div class="twx-detail-metrics"><span>當日法人估算<b class="${direction(sector.flow)}">${money(sector.flow)}</b></span><span>產業漲跌<b class="${direction(sector.changePct)}">${pct(sector.changePct)}</b></span><span>買超家數<b>${sector.buyCount} / ${sector.covered}</b></span></div><div class="twx-detail-metrics"><span>5 日累計<b>${money(sector.flow5)}</b></span><span>20 日累計<b>${money(sector.flow20)}</b></span><span>5／20 日動能<b>${money(sector.momentum)}／日</b></span></div><div class="twx-detail-list">${stockRows([...sector.rows].sort((a, b) => (b.netTwd ?? -Infinity) - (a.netTwd ?? -Infinity)), readWatchlist(), 2000)}</div>`;
  node.addEventListener('click', e => {
    const star = e.target.closest('[data-watch]'); if (star) { e.stopPropagation(); watchClick(star); return; }
    const stock = e.target.closest('[data-stock]'); if (stock) showStock(sector.rows.find(s => s.symbol === stock.dataset.stock));
  });
}
export async function showStock(stock) {
  if (!stock) return;
  const node = dialog(`${stock.name} ${stock.symbol}`);
  node.querySelector('.twx-detail-content').innerHTML = `<div class="twx-detail-metrics"><span>收盤<b>${number(stock.price)}</b></span><span>漲跌<b class="${direction(stock.changePct)}">${pct(stock.changePct)}</b></span><span>法人估算<b class="${direction(stock.netTwd)}">${money(stock.netTwd)}</b></span></div><div class="twx-kline" aria-live="polite">日 K 載入中…</div><div class="twx-detail-metrics">${[['外資', stock.foreignTwd], ['投信', stock.trustTwd], ['自營商', stock.dealerTwd]].map(([label, v]) => `<span>${label}<b class="${direction(v)}">${money(v)}</b></span>`).join('')}</div>`;
  try {
    const result = await twProvider.getCandles(stock.symbol, { interval: '1D', range: '3M', limit: 60, adjusted: false });
    if (node.isConnected) node.querySelector('.twx-kline').innerHTML = renderTWCandles(result.candles || []) || '尚無日 K 資料';
  } catch { if (node.isConnected) node.querySelector('.twx-kline').textContent = '日 K 暫時無法載入'; }
}
