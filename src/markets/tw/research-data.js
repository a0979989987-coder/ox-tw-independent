import { getTWApiBase } from './api.js?v=20261005-recovery20';
const KEY = 'ox-tw-research-v1';
let value, pending, lastSuccess = 0;
const listeners=new Set();
export function subscribeResearch(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function savedResearch() {
  if (value) return value;
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(saved?.stocks)) value = saved; } catch {}
  return value || null;
}
function accept(data) {
  if (!Array.isArray(data?.stocks) || !data.date) throw new Error('台股資料格式異常');
  if (!value || data.date > value.date || data.date === value.date && Date.parse(data.updatedAt||0)>=Date.parse(value.updatedAt||0)) {
    value = data;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    for(const listener of listeners)listener(value);
  }
  return value;
}
export async function loadResearch({ force = false, onCached } = {}) {
  savedResearch();
  if (value) onCached?.(value);
  if (pending) return pending;
  if (!force && value && Date.now() - lastSuccess < 300000) return { data: value, error: null };
  pending = (async () => {
    {
      try {
        const response = await fetch(new URL('../../../data/tw-research.json', import.meta.url), { cache:'no-store', signal: AbortSignal.timeout(6000) });
        if (response.ok) { accept(await response.json()); onCached?.(value); }
      } catch {}
    }
    try {
      const response = await fetch(`${getTWApiBase()}/v1/tw/research${force?'?refresh=1&t='+Date.now():''}`, { cache:'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('官方資料暫時無法更新');
      const payload = await response.json();
      const data = accept(payload.data); lastSuccess = Date.now();
      return { data, error: null };
    } catch (error) { return { data: value, error: error.message }; }
  })().finally(() => { pending = null; });
  return pending;
}
export function readWatchlist() {
  try { return new Set(JSON.parse(localStorage.getItem('ox-tw-radar-watchlist-v1') || '[]')); } catch { return new Set(); }
}
export function toggleWatch(symbol) {
  const list = readWatchlist();
  list.has(symbol) ? list.delete(symbol) : list.add(symbol);
  try { localStorage.setItem('ox-tw-radar-watchlist-v1', JSON.stringify([...list])); } catch { return null; }
  return list.has(symbol);
}
export function selectSectors(data, { scope = 'all', market = 'ALL', query = '' } = {}) {
  const watches = readWatchlist();
  const stocks = (data?.stocks || []).filter(s => market === 'ALL' || s.market === market);
  const groups = new Map();
  stocks.forEach(s => { if (!groups.has(s.industry)) groups.set(s.industry, []); groups.get(s.industry).push(s); });
  const q = query.trim().toLowerCase();
  return [...groups].filter(([, rows]) => scope !== 'watch' || rows.some(s => watches.has(s.symbol))).map(([name, rows]) => {
    const flows = rows.filter(r => Number.isFinite(r.netTwd));
    const prices = rows.filter(r => Number.isFinite(r.changePct));
    const whole = market === 'ALL';
    const source = whole ? data?.sectors?.find(s => s.name === name) : null;
    return { name, rows, count: rows.length, covered: flows.length,
      flow: flows.length ? flows.reduce((n, r) => n + r.netTwd, 0) : null,
      changePct: prices.length ? prices.reduce((n, r) => n + r.changePct, 0) / prices.length : null,
      turnoverTwd: rows.reduce((n, r) => n + (r.turnoverTwd || 0), 0), buyCount: flows.filter(r => r.netTwd > 0).length,
      flow5: source?.flow5 ?? null, flow20: source?.flow20 ?? null, momentum: source?.momentum ?? null };
  }).filter(s => !q || s.name.toLowerCase().includes(q) || s.rows.some(r => `${r.symbol} ${r.name}`.toLowerCase().includes(q)));
}
export const quadrant = (x, y) => x >= 0 ? (y >= 0 ? 0 : 1) : (y >= 0 ? 2 : 3);
