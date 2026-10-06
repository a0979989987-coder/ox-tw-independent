// Shared OX shell behavior, scoped to the independent Taiwan workspace.
export function initShell({navigate,refresh,setTheme}){
 const overlay=document.getElementById('ox-control-overlay'),panel=document.getElementById('ox-control-panel');
 const dock=document.querySelector('.app-dock'),openers=['ox-control-open','ox-dock-menu'].map(id=>document.getElementById(id));
 let opener,focusTimer;
 const setView=name=>panel.querySelectorAll('[data-control-view]').forEach(el=>el.classList.toggle('active',el.dataset.controlView===name));
 function close({restoreFocus=true}={}){
  clearTimeout(focusTimer);overlay.classList.remove('is-open');overlay.setAttribute('aria-hidden','true');overlay.inert=true;
  document.body.classList.remove('ox-control-open');openers.forEach(el=>el?.setAttribute('aria-expanded','false'));
  document.querySelectorAll('main,.app-dock,.ox-shell-header').forEach(el=>el.inert=false);
  if(restoreFocus&&opener?.isConnected)opener.focus({preventScroll:true});
 }
 function open(event){
  opener=event?.currentTarget||openers.find(el=>el?.getClientRects().length);setView('main');overlay.inert=false;
  overlay.classList.add('is-open');overlay.setAttribute('aria-hidden','false');document.body.classList.add('ox-control-open');
  openers.forEach(el=>el?.setAttribute('aria-expanded','true'));dock?.classList.remove('ox-dock-compact');
  document.querySelectorAll('main,.app-dock,.ox-shell-header').forEach(el=>el.inert=true);
  window.OXControlResources?.ensure(overlay,close);focusTimer=setTimeout(()=>document.getElementById('ox-control-close').focus(),310);
 }
 openers.forEach(el=>el?.addEventListener('click',open));document.getElementById('ox-control-close').onclick=()=>close();
 overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
 document.addEventListener('keydown',event=>{
  if(!overlay.classList.contains('is-open'))return;
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){
   const list=[...overlay.querySelectorAll('button,input,a[href],select,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);
   const first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 });
 document.getElementById('ox-control-advanced-open').onclick=()=>{setView('advanced');document.getElementById('ox-control-advanced-back').focus();};
 document.getElementById('ox-control-advanced-back').onclick=()=>{setView('main');document.getElementById('ox-control-advanced-open').focus();};
 document.getElementById('ox-control-media').onclick=()=>navigate('media');
 panel.querySelectorAll('[data-control-theme]').forEach(el=>el.onclick=()=>setTheme(el.dataset.controlTheme));
 document.getElementById('ox-control-about-toggle').onclick=event=>{
  const expanded=event.currentTarget.getAttribute('aria-expanded')!=='true';event.currentTarget.setAttribute('aria-expanded',String(expanded));
  document.getElementById('ox-control-changelog').classList.toggle('open',expanded);
 };
 document.getElementById('ox-control-refresh').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;button.textContent='更新中…';
  try{await refresh();button.textContent='已重新檢查';}catch{button.textContent='連線失敗，重試';}finally{button.disabled=false;}
 };
 const features=[
  ['home','盤前／盤後總覽','首頁 指數 台指夜盤','home'],
  ['patterns','型態畫板','指標 搜尋 patterns','strength','[data-tw-tool="patterns"]'],
  ['bubbles','泡泡圖','量能 bubbles','strength','[data-tw-tool="bubbles"]'],
  ['rotation','板塊輪動','產業 法人','strength','[data-tw-tool="rotation"]'],
  ['etf','ETF 精選','基金 配息','strength','[data-tw-tool="etf"]'],
  ['savings','存股計算','退休 投資 計算','strength','[data-tw-tool="savings"]'],
  ['radar','圖表雷達','K 線 股票','radar','[data-twr-mode="chart"]'],
  ['screener','台股篩選器','策略 選股 條件','radar','[data-twr-mode="screener"]'],
  ['risk','風險股／注意股','風險 處置','radar','[data-twr-mode="risk"]'],
  ['disposal','處置中','處置 股票','radar','[data-twr-mode="disposal"]'],
  ['release','即將出關','出關 處置','radar','[data-twr-mode="release"]'],
  ['watch','自選清單','收藏 觀察 watchlist','radar','[data-twr-mode="watchlist"]'],
  ['news','新聞與行事曆','資訊 財經 事件 news calendar','data'],
  ['theme','主題外觀','深色 白金 自動 theme','theme']
 ];
 const search=document.createElement('div');search.id='ox-feature-search-v38';search.className='ox-feature-search-wrap';
 search.innerHTML='<div class="ox-feature-search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg><input id="ox-feature-search-input-v38" type="search" autocomplete="off" placeholder="搜尋功能或工具…" aria-label="搜尋 OX 功能或工具" aria-controls="ox-feature-results-v38" aria-expanded="false"></div><div class="ox-feature-results" id="ox-feature-results-v38"></div>';
 panel.querySelector('[data-control-view="main"]').prepend(search);
 const input=search.querySelector('input'),results=search.querySelector('.ox-feature-results');
 function renderSearch(){
  const term=input.value.trim().toLowerCase();const matches=features.filter(row=>term?row.join(' ').toLowerCase().includes(term):['patterns','bubbles','news','theme'].includes(row[0]));
  results.replaceChildren();for(const row of matches.slice(0,10)){
   const button=document.createElement('button');button.type='button';button.className='ox-feature-result';
   button.innerHTML='<span class="ox-feature-result-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4v16h16M7 14l4-5 4 3 5-7"/></svg></span><span class="ox-feature-result-copy"><b></b><small></small></span><span class="ox-feature-result-state">›</span>';
   button.querySelector('b').textContent=row[1];button.querySelector('small').textContent=row[2];
   button.onclick=async()=>{
    if(row[3]==='theme'){results.classList.remove('show');input.setAttribute('aria-expanded','false');panel.querySelector('[data-control-theme]').focus();return;}
    navigate(row[3]);if(!row[4])return;
    for(let i=0;i<40;i++){const target=document.querySelector(row[4]);if(target){target.click();return;}await new Promise(resolve=>setTimeout(resolve,50));}
   };results.append(button);
  }
  if(!matches.length)results.textContent='找不到符合的功能';results.classList.add('show');input.setAttribute('aria-expanded','true');
 }
 input.addEventListener('input',renderSearch);input.addEventListener('focus',renderSearch);
 search.addEventListener('keydown',event=>{
  const buttons=[...results.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
  if(event.key==='ArrowDown'){event.preventDefault();buttons[(index+1)%buttons.length]?.focus();}
  if(event.key==='ArrowUp'){event.preventDefault();index<=0?input.focus():buttons[index-1]?.focus();}
 });
 // Match the original directional scroll behavior. The pattern pill observes this class too.
 let lastY=Math.max(0,scrollY),pending=false,travel=0,lastToggle=0;
 window.addEventListener('scroll',()=>{
  if(pending)return;pending=true;requestAnimationFrame(()=>{
   const y=Math.max(0,scrollY),delta=y-lastY;
   if(y<35){dock.classList.remove('ox-dock-compact');travel=0;}
   else if(!document.body.classList.contains('ox-control-open')&&!document.body.classList.contains('ox-mqs-open')){
    if(Math.sign(delta)!==Math.sign(travel))travel=0;travel+=delta;
    if(Math.abs(travel)>=26&&performance.now()-lastToggle>260){dock.classList.toggle('ox-dock-compact',travel>0);lastToggle=performance.now();travel=0;}
   }lastY=y;pending=false;
  });
 },{passive:true});
 const indicator=document.createElement('span');indicator.className='ox-dock-indicator';indicator.setAttribute('aria-hidden','true');dock.prepend(indicator);
 function syncDock(){
  const active=dock.querySelector('.dock-btn.active');if(!active)return;
  const dr=dock.getBoundingClientRect(),br=active.getBoundingClientRect(),scale=dr.width/Math.max(1,dock.offsetWidth);
  const width=Math.max(38,Math.min(br.width/scale*.94,86)),x=(br.left-dr.left)/scale+(br.width/scale-width)/2;
  indicator.style.width=width.toFixed(1)+'px';indicator.style.transform=`translate3d(${x.toFixed(1)}px,0,0)`;indicator.style.opacity='1';
 }
 document.addEventListener('ox:viewchange',()=>{travel=0;dock.classList.remove('ox-dock-compact');requestAnimationFrame(syncDock);});
 window.addEventListener('resize',syncDock,{passive:true});new ResizeObserver(syncDock).observe(dock);requestAnimationFrame(syncDock);
 return {open,close};
}
