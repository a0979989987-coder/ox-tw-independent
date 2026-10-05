import { FIELDS, FIELD_MAP } from './catalog.js';
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function normalizeConditions(input={}) {
 const out={};for(const f of FIELDS){const v=input[f.id];if(f.type==='boolean'){if(v===true)out[f.id]=true;}else if(f.type==='rating'){if(Array.isArray(v)&&v.length)out[f.id]=[...new Set(v.filter(x=>['A','B','C','D','E'].includes(x)))];}else if(v!==''&&v!=null&&finite(Number(v))){const x=Number(v);if((f.min==null||x>=f.min)&&(f.max==null||x<=f.max))out[f.id]=x;}}
 return out;
}
export function screenStocks(stocks,conditions={},scope={}) {
 const rules=Object.entries(normalizeConditions(conditions));
 if(conditions&&Object.keys(conditions).some(k=>!FIELD_MAP[k]))throw Error('不支援的條件');
 let missing=0,eligible=0;
 const rows=stocks.filter(s=>{
  if(scope.market&&s.market!==scope.market||scope.industry&&s.industry!==scope.industry)return false;
  eligible++;
  if(rules.some(([id])=>{const f=FIELD_MAP[id],v=s[f.metric];return f.type==='number'?!finite(v):f.type==='boolean'?typeof v!=='boolean':!v;})){missing++;return false;}
  return rules.every(([id,value])=>{const f=FIELD_MAP[id],v=s[f.metric];return f.type==='boolean'?v===true:f.type==='rating'?value.includes(v):f.op==='gte'?v>=value:v<=value;});
 });return {rows,missing,eligible};
}
export function coverage(stocks){return Object.fromEntries(FIELDS.map(f=>[f.id,stocks.filter(s=>f.type==='number'?finite(s[f.metric]):f.type==='boolean'?typeof s[f.metric]==='boolean':!!s[f.metric]).length]));}
export function conditionLabel(id,v){const f=FIELD_MAP[id];return !f?'':f.type==='number'?`${f.label} ${f.op==='gte'?'≥':'≤'} ${v}${f.unit}`:f.type==='rating'?`評級 ${v.join('、')}`:f.label;}
export function technicalMetrics(candles,priceDate){
 const c=[...new Map(candles.filter(x=>x?.date&&x.date<=priceDate&&finite(x.close)&&x.close>0&&finite(x.high)&&finite(x.low)&&finite(x.volume)&&x.volume>=0).map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(!c.length||c.at(-1).date!==priceDate)return {};
 const last=c.at(-1),close=last.close,avg=(a,k)=>a.reduce((t,x)=>t+x[k],0)/a.length;
 const ma=n=>c.length>=n?avg(c.slice(-n),'close'):null;const ret=n=>c.length>n?(close/c.at(-1-n).close-1)*100:null;
 const out={volume:last.volume/1000,return5:ret(5),return20:ret(20),volume5:c.length>=5?avg(c.slice(-5),'volume')/1000:null};
 for(const n of [5,20,60,240])out['above'+n]=ma(n)==null?null:close>ma(n);
 out.ma20Rising=c.length>=21?ma(20)>avg(c.slice(-21,-1),'close'):null;
 out.bullMAs=c.length>=240?ma(5)>ma(20)&&ma(20)>ma(60)&&ma(60)>ma(240):null;
 if(c.length>=21){const prior=c.slice(-21,-1),vol=avg(prior,'volume');out.volumeRatio=vol>0?last.volume/vol:null;out.breakout20=close>Math.max(...prior.map(x=>x.high));out.newLow20=close<Math.min(...prior.map(x=>x.low));const w=c.slice(-20),lo=Math.min(...w.map(x=>x.low));out.amplitude20=lo>0?(Math.max(...w.map(x=>x.high))/lo-1)*100:null;const r=c.slice(-21).slice(1).map((x,i)=>(x.close/c.slice(-21)[i].close-1)*100),m=r.reduce((a,b)=>a+b,0)/r.length;out.volatility20=Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/(r.length-1));out.consolidation=finite(out.volumeRatio)&&out.volumeRatio<.8&&out.amplitude20<15;}
 if(c.length>=7)out.rebound=(c.at(-2).close/c.at(-7).close-1)*100<=-3&&(close/c.at(-2).close-1)*100>=1;
 const start=new Date(priceDate+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-364);const since=start.toISOString().slice(0,10),year=c.filter(x=>x.date>=since);
 if(c[0].date<=since&&year.length>=200){out.high52Distance=(1-close/Math.max(...year.map(x=>x.high)))*100;out.low52Distance=(close/Math.min(...year.map(x=>x.low))-1)*100;}
 return out;
}
