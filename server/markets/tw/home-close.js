// Adapted from the user-supplied taiwan-stock-weight-contribution collect.ts.
// Keep date, completeness and close-to-close validation aligned with that source.

export const WEIGHTS_URL='https://www.taifex.com.tw/cht/9/futuresQADetail';
export const reportUrl=(date       )=>'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date='+date.replaceAll('-','')+'&type=ALLBUT0999';
export function taipeiClock(now=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const val=(t       )=>p.find(x=>x.type===t) .value;
 const date=val('year')+'-'+val('month')+'-'+val('day');
 // Noon UTC avoids the preceding UTC day when deriving the Taipei calendar weekday.
 const day=new Date(date+'T12:00:00Z').getUTCDay();
 return {date,minutes:Number(val('hour'))*60+Number(val('minute')),weekend:day===0||day===6};
}
const clean=(s        )=>String(s??'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
export function numeric(v        ){const s=clean(v).replaceAll(',','');if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))throw new Error('資料包含缺漏或無效數值');const n=Number(s);if(!Number.isFinite(n))throw new Error('數值無效');return n;}
const price=(v        )=>{const n=numeric(v);if(n<=0)throw new Error('收盤價缺漏或無效');return n;};
export async function read(url       ){const r=await fetch(url,{headers:{'Accept':'application/json,text/html','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(18000),cache:'no-store'});if(!r.ok)throw new Error('官方資料來源連線失敗（'+r.status+'）');return r;}
export function parseWeights(html       ){
 const rows         =[];
 for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const c=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]));
  for(let i=0;i+3<c.length;i+=4){const rank=Number(c[i]);if(rank>=1&&rank<=12&&/^\d{4,6}$/.test(c[i+1]))rows.push({rank,code:c[i+1],name:c[i+2],weight:numeric(c[i+3].replace('%',''))/100});}
 }
 rows.sort((a,b)=>b.weight-a.weight);
 if(rows.length!==12||new Set(rows.map(x=>x.code)).size!==12||rows.some(x=>x.weight<=0||x.weight>=1)||rows.reduce((s,r)=>s+r.weight,0)>1)throw new Error('十二檔權重不完整，未儲存資料');
 const m=clean(html).replace(/\s+/g,' ').match(/資料日期[：:]\s*(\d{3,4})\/(\d{1,2})\/(\d{1,2})/);
 if(!m)throw new Error('來源未標示權重日期');const year=Number(m[1])+(m[1].length===3?1911:0);
 return {rows,date:year+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')};
}

export function parseReport(raw    ,date       ){
 if(raw.stat!=='OK'||raw.date!==date.replaceAll('-','')||!Array.isArray(raw.tables))throw new Error(date+' 完整收盤報表尚未發布，或為休市日');
 const table      =raw.tables.find((t      )=>t.fields?.includes('證券代號')&&t.fields?.includes('收盤價'));
 const idxTable      =raw.tables.find((t      )=>t.fields?.includes('收盤指數')&&t.data?.some(r=>r[0]==='發行量加權股價指數'));
 if(!table||!idxTable)throw new Error(date+' 大盤或股票收盤資料不完整');
 const ir=idxTable.data.find(r=>r[0]==='發行量加權股價指數') ;
 const indexClose=price(ir[idxTable.fields.indexOf('收盤指數')]);
 const sign=clean(ir[idxTable.fields.indexOf('漲跌(+/-)')]);
 const magnitude=numeric(ir[idxTable.fields.indexOf('漲跌點數')]);
 if(magnitude!==0&&sign!=='+'&&sign!=='-')throw new Error('指數漲跌符號不完整');
 const indexChange=magnitude*(sign==='-'?-1:1);
 const stocks=new Map                                    ();
 const codeIndex=table.fields.indexOf('證券代號'),nameIndex=table.fields.indexOf('證券名稱'),closeIndex=table.fields.indexOf('收盤價');
 for(const r of table.data)stocks.set(clean(r[codeIndex]),{name:clean(r[nameIndex]),close:r[closeIndex]});
 return {date,indexClose,indexChange,stocks};
}
export function calculate(date       ,previousDate       ,current                               ,previous                               ,weights                                )            {
 if(date!==current.date||previousDate!==previous.date||previousDate>=date||weights.date>date)throw new Error('交易日或權重日期不一致');
 const change=current.indexClose-previous.indexClose;
 // Reject a skipped previous session or mismatched daily report.
 if(Math.abs(change-current.indexChange)>.021)throw new Error('前一交易日指數與今日漲跌不一致，未儲存');
 const stocks=weights.rows.map(w=>{const c=current.stocks.get(w.code),p=previous.stocks.get(w.code);if(!c||!p)throw new Error(w.code+' 缺少當日或前一交易日資料');const close=price(c.close),previousClose=price(p.close),change=close-previousClose,changePct=change/previousClose*100;return {...w,name:c.name,close,previousClose,change,changePct,points:previous.indexClose*w.weight*(changePct/100)};});
 const positive=stocks.reduce((s,r)=>s+Math.max(r.points,0),0),negative=stocks.reduce((s,r)=>s+Math.min(r.points,0),0);
 return {date,previousDate,weightDate:weights.date,savedAt:new Date().toISOString(),index:{close:current.indexClose,previousClose:previous.indexClose,change,changePct:change/previous.indexClose*100},stocks,totals:{positive,negative,net:positive+negative},methodology:'previous-index-close × published-weight × close-to-close-return/v1',sources:{current:reportUrl(date),previous:reportUrl(previousDate),weights:WEIGHTS_URL}};
}
function rocDate(s       ){const m=s.match(/^(\d{3})\/(\d{2})\/(\d{2})$/);if(!m)throw new Error('交易日期格式異常');return (Number(m[1])+1911)+'-'+m[2]+'-'+m[3];}
export async function tradingDates(target       ){
 const load=async(month       )=>{const j=await(await read('https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date='+month.replaceAll('-',''))).json()                                 ;if(j.stat!=='OK'&&/沒有符合條件|查無資料/.test(j.stat||''))return [];if(j.stat!=='OK'||!Array.isArray(j.data))throw new Error('前一交易日資料暫時無法取得');return j.data.map((r         )=>rocDate(r[0]))            ;};
 let dates=await load(target);
 if(dates.filter(d=>d<target).length<2){const d=new Date(target+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);dates=[...dates,...await load(d.toISOString().slice(0,10))];}
 return [...new Set(dates)].filter(d=>d<=target).sort();
}
export async function collect(date       ,previousDate       ){
 const current=parseReport(await(await read(reportUrl(date))).json(),date);
 const previous=parseReport(await(await read(reportUrl(previousDate))).json(),previousDate);
 const weights=parseWeights(await(await read(WEIGHTS_URL)).text());
 return calculate(date,previousDate,current,previous,weights);
}

