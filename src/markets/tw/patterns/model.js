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
// Latest week start whose week counts as closed, using the weekly rule below.
export function completedWeek(asOf, now = Date.now()) {
  const local = new Date(now + 8 * 3600000), thisWeek = weekStart(local.toISOString().slice(0, 10)), day = local.getUTCDay();
  const officialFriday = new Date(asOf + 'T00:00:00Z').getUTCDay() === 5;
  return day === 0 || day === 6 || officialFriday ? thisWeek : shiftDate(thisWeek, -7);
}
const shiftDate = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
// The first period of a history is complete only when no possible session of
// that period precedes the first bar (known closures come from the calendar).
export function startsPeriod(first, periodStart, calendar = sharedCalendar) {
  const closed = new Set(calendar?.closed || []);
  for (let date = periodStart; date < first; date = shiftDate(date, 1)) if (isWeekday(date) && !closed.has(date)) return false;
  return true;
}
// True when no possible session remains in asOf's month after asOf.
export function monthClosed(asOf, calendar = sharedCalendar) {
  const closed = new Set(sessionCalendar(calendar)?.closed || []), month = asOf.slice(0, 7);
  for (let date = shiftDate(asOf, 1); date.slice(0, 7) === month; date = shiftDate(date, 1)) if (isWeekday(date) && !closed.has(date)) return false;
  return true;
}
export function weeklyCandles(daily, asOf, now = Date.now(), options = {}) {
  const groups = new Map(), lastWeek = completedWeek(asOf, now);
  const calendar = resolveCalendar(options.calendar);
  // Only complete weeks. Friday's official close can finish a week;
  // holiday-shortened weeks are accepted once the weekend has arrived. The
  // first week is dropped when the history starts after that week began.
  const firstWeek = daily.length && !startsPeriod(daily[0].date, weekStart(daily[0].date), calendar) ? weekStart(daily[0].date) : null;
  for (const c of daily) {
    const week = weekStart(c.date);
    if (week > lastWeek || week === firstWeek) continue;
    const group = groups.get(week);
    if (!group) groups.set(week, { ...c, date: week, time: Date.parse(week + 'T00:00:00+08:00') / 1000, lastDate: c.date });
    else { group.high = Math.max(group.high, c.high); group.low = Math.min(group.low, c.low); group.close = c.close; group.volume += c.volume; group.quoteVolume = group.quoteVolume === null || c.quoteVolume === null ? null : group.quoteVolume + c.quoteVolume; group.lastDate = c.date; }
  }
  return [...groups.values()];
}

// Multi-session (2/3/5 日) bars are numbered from one fixed Taiwan trading
// session. A historical bar therefore keeps the same daily members when newer
// sessions arrive; only the newest, still-forming group is withheld.
export const SESSION_ANCHOR = '2026-01-15';
const ISO = /^\d{4}-\d{2}-\d{2}$/, MONDAY = Date.parse('1970-01-05T00:00:00Z');
const weekdayIndex = date => { const days = Math.round((Date.parse(date + 'T00:00:00Z') - MONDAY) / 86400000), week = Math.floor(days / 7); return week * 5 + Math.min(days - week * 7, 5); };
const isWeekday = date => { const day = new Date(date + 'T00:00:00Z').getUTCDay(); return day !== 0 && day !== 6; };
// calendar = {anchor, closed:[weekday market closures on/after the anchor],
// through}: every weekday from the anchor through `through` is known to be a
// session or a closure. Weekdays after `through` are counted as sessions.
export function sessionCalendar(value) {
  if (!value || value.anchor !== SESSION_ANCHOR || !Array.isArray(value.closed)) return null;
  const closed = [...new Set(value.closed.filter(d => ISO.test(d) && d >= SESSION_ANCHOR && isWeekday(d)))].sort();
  return { anchor: SESSION_ANCHOR, closed, through: ISO.test(value.through || '') ? value.through : closed.at(-1) || SESSION_ANCHOR };
}
// Official TWSE weekday closures from the anchor through 2026-10-15, read from
// the official MI_INDEX sessions of the published snapshots (holidays, Lunar
// New Year, the 2026-07-10 typhoon closure). It is fixed history, so session
// numbers never depend on whether the daily window still reaches the anchor.
// Later closures are carried by each snapshot's sessionCalendar.
export const BASE_SESSION_CALENDAR = Object.freeze(sessionCalendar({ anchor: SESSION_ANCHOR, through: '2026-10-15', closed: [
  '2026-02-12', '2026-02-13', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27',
  '2026-04-03', '2026-04-06', '2026-05-01', '2026-06-19', '2026-07-10', '2026-09-25', '2026-09-28', '2026-10-09'] }));
// Both calendars are complete from the anchor, so their union is complete
// through the later of the two.
export function mergeCalendars(...values) {
  const known = values.map(sessionCalendar).filter(Boolean);
  if (!known.length) return null;
  return sessionCalendar({ anchor: SESSION_ANCHOR, closed: known.flatMap(c => c.closed), through: known.map(c => c.through).sort().at(-1) });
}
const nextDay = date => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
// Extends the known calendar (fixed base, plus a prior snapshot's) with the
// official sessions of a window: a weekday without a session is a closure. A
// gap between the known part and the window is bridged only by the official
// holiday calendar (`official.isOpen(date)`: true/false, null when unknown);
// otherwise the calendar stays at what is known (see sessionCalendarCovers).
export function calendarFromSessions(dates, prior = null, { official = null } = {}) {
  const known = mergeCalendars(BASE_SESSION_CALENDAR, prior), sessions = [...new Set((dates || []).filter(d => ISO.test(d)))].sort();
  if (!sessions.length || sessions.at(-1) <= known.through) return known;
  const closed = new Set(known.closed);
  for (let date = nextDay(known.through); date < sessions[0]; date = nextDay(date)) {
    if (!isWeekday(date)) continue;
    const open = official?.isOpen?.(date);
    if (open !== true && open !== false) return known;
    if (!open) closed.add(date);
  }
  const open = new Set(sessions), through = sessions.at(-1);
  for (let date = nextDay(known.through); date <= through; date = nextDay(date)) if (date >= sessions[0] && isWeekday(date) && !open.has(date)) closed.add(date);
  return sessionCalendar({ anchor: SESSION_ANCHOR, closed: [...closed], through });
}
// True when every weekday up to `date` is known (session numbers exact). When
// false, 2/3/5-day bars after `through` are grouped by weekday numbers until
// the snapshot's calendar is extended; screens say so (never drop the bars).
export const sessionCalendarCovers = (date, calendar = sharedCalendar) => !!date && !!calendar && (date < SESSION_ANCHOR || sessionCalendar(calendar)?.through >= date);
let sharedCalendar = BASE_SESSION_CALENDAR;
export function setSessionCalendar(value) { sharedCalendar = mergeCalendars(BASE_SESSION_CALENDAR, value); return sharedCalendar; }
export const currentSessionCalendar = () => sharedCalendar;
// Shown next to 2/3/5-day bars whose dates are beyond the known calendar.
export const SESSION_FALLBACK_NOTE = '交易日曆待更新，2/3/5 日 K 暫以平日序號分組';
export const sessionFrameNote = (frame, date, calendar = sharedCalendar) => ['2D', '3D', '5D'].includes(frame) && date && !sessionCalendarCovers(date, calendar) ? SESSION_FALLBACK_NOTE : '';
// undefined: the page's calendar; null: no closure known; otherwise a
// snapshot calendar, always completed with the fixed base.
const resolveCalendar = value => value === undefined ? sharedCalendar : value === null ? null : mergeCalendars(BASE_SESSION_CALENDAR, value);
const WEEKDAYS_ONLY = Object.freeze({ anchor: SESSION_ANCHOR, closed: [], through: SESSION_ANCHOR });
function sessionOrdinal(date, calendar) {
  let closed = 0; for (const d of calendar.closed) { if (d >= date) break; closed++; }
  return weekdayIndex(date) - weekdayIndex(SESSION_ANCHOR) - closed;
}
// Every date from the anchor maps to its market session number (weekdays minus
// known closures; `calendar: null` means no closure is known). Before the
// anchor, where closures are not kept, the stock's own bars are counted back.
function sessionOrdinals(daily, calendar) {
  const found = daily.findIndex(c => c.date >= SESSION_ANCHOR), first = found < 0 ? daily.length : found;
  return daily.map((c, i) => i < first ? i - first : sessionOrdinal(c.date, calendar));
}
function sessionGroups(daily, count, asOf, calendar, combine) {
  if (!daily.length) return [];
  calendar = calendar || WEEKDAYS_ONLY;
  const ordinals = sessionOrdinals(daily, calendar), groups = new Map();
  daily.forEach((c, i) => { const key = Math.floor(ordinals[i] / count); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); });
  const current = asOf >= SESSION_ANCHOR ? sessionOrdinal(asOf, calendar) : null;
  return [...groups].filter(([key, bars]) => {
    // A group that began before the available history is incomplete.
    if (key * count < ordinals[0]) return false;
    // Market sessions decide completion; a suspended stock keeps its traded days.
    if (key >= 0 && current !== null) return current >= (key + 1) * count - 1;
    return bars.length === count;
  }).map(([, bars]) => combine(bars));
}

// Completed official weeks/months that precede the daily window travel with a
// snapshot as compact rows [date, open, high, low, close, volume(, turnover)].
// They are only combined (2W) or shown (1M); never used to invent daily bars.
export function expandHistory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (!Array.isArray(row) || !ISO.test(row[0])) return [];
    const [date, open, high, low, close, volume, quoteVolume] = row;
    if (![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, low, close) <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0) return [];
    return [{ date, time: Date.parse(date + 'T00:00:00+08:00') / 1000, open, high, low, close, volume, quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : null }];
  }).sort((a, b) => a.time - b.time);
}
// Bars rebuilt from the daily window win; history fills earlier periods and a
// boundary period that the window holds only partially.
function mergeHistory(history, recent) {
  if (!history.length) return recent;
  const merged = new Map(history.map(c => [c.date, c]));
  for (const c of recent) merged.set(c.date, c);
  return [...merged.values()].sort((a, b) => a.time - b.time);
}

// Algorithm 5/6 snapshots (published before the fixed session anchor) located
// their named shapes on these bars: 2/3/5-day groups cut back from the newest
// bar, every week (incl. a partial first one), complete-only 2W pairs and the
// month rule of that version. Bars of such a snapshot are rebuilt exactly so,
// so its shapes keep their positions until a version-7 snapshot replaces it.
function legacyWeeklyCandles(daily, asOf, now) {
  const groups = new Map(), local = new Date(now + 8 * 3600000), thisWeek = weekStart(local.toISOString().slice(0, 10)), day = local.getUTCDay();
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
export function legacyAggregateCandles(daily,frame,asOf,now=Date.now()) {
 if(frame==='1D')return daily;
 if(frame==='1W')return legacyWeeklyCandles(daily,asOf,now);
 const combine=(bars,date=bars[0].date)=>({date,time:Date.parse(date+'T00:00:00+08:00')/1000,lastDate:bars.at(-1).lastDate||bars.at(-1).date,open:bars[0].open,high:Math.max(...bars.map(c=>c.high)),low:Math.min(...bars.map(c=>c.low)),close:bars.at(-1).close,volume:bars.reduce((n,c)=>n+c.volume,0),quoteVolume:bars.every(c=>Number.isFinite(c.quoteVolume))?bars.reduce((n,c)=>n+c.quoteVolume,0):null});
 if(frame==='1M') {const months=new Map();for(const c of daily){const month=c.date.slice(0,7);if(month>=asOf.slice(0,7)||month===daily[0]?.date.slice(0,7))continue;if(!months.has(month))months.set(month,[]);months.get(month).push(c);}return [...months].map(([month,bars])=>combine(bars,month+'-01'));}
 if(frame==='2W'){const weeks=legacyWeeklyCandles(daily,asOf,now),groups=new Map();for(const c of weeks){const anchor=Math.floor((Date.parse(c.date+'T00:00:00Z')-MONDAY)/(14*86400000));if(!groups.has(anchor))groups.set(anchor,[]);groups.get(anchor).push(c);}return [...groups.values()].filter(b=>b.length===2).map(b=>combine(b));}
 const count=Number(frame.slice(0,-1));if(![2,3,5].includes(count))throw Error('Unsupported Taiwan timeframe');
 const complete=[];const offset=daily.length%count;for(let i=offset;i+count<=daily.length;i+=count)complete.push(combine(daily.slice(i,i+count)));return complete;
}

// Combine genuine daily bars; never split a daily OHLC into intraday candles.
export function aggregateCandles(daily,frame,asOf,now=Date.now(),options={}) {
 if(frame==='1D')return daily;
 if(options.legacy)return legacyAggregateCandles(daily,frame,asOf,now);
 const calendar=resolveCalendar(options.calendar);
 if(frame==='1W')return weeklyCandles(daily,asOf,now,{calendar});
 const combine=(bars,date=bars[0].date)=>({date,time:Date.parse(date+'T00:00:00+08:00')/1000,lastDate:bars.at(-1).lastDate||bars.at(-1).date,open:bars[0].open,high:Math.max(...bars.map(c=>c.high)),low:Math.min(...bars.map(c=>c.low)),close:bars.at(-1).close,volume:bars.reduce((n,c)=>n+c.volume,0),quoteVolume:bars.every(c=>Number.isFinite(c.quoteVolume))?bars.reduce((n,c)=>n+c.quoteVolume,0):null});
 if(frame==='1M') {
  // A month is complete once its last possible session has closed (asOf on or
  // after it, or asOf already in a later month). The first month is dropped
  // only when the history begins after that month's first session.
  const months=new Map(),current=asOf.slice(0,7),currentDone=monthClosed(asOf,calendar),first=daily[0]?.date;
  const partialFirst=first&&!startsPeriod(first,first.slice(0,7)+'-01',calendar)?first.slice(0,7):null;
  for(const c of daily){const month=c.date.slice(0,7);if(month>current||month===current&&!currentDone||month===partialFirst)continue;if(!months.has(month))months.set(month,[]);months.get(month).push(c);}
  return mergeHistory(expandHistory(options.history?.months),[...months].map(([month,bars])=>combine(bars,month+'-01')));
 }
 if(frame==='2W'){
  // Fixed two-week periods from Monday 1970-01-05. A period whose other week
  // was entirely closed (e.g. Lunar New Year) is still a real two-week bar.
  const weeks=mergeHistory(expandHistory(options.history?.weeks),weeklyCandles(daily,asOf,now,{calendar})),groups=new Map(),span=14*86400000;
  for(const c of weeks){const anchor=Math.floor((Date.parse(c.date+'T00:00:00Z')-MONDAY)/span);if(!groups.has(anchor))groups.set(anchor,[]);groups.get(anchor).push(c);}
  const lastWeek=completedWeek(asOf,now);
  return [...groups].flatMap(([anchor,bars])=>{const start=new Date(MONDAY+anchor*span).toISOString().slice(0,10),second=new Date(MONDAY+anchor*span+7*86400000).toISOString().slice(0,10);
   // History that begins in the second week cannot form this period; the
   // period is complete only after its second week has closed.
   return start<weeks[0].date||second>lastWeek?[]:[combine(bars,start)];});
 }
 const count=Number(frame.slice(0,-1));if(![2,3,5].includes(count))throw Error('Unsupported Taiwan timeframe');
 return sessionGroups(daily,count,asOf,calendar,combine);
}
