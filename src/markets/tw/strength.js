import { renderResearch, stopResearch } from './research-page.js?v=20261005-briefingdate';
import { mountResearch } from './research-ui.js';
import { createToolsRail } from '../../components/strength/tools-rail.js?v=20261005-stable18';
import { createTWMarketState } from './engine.js?v=20261005-recovery20';
import { loadToolModule } from '../../components/load-tool-module.js?v=20261005-recovery20';
import { showToolLoadError } from '../../components/tool-load-error.js?v=20261005-recovery20';
import { preloadToolStyles } from '../../components/style-ready.js?v=20261005-stable18';
let selected = 'patterns', session = null, modules;
export function preloadTWStrength() {
  // Small UI styles are shared by ETF and savings; warm them without waiting
  // for the pattern data engine or mounting an invisible tool.
  preloadToolStyles(new URL('./etf/style.css?v=20261005-spacing6',import.meta.url).href).catch(()=>{});
  return modules ??= Promise.all([
    '../../components/patterns/view.js','./patterns/source.js','./patterns/index-cache.js','./bubbles/view.js'
  ].map(path=>loadToolModule(new URL(path,import.meta.url).href))).catch(error => { modules = null; throw error; });
}
export function stopTWStrength() {
  if (!session) return;
  session.instance?.destroy(); session.rail.destroy(); session = null; stopResearch();
}
async function show(s) {
  if (session !== s) return;
  if(window.OXFeatures&&!window.OXFeatures.enterTool(selected,'data-tw-tool',()=>show(s)))return;
  s.instance?.destroy(); s.instance = null; stopResearch();
  // The drawing and bubble tools own a shadow root. A destroyed shadow root
  // cannot be detached; mounting light-DOM children into it would hide them.
  const freshHost=document.createElement('div');freshHost.id=s.host.id;
  s.host.replaceWith(freshHost);s.host=freshHost;
  const generation = ++s.generation;
  const load=path=>loadToolModule(new URL(path,import.meta.url).href,{current:()=>session===s&&generation===s.generation});
  s.host.hidden = selected === 'rotation'; s.research.hidden = selected !== 'rotation';
  if (selected === 'rotation') { renderResearch('strength', s.state, { host: s.research }); return; }
  if(['etf','savings'].includes(selected)){

    if(window.OXLoading)OXLoading.render(s.host,selected==='etf'?'載入 ETF 精選':'載入存股計算');
    else s.host.textContent='介面載入中…';
    try{
      const tool=selected;
      const module=await load(tool==='etf'?'./etf/view.js?v=20261005-stable18':'./etf/savings.js?v=20261005-stable18');
      if(session!==s||generation!==s.generation)return;
      s.host.replaceChildren();
      s.instance=selected==='etf'?module.mountETF(s.host,{onSavings(selection){s.savingsInitial=selection;s.rail.select('savings');}}):module.mountSavings(s.host,{initialSelection:s.savingsInitial});
      s.savingsInitial=null;
    }catch(error){if(session===s&&generation===s.generation)showToolLoadError(s.host,error,()=>show(s));}
    return;
  }
  if(window.OXLoading)OXLoading.render(s.host,selected==='bubbles'?'載入泡泡圖':'載入型態畫板');else s.host.textContent='介面載入中…';
  try {
    // A bubble view must not wait for the separate pattern engine to download.
    const loaded = selected==='bubbles' ? [null,null,null,await load('./bubbles/view.js?v=20261005-stable18')] :
      [...await Promise.all([load('../../components/patterns/view.js?v=20261005-stable18'),load('./patterns/source.js?v=20261005-load16'),load('./patterns/index-cache.js?v=20261002-rank8')]),{}];
    const [{ mountPatternSearch } = {}, source, cache,{mountTWBubbles}] = loaded.map(value=>value||{});
    if (session !== s || generation !== s.generation) return;
    s.host.textContent = '';
    const onOpenRadar=symbol=>{
      document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol',{detail:{symbol}}));
      // The mobile radar button owns a gesture recognizer and deliberately
      // suppresses synthetic clicks. Navigation must use the app API.
      window.switchAppView?.('radar');
    };
    s.instance=selected==='bubbles'?mountTWBubbles(s.host,{onOpenRadar}):mountPatternSearch(s.host,{source,cache,onOpenRadar});
  } catch (error) {
    if (session !== s || generation !== s.generation) return;
    showToolLoadError(s.host,error,()=>show(s));
  }
}
export function renderTWStrength(state) {
  const desired=globalThis.OXFeatures?.selectedTool?.('tw');if(desired&&desired!==selected){stopTWStrength();selected=desired;}
  const root = mountResearch('strength'); if (!root) return null;
  if (session?.root === root && root.querySelector('#ox-tw-tools-nav')) {
    session.state = state;
    if (selected === 'rotation') renderResearch('strength', state, { host: session.research });
    return root;
  }
  stopTWStrength(); stopResearch(); root.replaceChildren();
  const host = document.createElement('div'), research = document.createElement('div');
  host.id = 'ox-tw-patterns'; research.id = 'ox-tw-sector-tools';
  const rail = createToolsRail({ tabs: [['patterns', '畫板'], ['bubbles','泡泡圖'], ['rotation', '板塊輪動'],['etf','ETF 精選'],['savings','存股計算']], selected, label: '台股指標分類', attribute: 'data-tw-tool',equal:true,mobileCompact:true, onSelect(id) { selected = id; if (session) show(session); } });
  rail.element.id = 'ox-tw-tools-nav';
  const style = document.createElement('style');
  style.textContent = '#ox-tw-tools-nav{margin:0 0 12px}#ox-tw-patterns,#ox-tw-sector-tools{min-width:0}#ox-tw-sector-tools[hidden],#ox-tw-patterns[hidden]{display:none!important}';
  root.append(style, rail.element, host, research);
  const s = { root, host, research, rail, state, instance: null, generation: 0 }; session = s;
  rail.position(); show(s); return root;
}

if(typeof document !== 'undefined') {
 document.addEventListener('ox:tw-tool', event => { if(['patterns','bubbles','rotation','etf','savings'].includes(event.detail?.tool)){selected=event.detail.tool;stopTWStrength();} });
 document.addEventListener('ox:tw-close-refresh',()=>{if(session&&selected==='patterns')session.instance?.refresh?.();});
}
