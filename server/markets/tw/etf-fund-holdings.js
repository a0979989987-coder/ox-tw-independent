import { number } from '../../../src/markets/tw/etf/model.js';

export const clean = s => String(s??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
export function parseTableHoldings(html) {
  const rows=[];
  for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const trs=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(tr=>[...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>clean(c[1])));
    const head=trs.find(r=>r.some(c=>/權重|比重/.test(c))&&r.some(c=>/代碼|代號/.test(c)));
    if(!head)continue;
    const ci=head.findIndex(c=>/代碼|代號/.test(c)), ni=head.findIndex(c=>/名稱/.test(c)), wi=head.findIndex(c=>/權重|比重/.test(c));
    const isFuture=/期貨/.test(head.join('')); if(isFuture)continue;
    for(const r of trs){const code=r[ci],weight=number(r[wi]?.replace('%',''));if(code&&/^[\w./ -]{2,25}$/.test(code)&&weight!==null&&weight>=0&&weight<=100&&r[ni])rows.push({code,name:r[ni],weight});}
  }
  return [...new Map(rows.map(x=>[x.code,x])).values()];
}
let sectorCache;
let cathayFunds;
const INDUSTRIES={'01':'水泥','02':'食品','03':'塑膠','04':'紡織','05':'電機機械','06':'電器電纜','08':'玻璃陶瓷','09':'造紙','10':'鋼鐵','11':'橡膠','12':'汽車','14':'建材營造','15':'航運','16':'觀光餐旅','17':'金融保險','18':'貿易百貨','19':'其他','20':'其他','21':'化學','22':'生技醫療','23':'油電燃氣','24':'半導體','25':'電腦及週邊','26':'光電','27':'通信網路','28':'電子零組件','29':'電子通路','30':'資訊服務','31':'其他電子','32':'文化創意','33':'農業科技','34':'電子商務','35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活'};
async function sectors(acquire){
  if(sectorCache&&Date.now()-sectorCache.at<86400000)return sectorCache.map;
  const results=await Promise.allSettled(['https://openapi.twse.com.tw/v1/opendata/t187ap03_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'].map(u=>acquire(u)));
  const map=new Map(); for(const r of results)if(r.status==='fulfilled'&&Array.isArray(r.value))for(const v of r.value){const code=v['公司代號']||v.SecuritiesCompanyCode, industry=v['產業別']||v.Industry; if(code&&industry)map.set(code,INDUSTRIES[String(industry).padStart(2,'0')]||String(industry));}
  if(map.size)sectorCache={at:Date.now(),map};return map;
}
export async function loadHoldings(row,acquire){
  let holdings=[], date=null, source=row.issuer, url=row.url, complete=false;
  if(/元大/.test(row.issuer)){
    url=`https://www.yuantaetfs.com/product/detail/${row.symbol}/ratio`;
    const data=await acquire(`https://etfapi.yuantaetfs.com/ectranslation/api/bridge?APIType=ETFAPI&CompanyName=YUANTAFUNDS&FuncId=PCF%2FDaily&ticker=${row.symbol}`);
    if(data.PCF?.markcd!==row.symbol)throw Error('持股代號不一致');
    const d=String(data.PCF.trandate);date=d.length===8?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`:null;
    holdings=['StockWeights','BondWeights','ETFWeights'].flatMap(k=>(data.FundWeights?.[k]||[]).map(h=>({code:String(h.code),name:h.name,weight:number(h.weights),sector:k==='BondWeights'?'債券':k==='ETFWeights'?'ETF':null}))).filter(h=>h.weight!==null);
    complete=!!date&&holdings.length>0;
  }else if(/富邦/.test(row.issuer)){
    url=`https://websys.fsit.com.tw/FubonETF/Fund/Assets.aspx?stkId=${row.symbol}`;
    const html=await acquire(url,{text:true});
    date=clean(html).match(/資料日期[：:]\s*(\d{4})\/(\d{2})\/(\d{2})/)?.slice(1).join('-')||null;
    holdings=parseTableHoldings(html);complete=!!date&&holdings.length>0;
  }else if(/國泰/.test(row.issuer)){
    const base='https://cwapi.cathaysite.com.tw/api/ETF/';
    cathayFunds ||= (await acquire(base+'GetETFList?CurrentPage=1&PerPageCount=9999')).result;
    const fund=cathayFunds?.find(r=>r.stockCode===row.symbol);if(!fund)throw Error('發行人尚未公布此 ETF');
    const assets=(await acquire(base+'GetETFAssets?FundCode='+encodeURIComponent(fund.fundCode))).result;
    date=assets?.preDate?.replaceAll('/','-');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('持股資料日期未公布');
    url='https://www.cathaysite.com.tw/fund-details/E'+encodeURIComponent(fund.fundCode)+'?tab=portfolio';
    const query=new URLSearchParams({FundCode:fund.fundCode,SearchDate:date});
    const data=await Promise.all(['Stock','Bond','ETF','Fund'].map(type=>acquire(base+`GetETFDetail${type}List?`+query)));
    const nav=number(assets.fundNav);
    holdings=data.flatMap((r,i)=>(r.result||[]).map(h=>({code:i===0?h.stockCode:i===1?h.bondNo:i===2?h.skCode:h.fnNo,name:i===0?h.stockName:i===1?h.bondName:i===2?h.skName:h.fnName,weight:i===0?number(h.weights):i===2?number(h.ntMkval):nav>0&&number(h.ntMkval)!==null?number(h.ntMkval)/nav*100:null,sector:i===1?'債券':i>1?'ETF／基金':null}))).filter(h=>h.code&&h.weight!==null);
    complete=holdings.length>0&&data.every(r=>['2000','4005'].includes(r.returnCode));
  }else if(/永豐/.test(row.issuer)){
    url=`https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/${row.symbol}`;
    const html=await acquire(url,{text:true});
    date=clean(html).match(/資料日期[：:]\s*(\d{4})\/(\d{2})\/(\d{2})/)?.slice(1).join('-')||null;
    holdings=parseTableHoldings(html);complete=!!date&&holdings.length>0;
  }
  if(!holdings.length)return {symbol:row.symbol,date:null,holdings:[],sectors:[],complete:false,source,url,status:'此發行人尚無可驗證的完整持股資料',acquiredAt:new Date().toISOString()};
  const map=await sectors(acquire), groups=new Map();
  for(const h of holdings){h.sector=h.sector||map.get(h.code)||'未分類';groups.set(h.sector,(groups.get(h.sector)||0)+h.weight);}
  const coverage=holdings.reduce((s,h)=>s+h.weight,0);
  if(coverage<99.9)groups.set('現金／期貨及其他',Math.max(0,100-coverage));
  return {symbol:row.symbol,date,holdings:holdings.sort((a,b)=>b.weight-a.weight),sectors:[...groups].map(([name,weight])=>({name,weight})).sort((a,b)=>b.weight-a.weight),complete,coverage,source,url,status:'發行人每日持股；以基金淨資產為分母',acquiredAt:new Date().toISOString()};
}
