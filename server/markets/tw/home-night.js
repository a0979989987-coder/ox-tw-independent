// Adapted from update-night.py: only completed TAIFEX marketCode=1 TX months.
import {numeric,taipeiClock} from './home-close.js';
import {readSource} from './home-markets.js';
const text=html=>String(html).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const value=s=>numeric(String(s).replace(/[,▲▼%]/g,''));
export const nightUrl=date=>'https://www.taifex.com.tw/cht/3/futDailyMarketReport?'+new URLSearchParams({queryDate:date.replaceAll('-','/'),marketCode:'1',commodity_id:'TX'});
export function parseNight(html,requested,now=new Date()){
 const input=[...html.matchAll(/<input\b[^>]*>/gi)].find(m=>/\bname\s*=\s*["']queryDate["']/i.test(m[0]))?.[0];
 const query=input?.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1];
 if(query!==requested.replaceAll('-','/'))throw Error('來源交易歸屬日不符');
 const session=text(html).match(/(\d{4}\/\d{2}\/\d{2})\s+15:00\s*~\s*次日05:00\s+盤後交易時段行情表/);
 if(!session)throw Error('未取得已完成夜盤報表');
 const start=session[1].replaceAll('/','-')+'T15:00:00+08:00';
 // Derive the Taipei calendar day, not the preceding UTC day.
 const endDate=taipeiClock(new Date(Date.parse(start)+14*3600000)).date,sessionEnd=endDate+'T05:00:00+08:00';
 if(!Number.isFinite(Date.parse(start))||Date.parse(sessionEnd)>now.getTime()||endDate>requested)throw Error('夜盤尚未結束');
 const rows=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(c=>text(c[1])));
 const contracts=rows.filter(r=>r.length>=15&&r[0]==='TX'&&/^\d{6}$/.test(r[1])&&Number(r[1].slice(4))>=1&&Number(r[1].slice(4))<=12).sort((a,b)=>a[1].localeCompare(b[1]));
 if(!contracts.length)throw Error('TX 近月月契約夜盤尚未公布');
 const r=contracts[0],close=value(r[5]),high=value(r[3]),low=value(r[4]),open=value(r[2]),volume=value(r[8]);
 if(close<=0||volume<=0||!Number.isInteger(volume)||low<=0||high<low||close<low||close>high||open<low||open>high)throw Error('TX 近月夜盤資料不完整');
 return {contract:r[1],close,change:value(r[6]),changePct:value(r[7]),open,high,low,volume,tradeDate:requested,sessionStart:start,sessionEnd,status:'ok',source:'臺灣期貨交易所',sourceUrl:nightUrl(requested)};
}
export async function collectNight(previous,now=new Date(),read=readSource){
 const clock=taipeiClock(now),base=Date.parse(clock.date+'T12:00:00Z'),checkedAt=now.toISOString();let error;
 for(let offset=0;offset<10;offset++){
  const day=new Date(base-offset*86400000).toISOString().slice(0,10);
  try{const result=parseNight(await(await read(nightUrl(day))).text(),day,now);return {...result,collectedAt:checkedAt,checkedAt};}
  catch(e){error||=e.message;}
 }
 return {...(previous||{}),status:previous?.close>0?'stale':'unavailable',error:error||'夜盤尚未公布',checkedAt};
}
