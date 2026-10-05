import {numeric,normalizeInstitutional} from './research.js';
export function parseScreenFlows(payload,market,date){
 const actual=String(payload.date||'').replace(/\D/g,'');if(actual!==date.replaceAll('-',''))throw Error('Institutional date mismatch');
 if(market==='TWSE')return normalizeInstitutional(payload,market,date);
 const t=payload.tables?.find(t=>t.fields?.length===24&&t.fields[0]==='代號'&&t.fields[23]==='三大法人買賣超股數合計');
 if(payload.template!=='/template/insti/dailyTrade'||!t)throw Error('Unrecognized institutional column groups');
 return t.data.filter(r=>/^\d{4,6}$/.test(String(r[0]))).map(r=>{
  const v=r.map(numeric);if([4,7,10,13,16,19,22,23].some(i=>v[i]===null)||v[4]+v[7]!==v[10]||v[16]+v[19]!==v[22]||v[10]+v[13]+v[22]!==v[23])throw Error('Institutional subtotal mismatch');
  return {symbol:String(r[0]),market,date,foreignShares:v[4],trustShares:v[13],dealerShares:v[22],netShares:v[23]};
 });
}
