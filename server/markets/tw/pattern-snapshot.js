import { numeric, reportTables } from './research.js';
import { dailyCandles, aggregateCandles, expandHistory, startsPeriod, weekStart, mergeCalendars, BASE_SESSION_CALENDAR, SESSION_ANCHOR, TIMEFRAMES } from '../../../src/markets/tw/patterns/model.js';
import { prepareCandles, classifyPrepared } from '../../../src/components/patterns/matcher.js';
import { compactClassic } from '../../../src/core/classic-server.js';
// 7: 2/3/5-session bars are numbered from a fixed session (SESSION_ANCHOR).
export const ALGORITHM_VERSION = 7;
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
// Completed weeks/months older than the 180-session daily window. 2W needs
// 35 bars (70 weeks) and 1M 35 months, far beyond the window; only compact
// aggregates are shipped, so the browser can classify these frames directly.
// 60 weeks + ~37 window weeks ≈ 48 2W bars; 42 months + ~8 ≈ 50 1M bars.
// Turnover is not used by any classification and is not shipped (size).
export const HISTORY_WEEKS = 60, HISTORY_MONTHS = 42;
const day = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const month = (date, months) => { const d = new Date(date.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
const compactBar = c => [c.date, c.open, c.high, c.low, c.close, c.volume];
const combineBars = (bars, date) => ({ date, open: bars[0].open, high: Math.max(...bars.map(c => c.high)), low: Math.min(...bars.map(c => c.low)), close: bars.at(-1).close, volume: bars.reduce((n, c) => n + c.volume, 0) });
// First day of the oldest month the snapshot keeps for a window start.
export function historyTarget(windowStart) { return month(windowStart, -(HISTORY_MONTHS - 1)); }
// daily: every verified official daily bar known for the stock (window, the
// bars that just left it, back-filled sessions). from: every weekday since
// `from` has been fetched for this stock. prior: the previous history, whose
// completed periods are kept as published (their days may no longer be known).
export function buildHistory({ daily, prior = null, from, windowStart, asOf, calendar = null }) {
  if (!from || !windowStart || from > windowStart) return null;
  const bars = dailyCandles([...(daily || []), ...expandHistory(prior?.edge)], asOf).filter(c => c.date >= from);
  const weekFloor = startsPeriod(from, weekStart(from), calendar) ? weekStart(from) : day(weekStart(from), 7);
  const monthFloor = startsPeriod(from, from.slice(0, 7) + '-01', calendar) ? from.slice(0, 7) + '-01' : month(from, 1);
  const lastWeek = weekStart(windowStart), lastMonth = windowStart.slice(0, 7) + '-01';
  const firstWeek = day(lastWeek, -7 * (HISTORY_WEEKS - 1)), firstMonth = historyTarget(windowStart);
  const keep = (rows, first, last) => new Map(expandHistory(rows).filter(c => c.date >= first && c.date <= last).map(c => [c.date, compactBar(c)]));
  const weeks = keep(prior?.weeks, firstWeek, lastWeek), months = keep(prior?.months, firstMonth, lastMonth);
  const group = key => { const map = new Map(); for (const c of bars) { const k = key(c.date); if (!map.has(k)) map.set(k, []); map.get(k).push(c); } return map; };
  for (const [week, rows] of group(weekStart)) if (week >= weekFloor && week >= firstWeek && week <= lastWeek && !weeks.has(week)) weeks.set(week, compactBar(combineBars(rows, week)));
  for (const [key, rows] of group(d => d.slice(0, 7) + '-01')) if (key >= monthFloor && key >= firstMonth && key <= lastMonth && !months.has(key)) months.set(key, compactBar(combineBars(rows, key)));
  // Days of the partly fetched first week/month stay as daily rows until the
  // back-fill reaches the start of that period.
  const edge = bars.filter(c => c.date < windowStart && (weekStart(c.date) < weekFloor && weekStart(c.date) >= firstWeek || c.date.slice(0, 7) + '-01' < monthFloor && c.date.slice(0, 7) + '-01' >= firstMonth)).map(compactBar);
  const sorted = map => [...map.values()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  return { from, weeks: sorted(weeks), months: sorted(months), edge };
}
// History is published in its own files (see historyFiles), not inside the
// daily chunks: completed weeks/months change once a week or month, while the
// daily chunks are rewritten for every new session.
export const HISTORY_BUCKETS = 20, HISTORY_FILE_VERSION = 1;
// Official sessions kept as daily bars. 2/3/5-day bars are numbered from a
// fixed session, so a window can lose up to count-1 sessions at each end to a
// partial first group and the still-forming last group: 185 sessions always
// leave 35 complete 5-day bars (the classification minimum), whatever the day.
export const WINDOW_SESSIONS = 185;
// The newest `count` sessions up to `date`. The official holiday schedule
// (`official.isOpen`, null for a year it does not list, e.g. last year in
// January) is used first; days it does not cover come from the session
// calendar already known (fixed base plus the prior snapshot's), so the window
// does not shrink at a year boundary. Stops where neither knows a day.
export function sessionWindow(date, { count = WINDOW_SESSIONS, official = null, calendar = null } = {}) {
  const known = mergeCalendars(BASE_SESSION_CALENDAR, calendar), closed = new Set(known.closed), dates = [];
  for (let cursor = new Date(date + 'T00:00:00Z'), i = 0; i < 400 && dates.length < count; i++, cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    const day = cursor.toISOString().slice(0, 10), weekday = ![0, 6].includes(cursor.getUTCDay());
    let open = official?.isOpen?.(day);
    if (open !== true && open !== false) open = day >= SESSION_ANCHOR && day <= known.through ? weekday && !closed.has(day) : null;
    if (open === null) break;
    if (open) dates.push(day);
  }
  return dates;
}
// A stock always lives in the same file, whatever the day's turnover order,
// so a file changes only when one of its stocks' completed periods changes.
export const historyBucket = symbol => Number(symbol) % HISTORY_BUCKETS;
export const historyFileName = bucket => `history-${String(bucket).padStart(2, '0')}.json.gz`;
// Deterministic text per bucket (symbols sorted, no dates or timestamps):
// identical history produces identical bytes.
export function historyFiles(histories) {
  const buckets = Array.from({ length: HISTORY_BUCKETS }, () => []);
  for (const [symbol, history] of [...histories].sort(([a], [b]) => a < b ? -1 : 1)) if (history && /^\d{4}$/.test(symbol)) buckets[historyBucket(symbol)].push({ key: symbol, history });
  return buckets.map((entries, bucket) => ({ file: historyFileName(bucket), count: entries.length, symbols: entries.map(e => e.key),
    text: JSON.stringify({ version: HISTORY_FILE_VERSION, bucket, entries }) }));
}
export function buildPatternEntry(stock, bars, date, {calendar=null,history=null}={}) {
  const candles=dailyCandles(bars,date).slice(-200);
  if(candles.at(-1)?.date!==date)return {symbol:stock.symbol,reason:'資料日日 K 缺漏'};
  if(candles.length<35)return {symbol:stock.symbol,reason:'官方歷史少於 35 根日 K'};
  const daily=prepareCandles(candles);
  const compact=context=>Object.fromEntries(Object.entries(context.classic).map(([side,s])=>[side,compactClassic(s)]));
  return {key:stock.symbol+':1D',data:{symbol:stock.symbol,name:stock.name,market:'tw',board:stock.market,frame:'1D',dataDate:date,source:'TWSE／TPEx',serverTime:Date.parse(date+'T16:00:00+08:00'),candles,classic:compact(daily),turnover:stock.turnoverTwd,change:stock.changePct,oxScore:null},classic:compact(daily),matches:classifyPrepared(daily),frames:Object.fromEntries(Object.keys(TIMEFRAMES).filter(f=>f!=='1D').flatMap(f=>{const bars=aggregateCandles(candles,f,date,Date.now(),{calendar,history});if(bars.length<35)return [];const context=prepareCandles(bars);return [[f,{classic:compact(context),matches:classifyPrepared(context)}]];}))};
}
