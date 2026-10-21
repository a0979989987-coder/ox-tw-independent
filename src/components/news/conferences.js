// 法說會 tab: conferences from the MOPS list with their price reaction.
// Data comes from data/tw-conferences.json (scripts/collect-tw-conferences.mjs).
import { node, button } from './layers.js';
const DATA = new URL('../../../data/tw-conferences.json', import.meta.url);
const RADAR = new URL('../../../data/tw-radar.json', import.meta.url);
const KEY = 'ox-tw-independent:news-conferences';
const WINDOWS = [['pre10', '前10日'], ['pre5', '前5日'], ['day1', '首日'], ['post5', '後5日'], ['post10', '後10日']];
const ROWS = [['stock', '個股漲跌'], ['index', '加權指數'], ['excess', '超額報酬']];
const MARKETS = [['all', '全部'], ['TWSE', '上市'], ['TPEX', '上櫃']];
const RANGES = [['all', '全部'], ['3', '3 天內'], ['7', '7 天內'], ['30', '30 天內']];
const SORTS = [['time', '時間（由近到遠）'], ['time-reverse', '時間（由遠到近）'], ['symbol', '股票代號']];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
let loading = null;

function load() {
  loading ??= Promise.all([
    fetch(DATA, { cache: 'no-cache' }).then(response => { if (!response.ok) throw Error(`HTTP ${response.status}`); return response.json(); }),
    fetch(RADAR, { cache: 'no-cache' }).then(response => response.ok ? response.json() : null).catch(() => null)
  ]).then(([data, radar]) => ({ data, radar: new Map((radar?.data?.radar || []).filter(row => /^T[123]$/.test(row.tier)).map(row => [row.symbol, row.tier])) }))
    .catch(error => { loading = null; throw error; });
  return loading;
}
const taipeiNow = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const held = (item, now) => item.date < now.date || item.date === now.date && (item.time || '00:00') <= now.time;
const day = date => `${date.slice(5).replace('-', '/')}（${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
const pct = value => value === null || value === undefined ? '-' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const tone = value => value === null || value === undefined || value === 0 ? '' : value > 0 ? 'oxc-up' : 'oxc-down';

function slideLink(text, url, note) {
  if (!url) { const b = button(text, `${text}尚未提供`, null, 'oxc-slide'); b.disabled = true; b.title = note || '官方尚未提供檔案'; return b; }
  const a = node('a', 'oxc-slide', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = `${text}（官方 PDF，於新分頁開啟）`; return a;
}

function chart(reaction) {
  const points = reaction.series || [];
  if (!points.length) return null;
  const NS = 'http://www.w3.org/2000/svg', W = 320, H = 132, L = 34, R = 8, T = 10, B = 20;
  const values = points.flatMap(p => [p.stock, p.index]).filter(Number.isFinite).concat(0);
  let lo = Math.min(...values), hi = Math.max(...values); if (hi - lo < 1) { hi += .5; lo -= .5; }
  const x = offset => L + (offset + 10) / 20 * (W - L - R), y = value => T + (hi - value) / (hi - lo) * (H - T - B);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'oxc-chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '法說會前後 10 個交易日走勢，個股實線、加權指數虛線');
  const el = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; svg.append(n); return n; };
  for (const v of [hi, 0, lo]) { el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'oxc-zero' : 'oxc-grid' }); el('text', { x: L - 4, y: y(v) + 3, class: 'oxc-axis', 'text-anchor': 'end' }, `${v > 0 ? '+' : ''}${v.toFixed(1)}%`); }
  const event = points.find(p => p.date === reaction.eventDate);
  if (event) { el('line', { x1: x(event.offset), x2: x(event.offset), y1: T, y2: H - B, class: 'oxc-event' }); el('text', { x: x(event.offset), y: H - 6, class: 'oxc-axis oxc-event-label', 'text-anchor': 'middle' }, `法說會 ${event.date.slice(5).replace('-', '/')}`); }
  for (const [key, cls] of [['index', 'oxc-index'], ['stock', 'oxc-stock']]) {
    let d = '', open = false;
    for (const p of points) { if (!Number.isFinite(p[key])) { open = false; continue; } d += `${open ? 'L' : 'M'}${x(p.offset).toFixed(1)} ${y(p[key]).toFixed(1)}`; open = true; }
    if (d) el('path', { d, class: cls, fill: 'none' });
  }
  return svg;
}

function reactionBody(item, now) {
  const r = item.reaction || {}, body = node('div', 'oxc-reaction-body');
  if (item.reaction && item.reaction.stockAvailable === false) { body.append(node('p', 'oxc-note', '此股票不在官方日 K 線包內，無法計算股價反應。')); return body; }
  const table = node('table', 'oxc-table'), head = node('tr');
  head.append(node('th', '', ''), ...WINDOWS.map(([, label]) => node('th', '', label))); table.append(head);
  for (const [key, label] of ROWS) {
    const row = node('tr'); row.append(node('th', '', label));
    for (const [w] of WINDOWS) { const v = r[key]?.[w]; row.append(node('td', tone(v), pct(v))); }
    table.append(row);
  }
  body.append(table);
  const svg = chart(r);
  if (svg) { const legend = node('div', 'oxc-legend'); legend.append(node('span', 'oxc-key-stock', '個股'), node('span', 'oxc-key-index', '加權指數')); body.append(legend, svg); }
  body.append(node('p', 'oxc-note', r.baseDate
    ? `基準日 ${r.baseDate}：法說會前最後一個收盤日。前 N 日為 N 個交易日前到基準日；首日與後 N 日為基準日到之後第 N 個交易日。超額報酬＝個股－加權。還沒收盤的格子顯示「-」。`
    : held(item, now) ? '尚無基準日收盤資料。' : '法說會前最後一個收盤日還沒收盤，股價反應尚未產生。'));
  return body;
}

// Opens the radar tab chart for this stock, as the news asset detail does.
function openRadar(symbol) {
  window.OXMarketController?.setMarket('tw'); window.switchAppView?.('radar');
  document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol', { detail: { symbol } }));
}

function card(item, state, now, radar) {
  const article = node('article', 'oxc-card'), top = node('div', 'oxc-top'), title = node('div', 'oxc-name');
  title.append(node('strong', '', item.name), node('span', 'oxc-symbol', item.symbol), node('small', 'oxc-market', item.market === 'TPEX' ? '上櫃' : '上市'));
  const tier = radar.get(item.symbol);
  if (tier) { const tag = node('span', 'oxc-tier', tier); tag.dataset.tier = tier; tag.title = `雷達 ${tier}`; title.append(tag); }
  const links = node('div', 'oxc-links'); links.append(slideLink('簡報', item.zhUrl, item.slideNote), slideLink('Deck', item.enUrl, item.slideNote));
  top.append(title, links);
  const when = node('p', 'oxc-when', `${day(item.date)}${item.endDate ? `～${day(item.endDate)}` : ''} ${item.time || '時間未提供'}`);
  if (item.location) when.append(node('span', 'oxc-place', item.location));
  const line = node('div', 'oxc-line'); line.append(when);
  if (/^\d{4}$/.test(item.symbol)) line.append(button('看雷達', `在雷達查看 ${item.symbol} ${item.name}`, () => openRadar(item.symbol), 'oxc-radar'));
  article.append(top, line);
  if (item.summary) { const s = node('p', 'oxc-summary', item.summary); s.title = item.summary; article.append(s); }
  const details = node('details', 'oxc-reaction'), summary = node('summary', '', '股價反應');
  details.open = Boolean(state.open[item.id]);
  details.append(summary);
  // Built on first open so a long list stays light.
  const fill = () => { if (details.open && details.children.length === 1) details.append(reactionBody(item, now)); };
  details.addEventListener('toggle', () => { state.open[item.id] = details.open || undefined; persist(state); fill(); });
  fill(); article.append(details);
  return article;
}

function persist(state) { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

function sheet(state, apply) {
  const backdrop = node('div', 'oxc-sheet-backdrop'), panel = node('section', 'oxc-sheet');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', '法說會篩選');
  const previous = document.activeElement, life = new AbortController();
  const close = () => { life.abort(); backdrop.classList.remove('is-open'); setTimeout(() => backdrop.remove(), 260); previous?.focus?.({ preventScroll: true }); };
  const header = node('header', 'oxc-sheet-head'); header.append(node('strong', '', '篩選'), button('完成', '關閉篩選', close, 'oxc-sheet-done'));
  panel.append(header);
  for (const [title, property, choices] of [['市場', 'market', MARKETS], ['日期範圍', 'range', RANGES], ['排序', 'sort', SORTS]]) {
    const group = node('div', 'oxc-sheet-group'), tags = node('div', 'oxc-chips'); group.append(node('h4', '', title), tags);
    for (const [id, label] of choices) {
      const b = button(label, '', () => { state[property] = id; [...tags.children].forEach(n => n.setAttribute('aria-pressed', String(n === b))); apply(); }, 'oxc-chip');
      b.setAttribute('aria-pressed', String(state[property] === id)); tags.append(b);
    }
    panel.append(group);
  }
  panel.append(button('恢復預設', '', () => { Object.assign(state, { market: 'all', range: 'all', sort: 'time' }); apply(); close(); }, 'oxc-sheet-reset'));
  backdrop.append(panel); document.body.append(backdrop);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); }, { signal: life.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, { signal: life.signal });
  requestAnimationFrame(() => { backdrop.classList.add('is-open'); header.querySelector('button').focus({ preventScroll: true }); });
}

export function mountConferences(host, { signal } = {}) {
  let saved; try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}
  const state = { query: '', market: 'all', range: 'all', sort: 'time', view: 'upcoming', radarOnly: false, open: {}, ...saved };
  const root = node('section', 'oxc-root'), bar = node('div', 'oxc-bar'), modes = node('div', 'oxc-modes'), list = node('div', 'oxc-list'), meta = node('p', 'oxc-meta');
  const search = node('input', 'oxc-search'); search.type = 'search'; search.placeholder = '股名或代號'; search.value = state.query; search.setAttribute('aria-label', '搜尋法說會股名或代號');
  const filter = button('', '篩選市場、日期範圍、排序', () => sheet(state, () => { persist(state); render(); }), 'oxc-filter');
  filter.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></svg>';
  bar.append(search, filter);
  const segment = node('div', 'oxc-segment'); segment.setAttribute('role', 'tablist');
  const views = [['upcoming', '即將舉行'], ['held', '已舉行']].map(([id, label]) => { const b = button(label, '', () => { state.view = id; persist(state); render(); }, 'oxc-view'); b.dataset.view = id; b.setAttribute('role', 'tab'); return b; });
  segment.append(...views);
  const radarSwitch = node('label', 'oxc-switch'), radarInput = node('input'); radarInput.type = 'checkbox'; radarInput.checked = state.radarOnly; radarInput.setAttribute('role', 'switch');
  radarSwitch.append(radarInput, node('span', 'oxc-switch-track'), node('span', 'oxc-switch-label', '只看雷達股'));
  radarInput.addEventListener('change', () => { state.radarOnly = radarInput.checked; persist(state); render(); });
  modes.append(segment, radarSwitch);
  root.append(bar, modes, meta, list); host.replaceChildren(root);
  let timer, loaded = null, failed = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.query = search.value.trim(); persist(state); render(); }, 120); }, { signal });

  function render() {
    const now = taipeiNow();
    views.forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    filter.classList.toggle('is-filtered', state.market !== 'all' || state.range !== 'all' || state.sort !== 'time');
    list.replaceChildren();
    if (failed) { meta.textContent = ''; list.append(node('p', 'oxc-empty', '法說會資料暫時無法讀取。'), button('重試', '重新讀取法說會資料', start, 'oxn-action')); return; }
    if (!loaded) { meta.textContent = ''; list.append(node('p', 'oxc-empty', '正在讀取法說會資料…')); return; }
    const { data, radar } = loaded, q = state.query.toLowerCase(), n = Number(state.range);
    let items = data.items.filter(item => (state.view === 'held') === held(item, now)
      && (state.market === 'all' || item.market === state.market)
      && (!state.radarOnly || radar.has(item.symbol))
      && (!q || item.symbol.startsWith(q) || item.name.toLowerCase().includes(q))
      && (state.range === 'all' || (state.view === 'held' ? item.date >= addDays(now.date, -n) : item.date <= addDays(now.date, n))));
    const key = item => `${item.date} ${item.time || ''}`;
    items.sort(state.sort === 'symbol' ? (a, b) => a.symbol.localeCompare(b.symbol) || key(a).localeCompare(key(b))
      : (a, b) => (state.view === 'held' ? -1 : 1) * (state.sort === 'time-reverse' ? -1 : 1) * key(a).localeCompare(key(b)));
    meta.textContent = `${items.length} 場・資料來源：公開資訊觀測站法人說明會一覽表，更新 ${new Date(data.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`;
    if (state.radarOnly && !radar.size) list.append(node('p', 'oxc-empty', '雷達名單尚未取得。'));
    else if (!items.length) list.append(node('p', 'oxc-empty', state.view === 'held' ? '沒有符合條件的已舉行法說會。' : '未來 14 天沒有符合條件的法說會。'));
    for (const item of items.slice(0, 300)) list.append(card(item, state, now, radar));
  }
  function start() { failed = null; render(); load().then(value => { loaded = value; render(); }, error => { failed = error; render(); }); }
  start();
}
