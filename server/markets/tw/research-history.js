import { officialJSON, reportTables, numeric, loadInstitutional, joinResearchStocks, aggregateSectors } from './research.js';
export function normalizeHistoricalQuotes(payload, market, date, companies) {
  const returnedDate = String(payload.date || '').replace(/[^0-9]/g, '');
  if (returnedDate && returnedDate !== date.replaceAll('-', '')) throw new Error('Historical quote date mismatch');
  const table = reportTables(payload).find(t => t.fields.some(f => ['收盤價','收盤'].includes(f)) && t.fields.some(f => ['證券代號','代號'].includes(f)));
  if (!table) return [];
  const at = names => table.fields.findIndex(f => names.includes(f));
  const code = at(['證券代號','代號']), price = at(['收盤價','收盤']), change = at(['漲跌價差','漲跌']);
  const sign = at(['漲跌+/-']);
  const amount = at(['成交金額元','成交金額','成交值']);
  return table.data.map(row => {
    const symbol = String(row[code]).trim(), company = companies.get(`${market}:${symbol}`);
    const close = numeric(row[price]);
    if (!company || !(close > 0)) return null;
    let diff = numeric(row[change]);
    if (diff !== null && sign >= 0 && String(row[sign]).includes('-')) diff = -Math.abs(diff);
    return { symbol, name: company.name, industry: company.industry, market, price: close, dataDate: date,
      changePct: diff !== null && close - diff > 0 ? diff / (close - diff) * 100 : null, turnoverTwd: numeric(row[amount]) };
  }).filter(Boolean);
}
export async function collectHistoryDay(date, companies) {
  const compact = date.replaceAll('-', ''), roc = `${Number(date.slice(0,4))-1911}/${date.slice(5,7)}/${date.slice(8)}`;
  const [twse, tpex, twseFlow, tpexFlow] = await Promise.all([
    officialJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${compact}&type=ALLBUT0999`),
    officialJSON(`https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=${encodeURIComponent(roc)}&se=EW&o=json`),
    loadInstitutional(date,'TWSE'), loadInstitutional(date,'TPEX')
  ]);
  const quotes = [...normalizeHistoricalQuotes(twse,'TWSE',date,companies), ...normalizeHistoricalQuotes(tpex,'TPEX',date,companies)];
  if (!quotes.some(q=>q.market==='TWSE') || !quotes.some(q=>q.market==='TPEX')) throw new Error('No aligned official quotes');
  const stocks = joinResearchStocks(quotes,[twseFlow,tpexFlow],date);
  return { date, sectors: aggregateSectors(stocks) };
}
