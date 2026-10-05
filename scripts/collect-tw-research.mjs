import { readFile, writeFile } from 'node:fs/promises';
import { getOfficialTWResearch } from '../server/markets/tw/research-provider.js';
import { getOfficialTWMarketPulse } from '../api/v1/tw/providers/official.js';
import { aggregateSectors, enrichResearch, officialJSON } from '../server/markets/tw/research.js';
import { collectHistoryDay } from '../server/markets/tw/research-history.js';
import { tradingCalendar } from '../server/markets/tw/surveillance.js';
const historyFile = new URL('../data/tw-research-history.json', import.meta.url);
let history = [];
try { history = JSON.parse(await readFile(historyFile,'utf8')); } catch {}
const [result,pulse] = await Promise.allSettled([getOfficialTWResearch(),getOfficialTWMarketPulse()]);
if(result.status !== 'fulfilled') throw result.reason;
const snapshot = result.value;
console.log(JSON.stringify({date:snapshot.date, stocks:snapshot.stocks.length, sourceHealth:snapshot.sourceHealth, covered:snapshot.stocks.filter(s=>s.netTwd!==null).length}));
if (!snapshot.stocks.length) throw new Error('No verified official quotes; previous snapshot retained');
if(pulse.status==='fulfilled') snapshot.pulse = pulse.value.pulse;
const companies = new Map(snapshot.stocks.map(s=>[`${s.market}:${s.symbol}`,s]));
if (process.argv.includes('--backfill')) {
  const calendar = tradingCalendar(await officialJSON('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'));
  if (!calendar) throw new Error('Official trading calendar unavailable');
  const cursor = new Date(`${snapshot.date}T00:00:00Z`);
  let sessions = 1;
  for(let i=0;i<60 && sessions<20;i++) {
    cursor.setUTCDate(cursor.getUTCDate()-1); const date=cursor.toISOString().slice(0,10);
    const open = calendar.isOpen(date);
    if (open === null) throw new Error('Trading calendar does not cover requested year');
    if (!open) continue;
    sessions++;
    if (history.some(d=>d.date===date && d.sectors?.length)) continue;
    let day = { date, sectors: [], unavailable: true };
    try { day=await collectHistoryDay(date,companies);console.log(`History ${date}: ${day.sectors.length} sectors`); }
    catch(e){console.log(`History ${date}: unavailable (${e.message})`);}
    history = history.filter(d=>d.date!==date); history.push(day);
    await writeFile(historyFile,JSON.stringify(history));
  }
}
history = [...new Map([...history,{date:snapshot.date,sectors:aggregateSectors(snapshot.stocks)}].map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
await writeFile(historyFile,JSON.stringify(history));
await writeFile(new URL('../data/tw-research.json',import.meta.url),JSON.stringify(enrichResearch(snapshot,history)));
console.log(`Saved ${snapshot.stocks.length} stocks; ${history.length} trading dates.`);
