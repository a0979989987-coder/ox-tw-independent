import {savedHome,loadHome} from './home-data.js?v=20261005-briefingdate';
import {coreContent,briefingContent,institutionContent} from './home-content.js?v=20261001-twhome1';
import { savedResearch, loadResearch, selectSectors, readWatchlist, quadrant } from './research-data.js?v=20261001-twhome1';
import { escape, number, pct, money, direction, segments, mountResearch, stockRows } from './research-ui.js';
import { bubbleChart, bubblePoints } from './research-bubbles.js?v=20261006-replay';
import { SECTOR_DEFINITIONS, SECTOR_TAXONOMY_VERSION } from './sector-taxonomy.js';
import { sectorPicker, sectorPickerList } from './sector-picker.js';
import { replayHistory, replayFrames, replayFrameAt, drawReplayFrame, createReplayPlayer } from './research-replay.js?v=20261006-replay';
import { closeResearchDetails, showSector, showStock, watchClick, showHomeHighlights, updateHomeHighlights } from './research-detail.js?v=20261005-briefingdate';
const prefs = { tab: 'bubble', scope: 'all', market: 'ALL', mode: 'auto', density: 'all', zoom: 1, panX: 0, panY: 0, sort: 'buy', query: '', quadrant: null, help: false, replayIndex: null, replaySpeed: 1, classification: 'theme', selectedSectors: [], pickerOpen: false, pickerQuery: '', openGroups: [] };
let session, data = savedResearch(), loading = false, error = null, lastFetch = 0;
let home=savedHome(),homeLoading=false,homeFetched=0,homeSession='after';
async function refreshHome(s,force=false){
 if(homeLoading)return;homeLoading=true;if(s&&current(s))paint(s);
 try{home=await loadHome({force,onChange(snapshot){home=snapshot;if(session?.view==='home'&&current(session))paint(session);}});}
 finally{homeLoading=false;homeFetched=Date.now();if(session?.view==='home'&&current(session))paint(session);}
}
export function stopResearch() { session?.player?.destroy(); prefs.replayIndex = null; session?.controller.abort(); session = null; closeResearchDetails(); }
const current = s => session === s && document.body.dataset.market === 'tw' && s.root.querySelector(`[data-twx-view="${s.view}"]`);
function homeContent(state) {
  const stocks = data?.stocks || [];
  const sectors = selectSectors(data).filter(s => Number.isFinite(s.flow));
  const leaders = [...sectors].sort((a, b) => b.flow - a.flow);
  const chip = s => `<button type="button" class="twx-sector-chip" data-sector="${escape(s.name)}"><span>${escape(s.name)}</span><b class="${direction(s.flow)}">${money(s.flow)}</b></button>`;

  const toolbar=`<div class="twx-home-toolbar"><div class="twx-home-session-actions"><button type="button" class="twx-session-toggle" data-home-session aria-label="切換${homeSession==='after'?'盤前':'盤後'}資訊"><span class="${homeSession==='after'?'active':''}">盤後</span><span aria-hidden="true">⇄</span><span class="${homeSession==='before'?'active':''}">盤前</span></button><button type="button" class="twx-highlights-button" data-home-highlights aria-haspopup="dialog">${homeSession==='after'?'盤後':'盤前'}重點</button></div><button type="button" class="twx-refresh" data-home-refresh ${homeLoading?'disabled':''}>${homeLoading?'更新中…':'更新資料'}</button></div>`;
  if(homeSession==='before')return toolbar+briefingContent(home,homeLoading);
  return `${toolbar}<div class="twx-home-grid">${coreContent(home,homeLoading)}${institutionContent(home)}<section class="twx-glass twx-flows"><div class="twx-section-head"><span>法人買賣超產業</span><button type="button" data-go="strength">查看泡泡圖 ↗</button></div><div class="twx-flow-columns"><div><h3 class="up">買超</h3><div class="twx-chip-list">${leaders.filter(s => s.flow > 0).slice(0, 5).map(chip).join('') || '<span class="twx-muted">法人資料待更新</span>'}</div></div><div><h3 class="down">賣超</h3><div class="twx-chip-list">${leaders.filter(s => s.flow < 0).reverse().slice(0, 5).map(chip).join('') || '<span class="twx-muted">法人資料待更新</span>'}</div></div></div></section><section class="twx-glass twx-home-wide"><div class="twx-section-head"><span>法人動向</span><small>估算淨買超</small></div>${stockRows([...stocks].filter(s => Number.isFinite(s.netTwd)).sort((a, b) => b.netTwd - a.netTwd), readWatchlist(), 5) || '<div class="twx-empty">官方資料載入後顯示</div>'}</section></div>`;
}
function chartMode() {
  if (prefs.replayIndex !== null && session?.replayMode) return session.replayMode;
  if (prefs.mode !== 'auto') return prefs.mode;
  return selectSectors(data, prefs).some(s => Number.isFinite(s.momentum) && Number.isFinite(s.flow20)) ? 'momentum' : 'day';
}
let replayHistoryCache;
function historyDays() {
  const history = session?.replayData?.history || data?.history || [], mode = chartMode();
  if (replayHistoryCache?.history !== history || replayHistoryCache.mode !== mode || replayHistoryCache.classification !== prefs.classification)
    replayHistoryCache = { history, mode, classification: prefs.classification, days: replayHistory(prefs.classification === 'theme' ? history.map(day => ({ ...day, sectors: day.themeVersion === SECTOR_TAXONOMY_VERSION ? day.themes || [] : [] })) : history, mode) };
  return replayHistoryCache.days;
}
function replaySectors(day) {
  const query = prefs.query.trim().toLowerCase();
  const matched = new Set(selectSectors(session?.replayData || data, { ...prefs, market: 'ALL' }).map(s => s.name));
  return (day?.sectors || []).filter(s => (prefs.scope !== 'watch' && !query || matched.has(s.name)) && (!prefs.selectedSectors.length || prefs.selectedSectors.includes(s.name)));
}
function chartSectors() {
  if (prefs.replayIndex === null) return selectSectors(data, prefs).filter(s => !prefs.selectedSectors.length || prefs.selectedSectors.includes(s.name));
  return replaySectors(historyDays()[Math.floor(prefs.replayIndex)]);
}
function pauseReplay(s) { s.player?.pause(); }
function playReplay(s) {
  if (!historyDays().length) return;
  if (prefs.replayIndex === null) { s.replayMode = chartMode(); prefs.replayIndex = 0; s.replayData = { ...data, history: [...(data?.history || [])] }; paint(s); }
  s.player?.play();
}
function chartOptions() { return { ...prefs, density: prefs.scope === 'watch' || prefs.selectedSectors.length ? 'all' : prefs.density }; }
function buildReplayFrames() {
  const mode = chartMode();
  return replayFrames(historyDays().map(day => ({ ...day, sectors: replaySectors(day).filter(sector => {
    const x = mode === 'momentum' ? sector.flow5 : sector.flow, y = mode === 'momentum' ? sector.momentum : sector.changePct;
    return prefs.quadrant === null || quadrant(x, y) === prefs.quadrant;
  }) })), mode, chartOptions());
}
const replayDate = date => {
  const d = new Date(date + 'T00:00:00Z');
  return `${Number(date.slice(5,7))}/${Number(date.slice(8))} 週${'日一二三四五六'[d.getUTCDay()]}`;
};
function replayControls() {
  const days = historyDays(), index = Math.min(Math.floor(prefs.replayIndex), days.length - 1);
  const day = days[index];
  return `<div class="twx-replay"><time data-replay-date>${escape(day ? replayDate(day.date) : '尚無完整歷史')}</time><input type="range" data-replay-seek min="0" max="${Math.max(0, days.length - 1)}" step="0.01" value="${prefs.replayIndex}" aria-label="回放交易日"><div class="twx-replay-dates"><span>${escape(days[0]?.date || '')}</span><span>${escape(days.at(-1)?.date || '')}</span></div><div class="twx-replay-buttons"><button type="button" data-replay-step="-1" aria-label="上一個交易日">‹</button><button type="button" data-replay-play aria-label="播放回放">▶</button><button type="button" data-replay-step="1" aria-label="下一個交易日">›</button><button type="button" data-replay-speed aria-label="播放速度">${prefs.replaySpeed}x</button></div><small data-replay-summary></small></div>`;
}
function mountReplay(s, resume) {
  if (prefs.replayIndex === null) return;
  const frames = s.replayFrames || [], svg = s.root.querySelector('.twx-bubbles'), mode = chartMode();
  s.visibleReplayIndex = null;
  s.player = createReplayPlayer({ length: frames.length, position: prefs.replayIndex, speed: prefs.replaySpeed,
    isActive: () => current(s) && !document.hidden,
    render(position) { if (svg) drawReplayFrame(svg, replayFrameAt(frames, position), mode); },
    onState({ position, playing }) {
      if (session !== s || s.rebuilding) return;
      prefs.replayIndex = position;
      const seek = s.root.querySelector('[data-replay-seek]'); if (seek) seek.value = position;
      const play = s.root.querySelector('[data-replay-play]');
      if (play) { play.textContent = playing ? 'Ⅱ' : position >= frames.length - 1 ? '↻' : '▶'; play.setAttribute('aria-label', playing ? '暫停回放' : position >= frames.length - 1 ? '重新播放回放' : '播放回放'); }
      const index = Math.floor(position), day = frames[index];
      const date = s.root.querySelector('[data-replay-date]');
      if (date && day) date.textContent = position % 1 > .001 && frames[index + 1] ? `${replayDate(day.date)} → ${replayDate(frames[index + 1].date)}` : replayDate(day.date);
      const prev = s.root.querySelector('[data-replay-step="-1"]'); if (prev) prev.disabled = position <= 0;
      const next = s.root.querySelector('[data-replay-step="1"]'); if (next) next.disabled = position >= frames.length - 1;
      if (day && s.visibleReplayIndex !== index) {
        s.visibleReplayIndex = index;
        const bubbleCount = s.root.querySelector('[data-bubble-count]'); if (bubbleCount) bubbleCount.textContent = bubbleCountText();
        const values = bubblePoints(day.sectors, mode).sort((a, b) => b.x - a.x), counts = [0, 0, 0, 0];
        for (const point of values) counts[quadrant(point.x, point.y)]++;
        s.root.querySelectorAll('[data-quadrant] strong').forEach((el, i) => { el.textContent = counts[i]; });
        const summary = s.root.querySelector('[data-replay-summary]');
        const buy = values.find(p => p.x > 0), sell = [...values].reverse().find(p => p.x < 0);
        if (summary) summary.textContent = `${mode === 'momentum' ? '近五日' : '當日'}買最多 ${buy ? buy.name + ' ' + money(buy.x) : '—'} ｜ 賣最多 ${sell ? sell.name + ' ' + money(sell.x) : '—'}`;
        const caption = s.root.querySelector('.twx-chart-method'); if (caption) caption.textContent = `歷史回放 ${day.date} · ${mode === 'momentum' ? '法人資金動向' : '當日價量'} · 過渡位置為動畫`;
        if (prefs.tab === 'rank') s.root.querySelector('.twx-chart-content').innerHTML = results();
        const list = s.root.querySelector('.twx-sector-list');
        if (list) list.innerHTML = day.sectors.map(sector => `<button type="button" data-sector="${escape(sector.name)}"><span>${escape(sector.name)}</span><b class="${direction(mode === 'momentum' ? sector.flow5 : sector.flow)}">${money(mode === 'momentum' ? sector.flow5 : sector.flow)}</b></button>`).join('');
      }
    }
  });
  s.player.seek(prefs.replayIndex);
  if (resume) s.player.play();
}
function minChartZoom() { return prefs.quadrant !== null ? 2 : 1; }
function resetChart() { prefs.zoom = minChartZoom(); prefs.panX = prefs.quadrant === null ? 0 : prefs.quadrant < 2 ? -195 : 195; prefs.panY = prefs.quadrant === null ? 0 : prefs.quadrant % 2 === 0 ? 195 : -195; }
function filtered() {
  const mode = chartMode();
  return chartSectors().filter(s => {
    const x = mode === 'momentum' ? s.flow5 : s.flow, y = mode === 'momentum' ? s.momentum : s.changePct;
    return prefs.quadrant === null || (Number.isFinite(x) && Number.isFinite(y) && quadrant(x, y) === prefs.quadrant);
  });
}
function results() {
  const sectors = filtered(), mode = chartMode();
  if (prefs.tab === 'bubble') return bubbleChart(sectors, mode, '', { ...chartOptions(), layout: prefs.replayIndex !== null ? session?.replayFrames?.[Math.floor(prefs.replayIndex)] : undefined });
  const sortKey = prefs.sort === 'up' || prefs.sort === 'down' ? 'changePct' : mode === 'momentum' ? 'flow5' : 'flow';
  const sign = ['sell', 'down'].includes(prefs.sort) ? 1 : -1;
  const sorted = [...sectors].filter(s => Number.isFinite(s[sortKey])).sort((a, b) => sign * (a[sortKey] - b[sortKey]));
  return `<div class="twx-ranking">${sorted.map((s, index) => `<button type="button" class="twx-rank" data-sector="${escape(s.name)}"><span class="twx-rank-number">${index + 1}</span><span><b>${escape(s.name)}</b><small>${s.buyCount} / ${s.covered} 檔買超</small></span><span class="${direction(s.changePct)}">${pct(s.changePct)}</span><strong class="${direction(s[sortKey])}">${['up', 'down'].includes(prefs.sort) ? money(s.flow) : money(s[sortKey])}</strong></button>`).join('') || '<div class="twx-empty">沒有符合條件的產業</div>'}</div>`;
}
function bubbleCountText() {
  const mode = chartMode(), sectors = filtered(), valid = bubblePoints(sectors, mode);
  const frame = session?.replayFrames?.[Math.floor(prefs.replayIndex)];
  const count = prefs.replayIndex !== null && frame ? frame.points.filter(p => p.opacity > 0).length
    : chartOptions().density === 'top' ? Math.min(10, valid.length) : valid.length;
  const missing = sectors.length - valid.length;
  return `本日繪出 ${count} 顆泡泡${missing > 0 ? ` · ${missing} 個板塊${mode === 'momentum' ? '歷史不足' : '資料不足'}` : ''}`;
}
function chartActions() {
  return `<div class="twx-chart-actions">${prefs.scope === 'all' ? segments('density', [['all', '全部板塊'], ['top', '金額前 10']], prefs.density) : '<small>自選股票相關板塊</small>'}<div class="twx-zoom" role="group" aria-label="圖表縮放"><button type="button" data-zoom="out" aria-label="縮小圖表" ${prefs.zoom <= minChartZoom() ? 'disabled' : ''}>−</button><button type="button" data-zoom="reset" aria-label="重設圖表">${Math.round(prefs.zoom * 100)}%</button><button type="button" data-zoom="in" aria-label="放大圖表" ${prefs.zoom >= 8 ? 'disabled' : ''}>＋</button></div></div><small class="twx-chart-hint"><span data-bubble-count>${bubbleCountText()}</span> · 細點為實際座標 · 泡泡內為${chartMode() === 'momentum' ? '近五日' : '當日'}金額 · 雙指可縮放 · 放大可拖曳</small>`;
}
function indicatorContent() {
  const all = chartSectors(), mode = chartMode();
  const valid = bubblePoints(all, mode), counts = [0, 0, 0, 0];
  for (const s of valid) counts[quadrant(s.x, s.y)]++;
  const labels = mode === 'momentum' ? ['流入加速', '流入放緩', '流出收斂', '流出加速'] : ['買超上漲', '買超下跌', '賣超上漲', '賣超下跌'];
  const hints = mode === 'momentum' ? ['淨買超且力道增強', '淨買超但力道放緩', '淨賣超但賣壓減弱', '淨賣超且賣壓增強'] : ['當日淨買超且上漲', '當日淨買超且下跌', '當日淨賣超且上漲', '當日淨賣超且下跌'];
  const days = (data?.history || []).filter(h => h.sectors?.length).length;
  const replayDay = prefs.replayIndex === null ? null : historyDays()[Math.floor(prefs.replayIndex)];
  const caption = replayDay ? `歷史回放 ${escape(replayDay.date)} · ${mode === 'momentum' ? '法人資金動向' : '當日價量'}` : mode === 'momentum' ? `主題板塊 · 資金資料完整 ${valid.length}／${all.length} 類` : `主題板塊 · 當日價量${days < 20 ? ` · 歷史 ${days}／20 日` : ''}`;
  return `<div class="twx-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜尋股票或板塊" placeholder="搜尋股票或板塊" value="${escape(prefs.query)}"></div><div class="twx-quadrants">${labels.map((label, i) => `<button type="button" data-quadrant="${i}" aria-label="${label}：${hints[i]}" title="${hints[i]}" aria-pressed="${prefs.quadrant === i}" class="q${i}"><small>${label}</small><strong>${data && valid.length ? counts[i] : '—'}</strong></button>`).join('')}</div><div class="twx-visual"><section class="twx-glass twx-chart-panel"><div class="twx-chart-tools"><div class="twx-chart-main">${segments('scope', [['all', '板塊'], ['watch', '自選']], prefs.scope)}${sectorPicker(prefs)}<select data-market aria-label="市場範圍" ${replayDay ? 'disabled title="歷史回放僅提供全市場產業資料"' : ''}><option value="ALL" ${prefs.market === 'ALL' ? 'selected' : ''}>全部</option><option value="TWSE" ${prefs.market === 'TWSE' ? 'selected' : ''}>上市</option><option value="TPEX" ${prefs.market === 'TPEX' ? 'selected' : ''}>上櫃</option></select></div><div class="twx-chart-utility"><button type="button" data-help aria-label="圖表說明" aria-expanded="${prefs.help}">?</button><button type="button" data-replay aria-pressed="${prefs.replayIndex !== null}" ${historyDays().length < 2 ? 'disabled title="此模式尚無完整歷史資料"' : ''}>${prefs.replayIndex !== null ? '結束回放' : '回放'}</button></div></div>${prefs.help ? `<div class="twx-chart-help" role="note">這是題材分類，一檔股票可能屬於多個板塊，因此不同板塊金額不可相加當作全市場總額。越右代表近 5 日資金流入越多，越左代表流出越多；越上代表買入力道增強，越下代表買入力道減弱。速度以近 5 日平均淨買超減去近 20 日平均淨買超計算，正值表示更偏向買入，負值表示更偏向賣出。當日價量圖則顯示當日淨買賣超與產業漲跌幅。資金動向的圈大小代表近 20 日淨買賣超絕對值；圈內金額代表近五日估算，當日價量模式則顯示當日估算。細點是實際座標。雙指縮放、放大後可拖曳；回放使用歷史交易日資料，字的位置、圓圈大小與顏色會隨數據連續過渡；過渡位置不是盤中數據，金額維持所標示交易日的值。</div>` : ''}<div class="twx-chart-mode">${segments('mode', [['momentum', '資金動向'], ['day', '當日價量']], mode)}</div><small class="twx-chart-method">${caption}</small>${prefs.tab === 'rank' ? segments('sort', [['buy', '買超'], ['sell', '賣超'], ['up', '漲幅'], ['down', '跌幅']], prefs.sort) : ''}<div class="twx-chart-content">${results()}</div>${prefs.replayIndex !== null ? replayControls() : ''}${prefs.tab === 'bubble' ? chartActions() : ''}<button type="button" class="twx-expand" data-expand aria-label="展開圖表">⛶</button></section><div class="twx-tools">${segments('tab', [['bubble', '泡泡圖'], ['rank', '排行']], prefs.tab)}</div></div><div class="twx-sector-list">${all.map(s => `<button type="button" data-sector="${escape(s.name)}"><span>${escape(s.name)}</span><b class="${direction(mode === 'momentum' ? s.flow5 : s.flow)}">${mode === 'momentum' && !Number.isFinite(s.momentum) ? '歷史不足' : money(mode === 'momentum' ? s.flow5 : s.flow)}</b></button>`).join('') || '<div class="twx-empty">尚無對應產業，請先在台股雷達收藏股票。</div>'}</div>`;
}
function paint(s) {
  if (session !== s) return;
  if(s.view==='home')updateHomeHighlights(home,homeSession,data);
  const resume = !!s.player?.playing;
  s.rebuilding = true; s.player?.destroy(); s.player = null; s.rebuilding = false;
  if (prefs.replayIndex !== null && s.view !== 'home') { s.replayFrames = buildReplayFrames(); prefs.replayIndex = Math.min(prefs.replayIndex, Math.max(0, s.replayFrames.length - 1)); }
  const expanded = !!s.root.querySelector('.twx-chart-panel.expanded');
  const content = s.view === 'home' ? homeContent(s.state) : indicatorContent();
  s.root.innerHTML = `<div class="twx" data-twx-view="${s.view}">${error && !data ? '<div class="twx-empty" role="status">資料暫時無法載入，請重新整理頁面。</div>' : ''}${content}</div>`;
  if (expanded) s.root.querySelector('.twx-chart-panel')?.classList.add('expanded');
  s.root.querySelectorAll('[data-mixed]').forEach(input => { input.indeterminate = true; });
  if (s.view !== 'home') mountReplay(s, resume);
}
async function refresh(s, force) {
  if (loading) return;
  loading = true; error = null; paint(s);
  const loadingTask=window.OXLoading?.begin('tw','台股產業資料載入中',{views:['strength'],signal:s.controller.signal,target:()=>s.root.querySelector('.twx-chart-content')});
  const result = await loadResearch({ force, onCached(snapshot) { data = snapshot; if (current(s) && prefs.replayIndex === null) paint(s); } });
  loadingTask?.finish();
  loading = false; lastFetch = Date.now(); data = result.data; error = result.error;
  if (session && current(session) && prefs.replayIndex === null) paint(session);
}
export async function preloadResearch({force=false}={}) {
  const result = await loadResearch({ force, onCached(snapshot) { data = snapshot; if (session && current(session) && prefs.replayIndex === null) paint(session); } });
  data = result.data; error = result.error; lastFetch = Date.now();
  if (session && current(session) && prefs.replayIndex === null) paint(session);
  return result;
}
export async function refreshTWResearch() {
  return Promise.allSettled([refreshHome(session,true),preloadResearch({force:true})]);
}
export function renderResearch(view, state, { host } = {}) {
  const outer = mountResearch(view); if (!outer) return null;
  const root = host || outer;
  data = savedResearch() || data;
  if (session?.view === view && session.root === root && root.querySelector(`[data-twx-view="${view}"]`)) { session.state = state; if (!document.querySelector('.twx-dialog') && document.activeElement?.tagName !== 'INPUT' && prefs.replayIndex === null) paint(session); if(view==='home'&&Date.now()-homeFetched>300000)refreshHome(session); return root; }
  stopResearch();
  const s = { view, root, state, controller: new AbortController() }; session = s; paint(s); if(view==='home'&&Date.now()-homeFetched>300000)refreshHome(s);
  root.addEventListener('click', event => {
    if (Date.now() < (s.suppressClickUntil || 0) && event.target.closest('.twx-bubble')) return;
    const button = event.target.closest('button, [data-sector]'); if (!button) return;
    if(button.hasAttribute('data-home-session')){homeSession=homeSession==='after'?'before':'after';paint(s);return;}
    if(button.hasAttribute('data-home-highlights')){showHomeHighlights(home,homeSession,data);return;}
    if(button.hasAttribute('data-home-refresh')){refreshHome(s,true);return;}
    if (button.dataset.watch) { event.stopPropagation(); watchClick(button); return; }
    if (button.dataset.stock) { showStock(data?.stocks.find(stock => stock.symbol === button.dataset.stock)); return; }
    if (button.dataset.sector) { const sector = chartSectors().find(x => x.name === button.dataset.sector) || selectSectors(data).find(x => x.name === button.dataset.sector); if (sector) { pauseReplay(s); showSector({ ...sector, rows: prefs.replayIndex === null ? sector.rows : [], date: prefs.replayIndex === null ? null : historyDays()[Math.floor(prefs.replayIndex)]?.date }); } return; }
    if (button.dataset.go) { if(button.dataset.go==='strength') document.dispatchEvent(new CustomEvent('ox:tw-tool',{detail:{tool:'rotation'}})); document.querySelector(`.dock-btn[data-view-target="${button.dataset.go}"]`)?.click(); return; }
if (button.hasAttribute('data-help')) { prefs.help = !prefs.help; paint(s); return; }
    if (button.hasAttribute('data-sector-picker')) { prefs.pickerOpen = !prefs.pickerOpen; root.querySelector('.twx-sector-picker').hidden = !prefs.pickerOpen; button.setAttribute('aria-expanded', prefs.pickerOpen); return; }
    if (button.hasAttribute('data-sector-all') || button.hasAttribute('data-sector-clear')) { prefs.selectedSectors = button.hasAttribute('data-sector-all') ? SECTOR_DEFINITIONS.map(sector => sector.name) : []; prefs.quadrant = null; resetChart(); paint(s); return; }
    if (button.hasAttribute('data-replay')) {
      if (prefs.replayIndex !== null) { pauseReplay(s); prefs.replayIndex = null; s.replayData = null; s.replayMode = null; paint(s); }
      else { prefs.market = 'ALL'; prefs.scope = 'all'; prefs.tab = 'bubble'; prefs.quadrant = null; resetChart(); playReplay(s); }
      return;
    }
    if (button.hasAttribute('data-replay-play')) { if (prefs.tab !== 'bubble') { prefs.tab = 'bubble'; paint(s); } if (s.player?.playing) pauseReplay(s); else playReplay(s); return; }
    if (button.hasAttribute('data-replay-step')) { const position = s.player?.position || 0; s.player?.seek(Number(button.dataset.replayStep) < 0 ? Math.ceil(position) - 1 : Math.floor(position) + 1); return; }
    if (button.hasAttribute('data-replay-speed')) { const speeds = [.5, 1, 2]; prefs.replaySpeed = speeds[(speeds.indexOf(prefs.replaySpeed) + 1) % speeds.length]; s.player?.setSpeed(prefs.replaySpeed); button.textContent = `${prefs.replaySpeed}x`; return; }
    if (button.hasAttribute('data-expand')) { root.querySelector('.twx-chart-panel').classList.toggle('expanded'); button.setAttribute('aria-label', root.querySelector('.expanded') ? '收合圖表' : '展開圖表'); return; }
    if (button.dataset.zoom) {
      if (button.dataset.zoom === 'reset') resetChart();
      else { prefs.zoom = Math.max(minChartZoom(), Math.min(8, prefs.zoom + (button.dataset.zoom === 'in' ? .5 : -.5))); if (prefs.zoom === minChartZoom()) resetChart(); }
      const expanded = !!root.querySelector('.twx-chart-panel.expanded'); paint(s);
      if (expanded) root.querySelector('.twx-chart-panel')?.classList.add('expanded'); return;
    }
    if (button.dataset.quadrant !== undefined) { const q = Number(button.dataset.quadrant); prefs.quadrant = prefs.quadrant === q ? null : q; resetChart(); paint(s); return; }
    for (const key of ['tab', 'scope', 'mode', 'sort', 'density']) if (button.dataset[key]) {
      if (key === 'tab' && button.dataset.tab === 'rank') pauseReplay(s);
      if (key === 'mode' && prefs.replayIndex !== null) { pauseReplay(s); prefs.replayIndex = null; s.replayData = null; s.replayMode = null; }
      prefs[key] = button.dataset[key]; prefs.quadrant = null; resetChart();
      const group = button.closest('.twx-segments'); const buttons = [...group.querySelectorAll('button')]; group.style.setProperty('--active', buttons.indexOf(button));
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      setTimeout(() => { if (current(s)) paint(s); }, 175); return;
    }
  }, { signal: s.controller.signal });
  root.addEventListener('input', event => { if (event.target.matches('[data-sector-search]')) { prefs.pickerQuery = event.target.value; root.querySelector('.twx-sector-picker-list').innerHTML = sectorPickerList(prefs); root.querySelectorAll('[data-mixed]').forEach(input => { input.indeterminate = true; }); return; } if (event.target.matches('[data-replay-seek]')) { s.player?.seek(Number(event.target.value)); return; } if (event.target.matches('input[type="search"]')) { prefs.query = event.target.value; resetChart(); const cursor = event.target.selectionStart; paint(s); const input = root.querySelector('input[type=search]'); input.focus({ preventScroll: true }); input.setSelectionRange(cursor, cursor); } }, { signal: s.controller.signal });
  root.addEventListener('change', event => { if (event.target.matches('[data-market]')) { prefs.market = event.target.value; prefs.mode = 'auto'; prefs.quadrant = null; resetChart(); paint(s); } }, { signal: s.controller.signal });
  root.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('[data-sector-choice], [data-sector-group]')) return;
    const selected = new Set(prefs.selectedSectors);
    const names = input.dataset.sectorChoice ? [input.dataset.sectorChoice] : SECTOR_DEFINITIONS.filter(sector => sector.group === input.dataset.sectorGroup).map(sector => sector.name);
    for (const name of names) if (input.checked) selected.add(name); else selected.delete(name);
    prefs.selectedSectors = [...selected]; prefs.quadrant = null; resetChart(); paint(s);
    root.querySelectorAll('[data-sector-choice], [data-sector-group]').forEach(el => { if (el.dataset.sectorChoice === input.dataset.sectorChoice && el.dataset.sectorGroup === input.dataset.sectorGroup) el.focus({ preventScroll: true }); });
  }, { signal: s.controller.signal });
  root.addEventListener('toggle', event => { if (!event.target.matches('[data-sector-disclosure]')) return; const groups = new Set(prefs.openGroups); if (event.target.open) groups.add(event.target.dataset.sectorDisclosure); else groups.delete(event.target.dataset.sectorDisclosure); prefs.openGroups = [...groups]; }, { signal: s.controller.signal, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseReplay(s); }, { signal: s.controller.signal });
  root.addEventListener('keydown', event => { if (event.target.matches('[data-sector]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } }, { signal: s.controller.signal });
  let drag = null, pinch = null, frame = 0;
  const touches = new Map();
  const draw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0; if (!current(s)) return;
      pauseReplay(s); paint(s);
      const label = root.querySelector('[data-zoom="reset"]'); if (label) label.textContent = `${Math.round(prefs.zoom * 100)}%`;
      const minus = root.querySelector('[data-zoom="out"]'); if (minus) minus.disabled = prefs.zoom <= minChartZoom();
      const plus = root.querySelector('[data-zoom="in"]'); if (plus) plus.disabled = prefs.zoom >= 8;
    });
  };
  const beginPinch = () => {
    const [a, b] = [...touches.values()];
    const chart = root.querySelector('.twx-bubbles'); if (!a || !b || !chart) return;
    const rect = chart.getBoundingClientRect();
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const point = { x: (center.x - rect.left) * 480 / rect.width, y: (center.y - rect.top) * 494 / rect.height };
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: prefs.zoom,
      x: (point.x - 240 - prefs.panX) / prefs.zoom, y: (point.y - 244 - prefs.panY) / prefs.zoom };
    drag = null;
    for (const id of touches.keys()) if (!root.hasPointerCapture(id)) root.setPointerCapture(id);
  };
  root.addEventListener('pointerdown', event => {
    const chart = event.target.closest('.twx-bubbles'); if (!chart || (event.pointerType !== 'touch' && event.button !== 0)) return;
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) { beginPinch(); return; }
    }
    if (prefs.zoom <= 1) return;
    const rect = chart.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: prefs.panX, panY: prefs.panY, scale: 480 / rect.width, moved: false };
  }, { signal: s.controller.signal });
  root.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const chart = root.querySelector('.twx-bubbles'); if (!chart) return;
      const rect = chart.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const x = ((a.x + b.x) / 2 - rect.left) * 480 / rect.width;
      const y = ((a.y + b.y) / 2 - rect.top) * 494 / rect.height;
      prefs.zoom = Math.max(minChartZoom(), Math.min(8, pinch.zoom * distance / pinch.distance));
      const bound = prefs.zoom * 170;
      prefs.panX = Math.max(-bound, Math.min(bound, x - 240 - pinch.x * prefs.zoom));
      prefs.panY = Math.max(-bound, Math.min(bound, y - 244 - pinch.y * prefs.zoom));
      event.preventDefault(); draw(); return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !drag.moved) return;
    drag.moved = true; event.preventDefault();
    if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId);
    const bound = prefs.zoom * 170;
    prefs.panX = Math.max(-bound, Math.min(bound, drag.panX + dx * drag.scale));
    prefs.panY = Math.max(-bound, Math.min(bound, drag.panY + dy * drag.scale));
    draw();
  }, { signal: s.controller.signal });
  const finishDrag = event => {
    if (touches.has(event.pointerId)) touches.delete(event.pointerId);
    if (pinch) { s.suppressClickUntil = Date.now() + 400; if (touches.size < 2) { pinch = null; drag = null; } }
    if (drag?.id === event.pointerId) { if (drag.moved) s.suppressClickUntil = Date.now() + 350; drag = null; }
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  root.addEventListener('pointerup', finishDrag, { signal: s.controller.signal });
  root.addEventListener('pointercancel', finishDrag, { signal: s.controller.signal });
  s.controller.signal.addEventListener('abort', () => { if (frame) cancelAnimationFrame(frame); s.player?.destroy(); }, { once: true });
  if (Date.now() - lastFetch > 300000) refresh(s, false);
  return root;
}
