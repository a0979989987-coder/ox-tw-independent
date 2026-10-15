import '../components/radar/timeframe-filters.js';
import {twModule} from '../markets/tw/index.js';
import {stopTWStrength} from '../markets/tw/strength.js';
import {stopTWRadar} from '../markets/tw/radar.js';
import {stopResearch,refreshTWResearch} from '../markets/tw/research-page.js';
import {preloadBundle} from '../markets/tw/patterns/bundle.js';
import {initShell} from './shell.js';
import {initStockShortcut} from './stock-shortcut.js';
import {LIVE_PREFERENCE_KEY,readLivePreference} from './live-preference.js';
import '../components/news/center.js';
import {withDeadline} from '../components/resource-deadline.js';
import {startVersionCheck} from './version-check.js';
import {ensureLightSheets,lightSheetsReady,ensureMidnightSheet,midnightSheetReady} from './theme-sheets.js';

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
    if(!matchMedia('(prefers-reduced-motion:reduce)').matches)host?.animate([{opacity:.6},{opacity:1}],{duration:160,easing:'ease-out'});
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
// Modes the control offers; 'system' (自動) follows the OS: dark → dark, light → platinum.
const THEMES=['dark','light','midnight','system'];
const THEME_COLORS={dark:'#080b0f',light:'#f4f4f5',midnight:'#0A0E16'};
const systemTheme=matchMedia('(prefers-color-scheme:light)');
const paletteOf=mode=>mode==='system'?(systemTheme.matches?'light':'dark'):mode;
let theme;try{theme=localStorage.getItem('ox-tw-independent-theme')||'dark';}catch{theme='dark';}
if(!THEMES.includes(theme))theme='dark';
let themeRequest=0,appliedPalette=null;
const markThemeButtons=()=>document.querySelectorAll('[data-control-theme]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.controlTheme===theme));b.classList.toggle('active',b.dataset.controlTheme===theme);});
function applyTheme(){
  const palette=paletteOf(theme),light=palette==='light',midnight=palette==='midnight',resolved=light?'light':'dark',body=document.body,root=document.documentElement;
  appliedPalette=palette;
  body.classList.toggle('theme-light',light);body.classList.toggle('theme-midnight',midnight);
  if(midnight)root.dataset.oxPalette='midnight';else delete root.dataset.oxPalette;
  document.getElementById('ox-midnight-before-paint')?.remove();
  body.dataset.theme=resolved;root.style.colorScheme=resolved;body.dataset.themeMode=theme;
  let meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta);}meta.content=THEME_COLORS[palette];
  markThemeButtons();
  document.dispatchEvent(new CustomEvent('ox:themechange',{detail:{theme:resolved,mode:theme,resolved,palette}}));
}
function setTheme(choice){
  theme=THEMES.includes(choice)?choice:'dark';
  try{localStorage.setItem('ox-tw-independent-theme',theme);}catch{}
  const palette=paletteOf(theme);
  // Theme-only rules are downloaded when first needed; switch once they are in place.
  const pending=palette==='light'&&!lightSheetsReady()?ensureLightSheets():palette==='midnight'&&!midnightSheetReady()?ensureMidnightSheet():null;
  const request=++themeRequest;
  if(pending){markThemeButtons();pending.then(()=>{if(request===themeRequest)setTheme(theme);});return;}
  // A cross-fade of about 240ms when the palette changes; instant on first
  // paint, when only the mode changes (e.g. dark → automatic while the OS is
  // dark) and for reduced motion. Without view transitions, colours fade.
  if(appliedPalette===null||appliedPalette===palette||matchMedia('(prefers-reduced-motion:reduce)').matches){applyTheme();return;}
  if(document.startViewTransition&&!document.hidden){document.documentElement.classList.add('ox-theme-transition');const t=document.startViewTransition(applyTheme);t.finished.finally(()=>document.documentElement.classList.remove('ox-theme-transition'));return;}
  const root=document.documentElement;root.classList.add('ox-theme-fading');applyTheme();clearTimeout(setTheme.timer);setTheme.timer=setTimeout(()=>root.classList.remove('ox-theme-fading'),300);
}
shell=initShell({navigate(view){if(view==='data')window.OXNews?.openMarket({market:'tw'});else window.switchAppView(view);},setTheme,async refresh(){
  await Promise.all([twModule.reload(),refreshTWResearch(),preloadBundle({force:true,silent:true}),window.OXNews?.refresh?.(true),updateHeadline()]);
  document.dispatchEvent(new Event('ox:tw-close-refresh'));
}});
// Automatic re-resolves when the OS appearance changes.
systemTheme.addEventListener('change',()=>{if(theme==='system')setTheme('system');});setTheme(theme);
const liveChoice=document.getElementById('tw-live-choice');
liveChoice.checked=readLivePreference();
function updateLive(persist=false){
  document.getElementById('tw-live-before-paint')?.remove();
  document.querySelector('.ox-live-shell').hidden=!liveChoice.checked;
  if(persist)try{localStorage.setItem(LIVE_PREFERENCE_KEY,liveChoice.checked?'1':'0');}catch{}
  if(persist&&liveChoice.checked)updateHeadline();
}
liveChoice.addEventListener('change',()=>updateLive(true));updateLive();
async function updateHeadline(){
  if(!liveChoice.checked)return;
  try{const d=await withDeadline(async signal=>{const r=await fetch(new URL('../../data/news-headline.json',import.meta.url),{signal});if(!r.ok)throw Error('Headline unavailable');return r.json();},8000);
    document.getElementById('ox-live-text').textContent=d.title||'台灣市場 · 官方日行情';
  }catch{document.getElementById('ox-live-text').textContent='台灣市場 · 官方日行情';}
}
updateHeadline();setInterval(()=>{if(!document.hidden)updateHeadline();},300000);
twModule.activate({view:'radar'}).catch(()=>document.dispatchEvent(new Event('ox:tw-retry')));
window.OXTW={navigate:window.switchAppView,openStock(symbol){
  if(!/^\d{4,6}[A-Z]?$/.test(symbol))throw Error('股票代號無效');
  document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol',{detail:{symbol}}));
  window.switchAppView('radar');return {market:'tw',symbol,view:'radar'};
}};
initStockShortcut(symbol=>window.OXTW.openStock(symbol));
globalThis.OXAppReady=true;
startVersionCheck();
document.dispatchEvent(new Event('ox:appready'));
if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:'open_taiwan_stock_chart',title:'開啟台股圖表',description:'以股票代號開啟台股雷達 K 線，與介面股票搜尋共用同一入口。',inputSchema:{type:'object',properties:{symbol:{type:'string',pattern:'^\\d{4,6}[A-Z]?$'}},required:['symbol'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input.symbol!=='string'||Object.keys(input).some(k=>k!=='symbol'))throw Error('股票代號無效');return window.OXTW.openStock(input.symbol);}});
}
