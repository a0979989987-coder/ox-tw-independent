export const HOME_GROUPS=[['us','美國股市'],['asia','亞洲市場'],['indicators','市場指標'],['commodities','商品市場'],['fx','外匯市場'],['yields','美國公債殖利率']];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<1e-6;
export function validCloseReport(r){
 if(!r||!validDate(r.date)||!validDate(r.previousDate)||!validDate(r.weightDate)||r.previousDate>=r.date||r.weightDate>r.date||!Array.isArray(r.stocks)||r.stocks.length!==12||new Set(r.stocks.map(s=>s.code)).size!==12)return false;
 const index=r.index;if(!index||!(index.close>0)||!(index.previousClose>0)||!close(index.change,index.close-index.previousClose)||!close(index.changePct,index.change/index.previousClose*100))return false;
 if(r.stocks.some(s=>!/^\d{4,6}$/.test(s.code)||!finite(s.weight)||s.weight<=0||s.weight>=1||!(s.close>0)||!(s.previousClose>0)||!close(s.change,s.close-s.previousClose)||!close(s.changePct,s.change/s.previousClose*100)||!close(s.points,index.previousClose*s.weight*s.changePct/100))||r.stocks.reduce((sum,s)=>sum+s.weight,0)>1)return false;
 const positive=r.stocks.reduce((sum,s)=>sum+Math.max(s.points,0),0),negative=r.stocks.reduce((sum,s)=>sum+Math.min(s.points,0),0);
 return close(r.totals?.positive,positive)&&close(r.totals?.negative,negative)&&close(r.totals?.net,positive+negative)&&Number.isFinite(Date.parse(r.savedAt));
}
export function validNight(r,now=Date.now()){
 if(!r||['close','open','high','low','volume','change','changePct'].some(key=>!finite(r[key])))return false;
 return !!r&&/^\d{6}$/.test(r.contract||'')&&validDate(r.tradeDate)&&/T15:00:00\+08:00$/.test(r.sessionStart||'')&&/T05:00:00\+08:00$/.test(r.sessionEnd||'')&&Date.parse(r.sessionEnd)-Date.parse(r.sessionStart)===14*3600000&&Date.parse(r.sessionEnd)<=now&&r.sessionEnd.slice(0,10)<=r.tradeDate&&r.close>0&&r.low>0&&r.high>=r.low&&r.close>=r.low&&r.close<=r.high&&Number.isInteger(r.volume)&&r.volume>0&&finite(r.change)&&finite(r.changePct)&&Number.isFinite(Date.parse(r.collectedAt));
}
export function validBriefing(r){
 const expected=r?.rows?.some(row=>row.id==='TSM')?22:21;
 return !!r&&validDate(r.date)&&Array.isArray(r.rows)&&r.rows.length===expected&&new Set(r.rows.map(row=>row.id)).size===expected&&r.rows.every(row=>HOME_GROUPS.some(([group])=>group===row.group)&&(!finite(row.value)||validDate(row.marketDate))&&(row.group!=='asia'||!finite(row.value)||row.marketDate<r.date&&row.quoteKind==='previous-close'));
}
// The official, validated cash close also supplies the morning Taiwan row.
// Never substitute the report day's close or replace a newer source date.
export function withOfficialTaiwanClose(briefing,core){
 if(!validBriefing(briefing)||!validCloseReport(core)||core.date>=briefing.date)return briefing;
 const row=briefing.rows.find(r=>r.id==='^TWII');
 if(!row||row.marketDate>core.date)return briefing;
 const official={...row,value:core.index.close,change:core.index.change,changePct:core.index.changePct,previousClose:core.index.previousClose,marketDate:core.date,comparisonDate:core.previousDate,source:'臺灣證券交易所',sourceUrl:core.sources?.current,quoteKind:'previous-close',quotedAt:null,collectedAt:core.savedAt,status:'ok'};
 delete official.error;
 const rows=briefing.rows.map(r=>r.id==='^TWII'?official:r);
 return {...briefing,rows,complete:rows.every(r=>r.status==='ok')};
}
export function acceptHomeSection(section,value){
 if(value==null)return null;
 if(section==='core'&&!validCloseReport(value)||section==='night'&&value.status!=='unavailable'&&!validNight(value)||section==='briefing'&&!validBriefing(value))throw Error('資料日期或完整性驗證失敗，保留上次有效資料');
 if(section==='core'&&value.institutional){
  const r=value.institutional,markets=['TWSE','TPEX'].map(key=>r.markets?.[key]);
  const invalidMarket=m=>{
   if(!m||m.date!==r.date||!['ok','stale','unavailable'].includes(m.status))return true;
   return m.status==='unavailable'?m.total!==null:![m.total,m.foreign,m.trust,m.dealer].every(Number.isSafeInteger)||m.total!==m.foreign+m.trust+m.dealer;
  };
  if(r.date!==value.date||!Number.isFinite(Date.parse(r.collectedAt))||markets.some(invalidMarket)||r.total!==(markets.every(m=>Number.isSafeInteger(m.total))?markets[0].total+markets[1].total:null))throw Error('法人彙總驗證失敗');
 }
 return value;
}
