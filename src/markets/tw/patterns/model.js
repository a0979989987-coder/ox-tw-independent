export const TIMEFRAMES = { '1D':86400,'2D':172800,'3D':259200,'5D':432000,'1W':604800,'2W':1209600,'1M':2592000 };
export const FRAME_LABELS = {'1D':'日','2D':'2 日','3D':'3 日','5D':'5 日','1W':'週','2W':'2 週','1M':'月'};
export function selectUniverse(stocks, limit = 0) {
  return stocks.filter(row => /^\d{4}$/.test(row.symbol) && ['TWSE', 'TPEX'].includes(row.market) && Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.turnoverTwd) && row.turnoverTwd >= 0)
    .sort((a, b) => b.turnoverTwd - a.turnoverTwd).slice(0, limit || Infinity);
}
export function dailyCandles(rows, asOf) {
  const candles = new Map();
  for (const row of rows || []) {
    const date = row.date || row.datetime;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf) continue;
    const { open, high, low, close, volume } = row;
    if (![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, low, close) <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low || volume < 0) continue;
    candles.set(date, { date, time: Date.parse(date + 'T00:00:00+08:00') / 1000, open, high, low, close, volume, quoteVolume: Number.isFinite(row.turnoverTwd) ? row.turnoverTwd : Number.isFinite(row.quoteVolume)?row.quoteVolume:null });
  }
  // Holidays and suspended sessions remain gaps, never synthetic bars.
  return [...candles.values()].sort((a, b) => a.time - b.time);
}
export function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function weeklyCandles(daily, asOf, now = Date.now()) {
  const groups = new Map(), local = new Date(now + 8 * 3600000), today = local.toISOString().slice(0, 10);
  const thisWeek = weekStart(today), day = local.getUTCDay();
  // Only complete weeks. Friday's official close can finish a week;
  // holiday-shortened weeks are accepted once the weekend has arrived.
  const officialFriday = new Date(asOf + 'T00:00:00Z').getUTCDay() === 5;
  for (const c of daily) {
    const week = weekStart(c.date);
    if (week > thisWeek || week === thisWeek && day !== 0 && day !== 6 && !officialFriday) continue;
    const group = groups.get(week);
    if (!group) groups.set(week, { ...c, date: week, time: Date.parse(week + 'T00:00:00+08:00') / 1000, lastDate: c.date });
    else { group.high = Math.max(group.high, c.high); group.low = Math.min(group.low, c.low); group.close = c.close; group.volume += c.volume; group.quoteVolume = group.quoteVolume === null || c.quoteVolume === null ? null : group.quoteVolume + c.quoteVolume; group.lastDate = c.date; }
  }
  return [...groups.values()];
}

// Combine genuine daily bars; never split a daily OHLC into intraday candles.
export function aggregateCandles(daily,frame,asOf,now=Date.now()) {
 if(frame==='1D')return daily;
 if(frame==='1W')return weeklyCandles(daily,asOf,now);
 const combine=(bars,date=bars[0].date)=>({date,time:Date.parse(date+'T00:00:00+08:00')/1000,lastDate:bars.at(-1).lastDate||bars.at(-1).date,open:bars[0].open,high:Math.max(...bars.map(c=>c.high)),low:Math.min(...bars.map(c=>c.low)),close:bars.at(-1).close,volume:bars.reduce((n,c)=>n+c.volume,0),quoteVolume:bars.every(c=>Number.isFinite(c.quoteVolume))?bars.reduce((n,c)=>n+c.quoteVolume,0):null});
 if(frame==='1M') {const months=new Map();for(const c of daily){const month=c.date.slice(0,7);if(month>=asOf.slice(0,7)||month===daily[0]?.date.slice(0,7))continue;if(!months.has(month))months.set(month,[]);months.get(month).push(c);}return [...months].map(([month,bars])=>combine(bars,month+'-01'));}
 if(frame==='2W'){const weeks=weeklyCandles(daily,asOf,now),groups=new Map();for(const c of weeks){const anchor=Math.floor((Date.parse(c.date+'T00:00:00Z')-Date.parse('1970-01-05T00:00:00Z'))/(14*86400000));if(!groups.has(anchor))groups.set(anchor,[]);groups.get(anchor).push(c);}return [...groups.values()].filter(b=>b.length===2).map(b=>combine(b));}
 const count=Number(frame.slice(0,-1));if(![2,3,5].includes(count))throw Error('Unsupported Taiwan timeframe');
 const complete=[];const offset=daily.length%count;for(let i=offset;i+count<=daily.length;i+=count)complete.push(combine(daily.slice(i,i+count)));return complete;
}
