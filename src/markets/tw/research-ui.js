export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '—';
export const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value)}%` : '—';
export const money = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value / 1e8)} 億` : '—';
export const direction = value => Number.isFinite(value) ? value > 0 ? 'up' : value < 0 ? 'down' : 'flat' : 'flat';
export function segments(id, items, active) {
  const index = Math.max(0, items.findIndex(i => i[0] === active));
  return `<div class="twx-segments" role="group" aria-label="${escape(id)}" style="--count:${items.length};--active:${index}"><i aria-hidden="true"></i>${items.map(([key, label]) => `<button type="button" data-${id}="${key}" aria-pressed="${key === active}">${label}</button>`).join('')}</div>`;
}
export function mountResearch(view) {
  const root = document.getElementById('market-unavailable-card');
  if (!root || document.body.dataset.market !== 'tw') return null;
  ['ox-tw-home-style', 'ox-tw-indicator-style'].forEach(id => document.getElementById(id)?.remove());
  if (!document.getElementById('ox-tw-research-css')) {
    const link = document.createElement('link'); link.id = 'ox-tw-research-css'; link.rel = 'stylesheet';
    link.href = new URL('./research-ui.css?v=20261005-homeflow7', import.meta.url).href; document.head.append(link);
  }
  root.classList.remove('tw-home-root', 'tw-indicator-root');
  root.classList.add(view === 'home' ? 'tw-home-root' : 'tw-indicator-root');
  root.hidden = false;
  return root;
}
export function stockRows(rows, watched, limit = 100) {
  return rows.slice(0, limit).map(s => `<div class="twx-stock"><button type="button" class="twx-stock-name" data-stock="${escape(s.symbol)}"><strong>${escape(s.name)}</strong><small>${escape(s.symbol)} · ${escape(s.market === 'TWSE' ? '上市' : '上櫃')}</small></button><span class="twx-value ${direction(s.changePct)}"><b>${number(s.price)}</b><small>${pct(s.changePct)}</small></span><span class="twx-value ${direction(s.netTwd)}"><b>${money(s.netTwd)}</b><small>法人估算</small></span><button type="button" class="twx-star ${watched.has(s.symbol) ? 'selected' : ''}" data-watch="${escape(s.symbol)}" aria-label="收藏 ${escape(s.name)}" aria-pressed="${watched.has(s.symbol)}">${watched.has(s.symbol) ? '★' : '☆'}</button></div>`).join('');
}
