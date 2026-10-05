import {twModule} from '../markets/tw/index.js';
import {stopTWStrength} from '../markets/tw/strength.js';
import {stopTWRadar} from '../markets/tw/radar.js';
import {stopResearch} from '../markets/tw/research-page.js';

const views=new Set(['home','strength','radar','data','news','media']);
const menu=document.getElementById('tw-menu');
let current='radar';
window.state={activeMarket:'tw',activeView:current};
window.switchAppView=function(view){
  if(!views.has(view))return false;
  const previous=current;current=view;
  menu.open&&menu.close();
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
const openMenu=()=>{if(!menu.open)menu.showModal();};
for(const id of ['ox-control-open','ox-dock-menu'])document.getElementById(id)?.addEventListener('click',openMenu);
document.querySelector('[data-menu-close]').addEventListener('click',()=>menu.close());
menu.addEventListener('click',e=>{if(e.target===menu)menu.close();});
const systemTheme=matchMedia('(prefers-color-scheme:light)');
let theme;try{theme=localStorage.getItem('ox-tw-independent-theme')||'dark';}catch{theme='dark';}
function setTheme(choice){
  theme=['dark','light','system'].includes(choice)?choice:'dark';
  document.body.classList.toggle('theme-light',theme==='light'||theme==='system'&&systemTheme.matches);
  document.body.dataset.theme=document.body.classList.contains('theme-light')?'light':'dark';
  document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));
  try{localStorage.setItem('ox-tw-independent-theme',theme);}catch{}
  document.dispatchEvent(new CustomEvent('ox:themechange',{detail:{theme:document.body.dataset.theme}}));
}
document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.theme)));
systemTheme.addEventListener('change',()=>setTheme(theme));setTheme(theme);
const liveChoice=document.getElementById('tw-live-choice');
try{liveChoice.checked=localStorage.getItem('ox-tw-independent-live')!=='0';}catch{}
function updateLive(){
  document.querySelector('.ox-live-shell').hidden=!liveChoice.checked;
  try{localStorage.setItem('ox-tw-independent-live',liveChoice.checked?'1':'0');}catch{}
}
liveChoice.addEventListener('change',updateLive);updateLive();
async function updateHeadline(){
  try{const r=await fetch('/data/news.json',{signal:AbortSignal.timeout(8000)});const d=await r.json();
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
