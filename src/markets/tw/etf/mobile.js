import { esc, fmt, pct, color } from './ui.js?v=20261002-compact1';

// Keep the dense desktop table; phones get the same data as readable cards.
export function fundCards(rows, { saved, columns, cell, start = 0 }) {
  return `<div class="fund-cards">${rows.map((r, i) => `<article class="fund-card">
    <div class="fund-head"><button class="link-btn" data-detail="${esc(r.symbol)}"><small>NO. ${start + i + 1} · ${esc(r.symbol)}</small><strong>${esc(r.name)}</strong></button><button class="star ${saved.has(r.symbol) ? 'saved' : ''}" data-star="${esc(r.symbol)}" aria-label="${saved.has(r.symbol) ? '移除' : '加入'} ${esc(r.symbol)} 自選" aria-pressed="${saved.has(r.symbol)}">${saved.has(r.symbol) ? '★' : '☆'}</button></div>
    <div class="fund-price"><b>${fmt(r.price)} <small>${esc(r.currency)}</small></b><span class="${color(r.changePct)}">${pct(r.changePct)}</span></div>
    <small>收盤 ${esc(r.date || '日期待公布')}</small>
    <dl class="fund-metrics">${['yield','return1y','aum'].map(key=>`<div><dt>${esc(columns.find(c=>c[0]===key)[1])}</dt><dd>${cell(r,key)}</dd></div>`).join('')}</dl>
    <div class="fund-actions"><button data-calc="${esc(r.symbol)}">存股試算</button><button data-compare="${esc(r.symbol)}">持股比較</button></div>
    <details data-fund-extra="${esc(r.symbol)}"><summary>完整數據</summary><dl class="fund-extra">${columns.filter(([key])=>!['price','changePct','yield','return1y','aum'].includes(key)).map(([key,label])=>`<div><dt>${esc(label)}</dt><dd>${cell(r,key)}</dd></div>`).join('')}</dl></details>
  </article>`).join('') || '<p class="empty">沒有符合條件的 ETF</p>'}</div>`;
}

// Secondary data tables become labelled vertical records on phones.
export function labelMobileTables(root) {
  for (const table of root.querySelectorAll('.etf-table:not(.desktop-funds)')) {
    table.classList.add('mobile-records');
    const labels = [...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.cells].forEach((td,i)=>{ if(i && labels[i]) td.dataset.label=labels[i]; });
    }
  }
}
