import {twModule} from '../markets/tw/index.js';
import {stopTWStrength} from '../markets/tw/strength.js';
import {stopTWRadar} from '../markets/tw/radar.js';
import {stopResearch,refreshTWResearch} from '../markets/tw/research-page.js';
import {preloadBundle} from '../markets/tw/patterns/bundle.js';
import {initShell} from './shell.js';
import {LIVE_PREFERENCE_KEY,readLivePreference} from './live-preference.js';

const views=new Set(['home','strength','radar','data','news','media']);
let shell;
let current='radar';
window.state={activeMarket:'tw',activeView:current};
window.switchAppView=function(view){
  if(!views.has(view))return false;
  const previous=current;current=view;
  shell?.close({restoreFocus:false});
  document.body.dataset.view=view;window.state.activeView=view;
  document.querySelectorAll('[data-view-target]').forEach(b=>{
    b.classList.toggle('active',b.dataset.viewTarget===view);
    b.setAttribute('aria-current',b.dataset.viewTarget===view?'page':'false');
  });
  document.querySelectorAll('.app-view').forEach(section=>{
    section.classList.toggle('active',section.dataset.appView===view);
    section.hidden=section.dataset.appView!==view||['home','strength','radar'].includes(view);
  });
  const market=['home','strength','radar'].includes(view);
  document.getElementById('market-unavailable-card').hidden=!market;
  if(market)twModule.view(view);
  else {stopTWStrength();stopTWRadar();stopResearch();}
  if(previous!==view){
    window.scrollTo({top:0,behavior:'instant'});
    const host=market?document.getElementById('market-unavailable-card'):document.getElementById('view-'+view);
    if(!matchMedia('(prefers-reduced-motion:reduce)').matches)host?.animate([{opacity:.75},{opacity:1}],{duration:220,easing:'ease-out'});
  }
  document.dispatchEvent(new CustomEvent('ox:viewchange',{detail:{from:previous,to:view,view}}));
  return true;
};
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-view-target]');
  if(button){
    if(button.dataset.viewTarget==='data')window.OXNews?.openMarket({market:'tw'});
    else window.switchAppView(button.dataset.viewTarget);
  }
});
const systemTheme=matchMedia('(prefers-color-scheme:light)');
let theme;try{theme=localStorage.getItem('ox-tw-independent-theme')||'dark';}catch{theme='dark';}
function setTheme(choice){
  theme=['dark','light','system'].includes(choice)?choice:'dark';
  document.body.classList.toggle('theme-light',theme==='light'||theme==='system'&&systemTheme.matches);
  document.body.dataset.theme=document.body.classList.contains('theme-light')?'light':'dark';
  const resolved=document.body.dataset.theme;
  document.documentElement.style.colorScheme=resolved;document.body.dataset.themeMode=theme;
  let meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta);}meta.content=resolved==='light'?'#f4f4f5':'#080b0f';
  document.querySelectorAll('[data-control-theme]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.controlTheme===theme));b.classList.toggle('active',b.dataset.controlTheme===theme);});
  try{localStorage.setItem('ox-tw-independent-theme',theme);}catch{}
  document.dispatchEvent(new CustomEvent('ox:themechange',{detail:{theme:resolved,mode:theme,resolved}}));
}
shell=initShell({navigate(view){if(view==='data')window.OXNews?.openMarket({market:'tw'});else window.switchAppView(view);},setTheme,async refresh(){
  await Promise.all([twModule.reload(),refreshTWResearch(),preloadBundle({force:true,silent:true}),window.OXNews?.refresh?.(true),updateHeadline()]);
  document.dispatchEvent(new Event('ox:tw-close-refresh'));
}});
systemTheme.addEventListener('change',()=>setTheme(theme));setTheme(theme);
const liveChoice=document.getElementById('tw-live-choice');
liveChoice.checked=readLivePreference();
function updateLive(persist=false){
  document.getElementById('tw-live-before-paint')?.remove();
  document.querySelector('.ox-live-shell').hidden=!liveChoice.checked;
  if(persist)try{localStorage.setItem(LIVE_PREFERENCE_KEY,liveChoice.checked?'1':'0');}catch{}
}
liveChoice.addEventListener('change',()=>updateLive(true));updateLive();
async function updateHeadline(){
  try{const r=await fetch(new URL('../../data/news.json',import.meta.url),{signal:AbortSignal.timeout(8000)});const d=await r.json();
    const item=d.news.find(n=>n.markets?.includes('tw'));document.getElementById('ox-live-text').textContent=item?.titleZh||item?.title||'台灣市場 · 官方日行情';
  }catch{document.getElementById('ox-live-text').textContent='台灣市場 · 官方日行情';}
}
updateHeadline();setInterval(()=>{if(!document.hidden)updateHeadline();},300000);
twModule.activate({view:'radar'}).catch(()=>document.dispatchEvent(new Event('ox:tw-retry')));
window.OXTW={navigate:window.switchAppView,openStock(symbol){
  if(!/^\d{4,6}[A-Z]?$/.test(symbol))throw Error('股票代號無效');
  document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol',{detail:{symbol}}));
  window.switchAppView('radar');return {market:'tw',symbol,view:'radar'};
}};
if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:'open_taiwan_stock_chart',title:'開啟台股圖表',description:'以股票代號開啟台股雷達 K 線，與介面股票搜尋共用同一入口。',inputSchema:{type:'object',properties:{symbol:{type:'string',pattern:'^\\d{4,6}[A-Z]?$'}},required:['symbol'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input.symbol!=='string'||Object.keys(input).some(k=>k!=='symbol'))throw Error('股票代號無效');return window.OXTW.openStock(input.symbol);}});
}
