import {officialJSON} from './research.js';
export function parseInstitutionSummary(payload,market,date){
 if(String(payload.date)!==date.replaceAll('-',''))throw Error('法人資料日期不符');
 const table=(payload.tables||[payload]).find(t=>Array.isArray(t.fields)&&Array.isArray(t.data));
 if(!table)throw Error('法人彙總欄位缺漏');
 const net=table.fields.findIndex(f=>/買賣差額|買賣超/.test(f));if(net<0)throw Error('法人金額欄位缺漏');
 const rows=table.data.map(r=>{const raw=r[net]==null?'':String(r[net]).replace(/,/g,'').trim();return {name:String(r[0]).replace(/\s/g,''),net:raw?Number(raw):NaN};});
 const get=re=>{const matches=rows.filter(r=>re.test(r.name));if(!matches.length||matches.some(r=>!Number.isSafeInteger(r.net)))throw Error('法人金額缺漏');return matches.reduce((n,r)=>n+r.net,0);};
 const total=get(/^(三大法人)?合計\*?$/),foreign=get(/^外資及陸資\(不含(?:外資)?自營商\)$/),trust=get(/^投信$/);
 const dealer=market==='TWSE'?get(/^自營商\((自行買賣|避險)\)$/):get(/^自營商合計$/);
 if(total!==foreign+trust+dealer)throw Error('法人彙總加總不符');
 return {market,date,total,foreign,trust,dealer};
}
export async function collectInstitutionSummary(date,previous,fetcher=fetch){
 const urls={TWSE:`https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate=${date.replaceAll('-','')}`,TPEX:`https://www.tpex.org.tw/www/zh-tw/insti/summary?type=Daily&prod=0&response=json&date=${date.replaceAll('-','%2F')}`};
 const result={date,collectedAt:new Date().toISOString(),method:'official-all-securities',markets:{}};
 await Promise.all(Object.entries(urls).map(async([market,url])=>{try{result.markets[market]={...parseInstitutionSummary(await officialJSON(url,fetcher),market,date),sourceUrl:url,status:'ok'};}catch{result.markets[market]=previous?.date===date&&previous.markets?.[market]?{...previous.markets[market],status:'stale'}:{market,date,total:null,status:'unavailable'};}}));
 const a=result.markets.TWSE.total,b=result.markets.TPEX.total;result.total=Number.isFinite(a)&&Number.isFinite(b)?a+b:null;return result;
}
