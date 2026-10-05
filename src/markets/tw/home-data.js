import {getTWApiBase} from './api.js?v=20261005-recovery20';
import {acceptHomeSection} from './home-model.js?v=20261005-adr';
const KEY='ox-tw-home-v1',sections=['core','briefing','night'];let value,job;
export function savedHome(){
 if(value)return value;
 try{const raw=JSON.parse(localStorage.getItem(KEY));value={};for(const section of sections){try{value[section]=acceptHomeSection(section,raw?.[section]);value[section+'Status']=raw?.[section+'Status'];}catch{value[section]=null;}}}catch{value={};}
 return value;
}
function accept(section,data){
 const fresh=acceptHomeSection(section,data);if(!fresh)return;
 const old=value[section],date=section==='core'?'date':section==='night'?'tradeDate':'date';
 const time=section==='core'?'savedAt':'collectedAt';
 if(!old||fresh[date]>old[date]||fresh[date]===old[date]&&Date.parse(fresh[time])>=Date.parse(old[time]))value[section]=fresh;
 if(section==='core'&&old?.date===fresh.date){
  const previous=old.institutional,next=fresh.institutional;
  const latest=!previous?next:!next?previous:Date.parse(next.collectedAt)>=Date.parse(previous.collectedAt)?next:previous;
  if(latest)value.core={...value.core,institutional:latest};
 }
}
export async function loadHome({force=false,onChange}={}){
 savedHome();if(job)return job;
 job=(async()=>{
  try{const response=await fetch(new URL('../../../data/tw-home.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(6000)});if(response.ok){const raw=await response.json();for(const section of sections)try{accept(section,raw[section]);}catch{}onChange?.(value);}}catch{}
  let completed=0;await Promise.all(sections.map(async section=>{
   try{
    const url=`${getTWApiBase()}/v1/tw/home?section=${section}${force?'&refresh=1&t='+Date.now():''}`;
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(115000)});if(!response.ok)throw Error('資料來源暫時無法更新');
    const raw=(await response.json()).data;if(raw?.section!==section||!Number.isFinite(Date.parse(raw.checkedAt)))throw Error('更新回應格式不完整');
    accept(section,raw.data);value[section+'Status']={...raw,data:undefined};
   }catch(error){value[section+'Status']={...value[section+'Status'],status:value[section]?'stale':'unavailable',error:error.message,checkedAt:new Date().toISOString(),refreshed:false};}
   try{localStorage.setItem(KEY,JSON.stringify(value));}catch{}onChange?.(value,{done:++completed,total:3});
  }));return value;
 })().finally(()=>job=null);return job;
}
