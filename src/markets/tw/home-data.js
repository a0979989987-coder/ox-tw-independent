import {getTWApiBase} from './api.js?v=20261005-recovery20';
import {acceptHomeSection,withOfficialTaiwanClose} from './home-model.js?v=20261005-adr';
const KEY='ox-tw-independent:ox-tw-home-v1',sections=['core','briefing','night'];let value,job;
const publishedSnapshot='https://raw.githubusercontent.com/a0979989987-coder/ox-tw-independent/main/data/tw-home.json';
export function savedHome(){
 if(value)return value;
 try{const raw=JSON.parse(localStorage.getItem(KEY));value={};for(const section of sections){try{value[section]=acceptHomeSection(section,raw?.[section]);value[section+'Status']=raw?.[section+'Status'];}catch{value[section]=null;}}}catch{value={};}
 value.briefing=withOfficialTaiwanClose(value.briefing,value.core);return value;
}
function accept(section,data){
 const fresh=acceptHomeSection(section,data);if(!fresh)return false;
 const old=value[section],date=section==='core'?'date':section==='night'?'tradeDate':'date';
 const time=section==='core'?'savedAt':'collectedAt';
 if(!old||fresh[date]>old[date]||fresh[date]===old[date]&&Date.parse(fresh[time])>=Date.parse(old[time]))value[section]=fresh;
 if(section==='core'&&old?.date===fresh.date){
  const previous=old.institutional,next=fresh.institutional;
  const latest=!previous?next:!next?previous:Date.parse(next.collectedAt)>=Date.parse(previous.collectedAt)?next:previous;
  if(latest)value.core={...value.core,institutional:latest};
 }
 value.briefing=withOfficialTaiwanClose(value.briefing,value.core);
 return value[section]?.[date]===fresh[date]&&value[section]?.[time]===fresh[time];
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(value));}catch{}}
function acceptSnapshot(raw){
 const accepted=new Set();
 for(const section of sections)try{
  if(accept(section,raw?.[section])){
   const status=raw[section+'Status'];
   if(status&&Number.isFinite(Date.parse(status.checkedAt)))value[section+'Status']={...status,delivery:'snapshot'};
   accepted.add(section);
  }
 }catch{}
 persist();return accepted;
}
export async function loadHome({force=false,onChange}={}){
 savedHome();if(job)return job;
 job=(async()=>{
  // Scheduled collectors publish to GitHub before Pages finishes rebuilding.
  // Read both copies independently so a delayed deploy cannot freeze the home.
  const snapshotSections=new Set();
  const snapshots=Promise.all([new URL('../../../data/tw-home.json',import.meta.url),publishedSnapshot].map(async url=>{
   try{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!response.ok)return;
    for(const section of acceptSnapshot(await response.json()))snapshotSections.add(section);onChange?.(value);
   }catch{}
  }));
  let completed=0;await Promise.all([snapshots,...sections.map(async section=>{
   try{
    const url=`${getTWApiBase()}/v1/tw/home?section=${section}${force?'&refresh=1&t='+Date.now():''}`;
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(force?90000:25000)});if(!response.ok)throw Error('資料來源暫時無法更新');
    const raw=(await response.json()).data;if(raw?.section!==section||!Number.isFinite(Date.parse(raw.checkedAt)))throw Error('更新回應格式不完整');
    if(accept(section,raw.data)||!value[section])value[section+'Status']={...raw,data:undefined,delivery:'api'};
   }catch(error){
    await snapshots;
    // Transport failure must not relabel a successfully published source as
    // stale. Keep its real acquisition/check dates, never "updated just now".
    if(snapshotSections.has(section))value[section+'Status']={...value[section+'Status'],refreshError:error.message};
    else value[section+'Status']={...value[section+'Status'],status:value[section]?'stale':'unavailable',error:error.message,refreshed:false};
   }
   persist();onChange?.(value,{done:++completed,total:3});
  })]);return value;
 })().finally(()=>job=null);return job;
}
