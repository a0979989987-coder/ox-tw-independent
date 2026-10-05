import { numeric, reportTables } from './research.js';
import { dailyCandles, aggregateCandles, TIMEFRAMES } from '../../../src/markets/tw/patterns/model.js';
import { prepareCandles, classifyPrepared } from '../../../src/components/patterns/matcher.js';
import { compactClassic } from '../../../src/core/classic-server.js';
export const ALGORITHM_VERSION = 6;
export function parseMarketDay(payload, market, date, companies) {
  if (String(payload?.date || '').replace(/\D/g, '') !== date.replaceAll('-', '')) throw Error(`${market}: substituted report date`);
  const table = reportTables(payload).find(t => t.fields.some(f => ['收盤價','收盤'].includes(f)) && t.fields.some(f => ['證券代號','代號'].includes(f)));
  if (!table) throw Error(`${market}: missing OHLC table`);
  const at = names => table.fields.findIndex(f => names.includes(f));
  const fields = { symbol:at(['證券代號','代號']),open:at(['開盤價','開盤']),high:at(['最高價','最高']),low:at(['最低價','最低']),close:at(['收盤價','收盤']),volume:at(['成交股數']),turnoverTwd:at(['成交金額元','成交金額','成交值']) };
  if(Object.values(fields).some(i=>i<0))throw Error(`${market}: missing official OHLC fields`);
  return table.data.flatMap(row => {
    const symbol=String(row[fields.symbol]).trim(); if(!companies.has(`${market}:${symbol}`))return [];
    const bar={date}; for(const key of ['open','high','low','close','volume','turnoverTwd'])bar[key]=numeric(row[fields[key]]);
    const valid=dailyCandles([bar],date);return valid.length?[{symbol,market,candle:valid[0]}]:[];
  });
}
export function buildPatternEntry(stock, bars, date) {
  const candles=dailyCandles(bars,date).slice(-200);
  if(candles.at(-1)?.date!==date)return {symbol:stock.symbol,reason:'資料日日 K 缺漏'};
  if(candles.length<35)return {symbol:stock.symbol,reason:'官方歷史少於 35 根日 K'};
  const daily=prepareCandles(candles);
  const compact=context=>Object.fromEntries(Object.entries(context.classic).map(([side,s])=>[side,compactClassic(s)]));
  return {key:stock.symbol+':1D',data:{symbol:stock.symbol,name:stock.name,market:'tw',board:stock.market,frame:'1D',dataDate:date,source:'TWSE／TPEx',serverTime:Date.parse(date+'T16:00:00+08:00'),candles,classic:compact(daily),turnover:stock.turnoverTwd,change:stock.changePct,oxScore:null},classic:compact(daily),matches:classifyPrepared(daily),frames:Object.fromEntries(Object.keys(TIMEFRAMES).filter(f=>f!=='1D').flatMap(f=>{const bars=aggregateCandles(candles,f,date);if(bars.length<35)return [];const context=prepareCandles(bars);return [[f,{classic:compact(context),matches:classifyPrepared(context)}]];}))};
}
