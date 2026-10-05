import {readFile} from 'node:fs/promises';
import {taipeiClock,tradingDates,collect} from './home-close.js';
import {collectBriefing} from './home-markets.js';
import {collectNight} from './home-night.js';
import {collectInstitutionSummary} from './institution-summary.js';
import {acceptHomeSection} from '../../../src/markets/tw/home-model.js';
const cache=new Map(),pending=new Map();let seed;
export async function readHomeSeed(){
 if(seed)return seed;
 try{seed=JSON.parse(await readFile(new URL('../../../data/tw-home.json',import.meta.url),'utf8'));}catch{seed={};}
 for(const section of ['core','briefing','night'])try{seed[section]=acceptHomeSection(section,seed[section]);}catch{seed[section]=null;}
 return seed;
}
export async function collectCore(previous,now=new Date(),dependencies={tradingDates,collect,collectInstitutionSummary}){
 const clock=taipeiClock(now),dates=await dependencies.tradingDates(clock.date);
 const complete=dates.filter(date=>date<clock.date||clock.minutes>=810&&date===clock.date);
 const date=complete.at(-1),previousDate=complete.filter(day=>day<date).at(-1);
 if(!date||!previousDate)throw Error('完整收盤交易日尚未公布');
 const [report,institutional]=await Promise.all([dependencies.collect(date,previousDate),dependencies.collectInstitutionSummary?.(date,previous?.institutional)]);
 if(institutional)report.institutional=institutional;
 return acceptHomeSection('core',report);
}
export async function refreshHomeSection(section,previous,now=new Date(),collectors={core:collectCore,briefing:collectBriefing,night:collectNight}){
 const checkedAt=now.toISOString(),clock=taipeiClock(now);let data=previous,error=null;
 try{
  const fresh=acceptHomeSection(section,await collectors[section](previous,now));
  // The morning briefing is independent of the Taiwan cash close gate.
  // Manual and scheduled acquisitions publish newly verified rows immediately.
  data=fresh;
  if(section==='night'&&fresh?.status!=='ok')error=fresh?.error||'夜盤尚未公布';
  if(section==='briefing'&&!fresh?.complete)error='部分來源更新失敗，已保留並標示上次有效報價';
 }catch(e){error=e.message;}
 const pendingClose=section==='core'&&data?.date!==clock.date&&!clock.weekend;
 const message=pendingClose?'今日收盤尚未公布，顯示最近完整交易日':section==='core'&&clock.weekend?'今日休市，顯示最近完整交易日':'';
 return {section,data,checkedAt,reportDate:clock.date,status:error?(data?'stale':'unavailable'):data?'ok':'unavailable',error,message,publication:pendingClose?'pending':'published',refreshed:true};
}
export async function getHomeSection(section,{refresh=false,now=new Date(),collectors}={}){
 if(!['core','briefing','night'].includes(section))throw Error('無效的首頁資料區域');
 const previous=cache.get(section),clock=taipeiClock(now);
 if(!refresh&&previous&&previous.result.reportDate===clock.date&&now.getTime()-previous.time<300000)return {...previous.result,refreshed:false};
 if(pending.has(section))return pending.get(section);
 const promise=(async()=>{
  const initial=await readHomeSeed(),old=previous?.result.data||initial[section]||null;
  const result=await refreshHomeSection(section,old,now,collectors);
  cache.set(section,{time:now.getTime(),result});return result;
 })().finally(()=>pending.delete(section));pending.set(section,promise);return promise;
}
