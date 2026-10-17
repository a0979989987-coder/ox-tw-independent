import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {aggregateCandles,calendarFromSessions,sessionCalendar,sessionCalendarCovers,sessionFrameNote,BASE_SESSION_CALENDAR,SESSION_ANCHOR} from '../src/markets/tw/patterns/model.js';

// Fixed copy of a real official snapshot (TWSE／TPEx daily OHLC, 2026-10-14)
// in tests/fixtures; the daily data/ commits never change these tests.
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const asOf=fixture.date,now=Date.parse(asOf+'T10:00:00Z');
const manifest={date:asOf,dates:fixture.sessions.filter(d=>d<=asOf)};
const entry=fixture.entries.find(e=>e.data.candles.length===manifest.dates.length);
const daily=entry.data.candles;
const calendar=calendarFromSessions(manifest.dates);
const key=bar=>`${bar.date}|${bar.lastDate}|${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume}`;
const weekdaysWithout=(sessions,from,to)=>{const set=new Set(sessions),out=[];for(let d=new Date(from+'T00:00:00Z');d.toISOString().slice(0,10)<=to;d.setUTCDate(d.getUTCDate()+1)){const x=d.toISOString().slice(0,10),w=d.getUTCDay();if(w&&w<6&&!set.has(x))out.push(x);}return out;};

test('the fixed base calendar equals the closures of the official sessions since the anchor',()=>{
  assert.equal(fixture.sessions[0],SESSION_ANCHOR);
  assert.deepEqual(BASE_SESSION_CALENDAR.closed,weekdaysWithout(fixture.sessions,SESSION_ANCHOR,BASE_SESSION_CALENDAR.through));
  assert.ok(calendar.closed.includes('2026-02-16')&&calendar.closed.includes('2026-07-10'));
  assert.ok(!calendar.closed.some(d=>manifest.dates.includes(d)));
  assert.equal(sessionCalendar({anchor:'2020-01-02',closed:[]}),null);
});

test('session numbers do not depend on the window reaching the anchor or on a prior calendar',()=>{
  // A window that starts months after the anchor, first run (no prior calendar).
  const late=calendarFromSessions(manifest.dates.slice(120));
  assert.deepEqual(late,calendar);assert.equal(sessionCalendarCovers(asOf,late),true);
  // A carried calendar is extended by later sessions only.
  const carried=calendarFromSessions(manifest.dates.slice(5),{...calendar,through:manifest.dates[20]});
  assert.deepEqual(carried.closed,calendar.closed);
  // Years later without a prior calendar: the gap is bridged by the official
  // holiday calendar when it is known...
  const later=['2028-03-01','2028-03-02','2028-03-06'];
  const gap=calendarFromSessions(later,null,{official:{isOpen:date=>date==='2027-02-08'?false:true}});
  assert.equal(gap.through,'2028-03-06');assert.ok(gap.closed.includes('2027-02-08')&&gap.closed.includes('2028-03-03'));
  // ...otherwise it stays at what is known, and screens say so.
  const unknown=calendarFromSessions(later,null,{official:{isOpen:()=>null}});
  assert.deepEqual(unknown,BASE_SESSION_CALENDAR);
  assert.equal(sessionCalendarCovers('2028-03-06',unknown),false);
  assert.match(sessionFrameNote('2D','2028-03-06',unknown),/平日序號/);
  assert.equal(sessionFrameNote('2D','2026-10-14',unknown),'');assert.equal(sessionFrameNote('1W','2028-03-06',unknown),'');
});

test('the same 2/3/5-day bars whether the window reaches the anchor or not',()=>{
  const late=calendarFromSessions(manifest.dates.slice(60));
  for(const frame of ['2D','3D','5D']){
    const full=aggregateCandles(daily,frame,asOf,now,{calendar}).map(key),window=aggregateCandles(daily.slice(60),frame,asOf,now,{calendar:late}).map(key);
    assert.ok(window.length>10);
    assert.deepEqual(window,full.slice(full.length-window.length),frame);
  }
});

test('without any closure knowledge 2/3/5-day bars fall back to weekday numbers, still stable',()=>{
  for(const frame of ['2D','3D','5D']){
    const bars=aggregateCandles(daily,frame,asOf,now,{calendar:null});
    assert.ok(bars.length>10,frame+' never disappears');
    const before=new Map(aggregateCandles(daily.slice(0,-3),frame,manifest.dates.at(-4),now,{calendar:null}).map(b=>[b.date,key(b)]));
    for(const bar of bars)if(before.has(bar.date))assert.equal(key(bar),before.get(bar.date),`${frame} ${bar.date}`);
  }
});

for(const frame of ['2D','3D','5D'])test(`${frame} historical bars keep their daily members when newer sessions arrive`,()=>{
  const count=Number(frame[0]);
  // Replay the same official history day by day over the last 12 sessions.
  let previous=null;
  for(let cut=daily.length-12;cut<=daily.length;cut++){
    const slice=daily.slice(0,cut),date=slice.at(-1).date;
    const bars=aggregateCandles(slice,frame,date,now,{calendar});
    if(previous){
      const before=new Map(previous.map(b=>[b.date,key(b)]));
      for(const bar of bars)if(before.has(bar.date))assert.equal(key(bar),before.get(bar.date),`${frame} ${bar.date} changed after ${date}`);
      // Every earlier completed bar is still present.
      for(const old of previous)assert.ok(bars.some(b=>b.date===old.date),`${frame} ${old.date} disappeared`);
    }
    previous=bars;
    // Each bar starts on a session numbered from the fixed anchor.
    for(const bar of bars){const i=manifest.dates.indexOf(bar.date)-manifest.dates.indexOf(SESSION_ANCHOR);assert.equal(i%count,0,`${frame} ${bar.date} not on an anchored boundary`);}
  }
  // Trimming the oldest history (sliding window) does not regroup later bars.
  const trimmed=aggregateCandles(daily.slice(7),frame,asOf,now,{calendar}),full=new Map(aggregateCandles(daily,frame,asOf,now,{calendar}).map(b=>[b.date,key(b)]));
  for(const bar of trimmed)assert.equal(key(bar),full.get(bar.date));
});

test('the still-forming multi-session group is withheld until its last session closes',()=>{
  const sessions=manifest.dates,anchorAt=sessions.indexOf(SESSION_ANCHOR);
  // Find a date that is the first session of a 3-session group.
  const start=sessions.findLastIndex((d,i)=>(i-anchorAt)%3===0&&i<sessions.length-3);
  const upTo=i=>daily.filter(c=>c.date<=sessions[i]);
  assert.ok(!aggregateCandles(upTo(start+1),'3D',sessions[start+1],now,{calendar}).some(b=>b.date===sessions[start]));
  const done=aggregateCandles(upTo(start+2),'3D',sessions[start+2],now,{calendar}).find(b=>b.date===sessions[start]);
  assert.equal(done.lastDate,sessions[start+2]);
  assert.equal(done.volume,upTo(start+2).slice(-3).reduce((n,c)=>n+c.volume,0));
});

test('a stock that skipped a session keeps the traded days of that group',()=>{
  const sessions=manifest.dates,anchorAt=sessions.indexOf(SESSION_ANCHOR);
  const start=sessions.findIndex((d,i)=>i>anchorAt+20&&(i-anchorAt)%2===0);
  const suspended=daily.filter(c=>c.date!==sessions[start+1]);
  const bar=aggregateCandles(suspended,'2D',asOf,now,{calendar}).find(b=>b.date===sessions[start]);
  assert.equal(bar.lastDate,sessions[start]);
  // Later groups are not shifted by the missing day.
  const later=aggregateCandles(suspended,'2D',asOf,now,{calendar}).find(b=>b.date===sessions[start+2]);
  assert.equal(later.lastDate,sessions[start+3]);
});

test('2W keeps a two-week period whose other week was the 2026-02-16 Lunar New Year closure',()=>{
  assert.ok(calendar.closed.includes('2026-02-16')&&!manifest.dates.some(d=>d>='2026-02-16'&&d<='2026-02-20'));
  const bars=aggregateCandles(daily,'2W',asOf,now,{calendar});
  const holiday=bars.find(b=>b.date==='2026-02-16');
  assert.ok(holiday,'the period 2026-02-16～03-01 must not be dropped');
  const members=daily.filter(c=>c.date>='2026-02-16'&&c.date<='2026-03-01');
  assert.ok(members.length>0&&members.every(c=>c.date>='2026-02-23'));
  assert.equal(holiday.open,members[0].open);assert.equal(holiday.close,members.at(-1).close);
  assert.equal(holiday.high,Math.max(...members.map(c=>c.high)));assert.equal(holiday.low,Math.min(...members.map(c=>c.low)));
  assert.equal(holiday.volume,members.reduce((n,c)=>n+c.volume,0));assert.equal(holiday.lastDate,members.at(-1).date);
  // Periods are contiguous two-week steps from the fixed Monday anchor.
  for(let i=1;i<bars.length;i++)assert.equal(Date.parse(bars[i].date)-Date.parse(bars[i-1].date),14*86400000);
});

test('2W and 1W withhold the still-open week and drop a first week that began before the history',()=>{
  // History starts Thursday 2026-01-15: that week (from 01-12) is incomplete.
  assert.ok(!aggregateCandles(daily,'1W',asOf,now,{calendar}).some(b=>b.date==='2026-01-12'));
  assert.equal(aggregateCandles(daily,'1W',asOf,now,{calendar})[0].date,'2026-01-19');
  // Wednesday 2026-10-14 (Taipei): the week of 10-12 and its period are open.
  const wed=Date.parse('2026-10-14T10:00:00Z');
  const open=aggregateCandles(daily,'2W',asOf,wed,{calendar});
  assert.ok(!open.some(b=>b.date>='2026-10-12'));assert.ok(!aggregateCandles(daily,'1W',asOf,wed,{calendar}).some(b=>b.date==='2026-10-12'));
  // The period 09-28～10-11 closed on 10-08 (10-09 was a market holiday).
  assert.equal(open.at(-1).date,'2026-09-28');assert.equal(open.at(-1).lastDate,'2026-10-08');
  // Before its second week closes the same period is still withheld.
  const thu=daily.filter(c=>c.date<='2026-10-01');
  assert.ok(!aggregateCandles(thu,'2W','2026-10-01',Date.parse('2026-10-01T10:00:00Z'),{calendar}).some(b=>b.date==='2026-09-28'));
});

test('1M counts a month as complete on its last session and keeps a complete first month',()=>{
  const sept=daily.filter(c=>c.date<='2026-09-30');
  const bars=aggregateCandles(sept,'1M','2026-09-30',Date.parse('2026-09-30T10:00:00Z'),{calendar});
  const september=bars.find(b=>b.date==='2026-09-01'),members=sept.filter(c=>c.date.startsWith('2026-09'));
  assert.ok(september,'September is complete once 09-30 has closed');
  assert.equal(september.close,members.at(-1).close);assert.equal(september.volume,members.reduce((n,c)=>n+c.volume,0));
  // One session earlier September is still forming.
  assert.ok(!aggregateCandles(daily.filter(c=>c.date<='2026-09-29'),'1M','2026-09-29',now,{calendar}).some(b=>b.date==='2026-09-01'));
  // October (asOf 10-14) is in progress; history began mid-January (incomplete).
  const all=aggregateCandles(daily,'1M',asOf,now,{calendar});
  assert.ok(!all.some(b=>b.date==='2026-10-01'||b.date==='2026-01-01'));assert.equal(all[0].date,'2026-02-01');
  // A history that starts on a month's first session keeps that month.
  const fromFeb=daily.filter(c=>c.date>='2026-02-02');
  assert.equal(aggregateCandles(fromFeb,'1M',asOf,now,{calendar})[0].date,'2026-02-01');
  // February's last weekday (02-27) was a market holiday: 02-26 closes it.
  assert.ok(calendar.closed.includes('2026-02-27'));
  const feb=daily.filter(c=>c.date<='2026-02-26');
  assert.ok(aggregateCandles(feb,'1M','2026-02-26',now,{calendar}).some(b=>b.date==='2026-02-01'));
  // Without a verified calendar the holiday is unknown: February waits for March.
  assert.ok(!aggregateCandles(feb,'1M','2026-02-26',now,{calendar:null}).some(b=>b.date==='2026-02-01'));
});

test('a 185-session window always leaves 35 complete 5-day bars, whatever the day',async()=>{
  const {WINDOW_SESSIONS,sessionWindow}=await import('../server/markets/tw/pattern-snapshot.js');
  // Weekday sessions with no closure known (calendar null): every alignment of the window.
  const weekdays=[];for(let d=new Date('2027-01-04T00:00:00Z');weekdays.length<WINDOW_SESSIONS+10;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6)weekdays.push(d.toISOString().slice(0,10));
  const bar=date=>({date,time:Date.parse(date+'T00:00:00+08:00')/1000,open:10,high:11,low:9,close:10,volume:1,quoteVolume:1});
  for(let shift=0;shift<10;shift++){
    const window=weekdays.slice(shift,shift+WINDOW_SESSIONS).map(bar),asOf=window.at(-1).date;
    assert.ok(aggregateCandles(window,'5D',asOf,Date.parse(asOf+'T10:00:00Z'),{calendar:null}).length>=35,'shift '+shift);
  }
  // The window does not shrink when the official schedule does not list a
  // span (as last year's days in January): the known calendar covers it.
  const weekday=date=>![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());
  const official={isOpen:date=>date>='2026-02-01'&&date<='2026-09-30'?null:weekday(date)&&!['2026-01-01','2026-10-09'].includes(date)};
  const dates=sessionWindow('2026-10-15',{official});
  assert.equal(dates.length,WINDOW_SESSIONS);assert.equal(dates[0],'2026-10-15');
  assert.ok(!dates.some(d=>BASE_SESSION_CALENDAR.closed.includes(d)),'known closures are not sessions');
  assert.deepEqual(dates.filter(d=>d>=SESSION_ANCHOR).reverse(),fixture.sessions);
  // Neither source knows a day: the window stops there instead of guessing.
  assert.ok(sessionWindow('2026-10-15',{official:{isOpen:date=>date>='2026-10-01'?weekday(date):null}}).length<WINDOW_SESSIONS);
});
