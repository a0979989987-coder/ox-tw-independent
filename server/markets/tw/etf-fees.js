import { clean } from './etf-fund-holdings.js';
import { number } from '../../../src/markets/tw/etf/model.js';
export const FEE_URL='https://www.sitca.org.tw/ROC/Industry/IN2211.aspx?pid=IN2222_01';
export const fundName=s=>clean(s).replace(/[（(](?:本?基金|配息|收益)[\s\S]*$/,'').replace(/證券投資信託|\s/g,'').replaceAll('臺','台');
export function parseAnnualFees(html,year){
  const selected=(name)=>html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1].match(/<option selected="selected" value="([^"]*)"/)?.[1];
  if(selected('ctl00\\$ContentPlaceHolder1\\$ddlQ_Y')!==String(year)||selected('ctl00\\$ContentPlaceHolder1\\$ddlQ_M')!=='Year')throw Error('費用資料尚未切換至完整年度');
  const rows=[];
  for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const c=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
    if(c.length!==19||!/^\d{8}$/.test(c[1]))continue;
    const expense=number(c[18]?.replace('%',''));
    if(expense!==null&&expense>=0&&expense<100)rows.push({taxId:c[1],name:c[2],expense});
  }
  if(rows.length<100)throw Error('年度費用資料不完整');
  return {year,rows,source:'投信投顧公會',url:FEE_URL,acquiredAt:new Date().toISOString()};
}
function form(html,year){
  const body=new URLSearchParams();
  for(const m of html.matchAll(/<input\b[^>]*type="hidden"[^>]*>/gi)){const name=m[0].match(/name="([^"]+)"/)?.[1],value=m[0].match(/value="([^"]*)"/)?.[1];if(name)body.set(name,value||'');}
  for(const m of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi))body.set(m[1],m[2].match(/<option selected="selected" value="([^"]*)"/)?.[1]||'');
  body.set('ctl00$ContentPlaceHolder1$ddlQ_Y',String(year));body.set('ctl00$ContentPlaceHolder1$ddlQ_M','Year');body.set('ctl00$ContentPlaceHolder1$BtnQuery','查詢');return body;
}
export async function collectAnnualFees(fetcher=fetch){
  const year=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Taipei'}).format(new Date()))-1;
  const request=async options=>{const r=await fetcher(FEE_URL,{...options,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('費用來源暫時無法讀取');return r.text();};
  let html=await request({});
  // A year change rebuilds the month selector. Submit again to select the full year.
  for(let i=0;i<2;i++){html=await request({method:'POST',body:form(html,year)});try{return parseAnnualFees(html,year);}catch{}}
  throw Error('尚未公布完整年度費用');
}
export function applyFees(rows,data){
  const ids=new Map(data.rows.filter(r=>r.taxId).map(r=>[r.taxId,r])),names=new Map();
  for(const r of data.rows){const key=fundName(r.name);names.set(key,names.has(key)?null:r);}
  for(const r of rows){const f=ids.get(r.taxId)||names.get(fundName(r.fullName));if(f)Object.assign(r,{expense:f.expense,expenseYear:data.year,expenseUrl:data.url});}
}
