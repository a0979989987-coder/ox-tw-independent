import { aggregateThemes } from '../src/markets/tw/sector-groups.js';
import { SECTOR_TAXONOMY_VERSION } from '../src/markets/tw/sector-taxonomy.js';
import { readFile, writeFile } from 'node:fs/promises';
import { getOfficialTWResearch } from '../server/markets/tw/research-provider.js';
import { getOfficialTWMarketPulse } from '../api/v1/tw/providers/official.js';
import { aggregateSectors, enrichResearch, officialJSON, loadInstitutional, joinResearchStocks, RESEARCH_COVERAGE_VERSION } from '../server/markets/tw/research.js';
import { collectHistoryDay } from '../server/markets/tw/research-history.js';
import { tradingCalendar } from '../server/markets/tw/surveillance.js';
const historyFile = new URL('../data/tw-research-history.json', import.meta.url);
let history = [];
try { history = JSON.parse(await readFile(historyFile,'utf8')); } catch {}
const [result,pulse] = await Promise.allSettled([getOfficialTWResearch(),getOfficialTWMarketPulse()]);
if(result.status !== 'fulfilled') throw result.reason;
let snapshot = result.value;
if (!snapshot.sourceHealth?.TWSE?.complete || !snapshot.sourceHealth?.TPEX?.complete) {
  // Price closes can arrive before institutional reports. Keep the previous
  // published trading date while repairing its coverage, not a partial new day.
  const previous = JSON.parse(await readFile(new URL('../data/tw-research.json', import.meta.url), 'utf8'));
  const feeds = await Promise.all(['TWSE','TPEX'].map(market => loadInstitutional(previous.date, market)));
  if (feeds.some(feed => !feed.report.complete)) throw new Error('Complete dated institutional reports unavailable; published snapshot retained');
  const quotes = previous.stocks.map(stock => ({ ...stock, dataDate: previous.date }));
  snapshot = { ...previous, updatedAt: new Date().toISOString(), stocks: joinResearchStocks(quotes, feeds, previous.date), coverageVersion: RESEARCH_COVERAGE_VERSION,
    sourceHealth: Object.fromEntries(feeds.map(feed => [feed.report.market, { ...feed.report, ok: true }])) };
}
console.log(JSON.stringify({date:snapshot.date, stocks:snapshot.stocks.length, sourceHealth:snapshot.sourceHealth, covered:snapshot.stocks.filter(s=>s.netTwd!==null).length}));
if (!snapshot.stocks.length) throw new Error('No verified official quotes; previous snapshot retained');
if(pulse.status==='fulfilled' && result.value.date===snapshot.date) snapshot.pulse = pulse.value.pulse;
const companies = new Map(snapshot.stocks.map(s=>[`${s.market}:${s.symbol}`,s]));
if (process.argv.includes('--backfill')) {
  const calendar = tradingCalendar(await officialJSON('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'));
  if (!calendar) throw new Error('Official trading calendar unavailable');
  const cursor = new Date(`${snapshot.date}T00:00:00Z`);
  let sessions = 1;
  for(let i=0;i<90 && sessions<40;i++) {
    cursor.setUTCDate(cursor.getUTCDate()-1); const date=cursor.toISOString().slice(0,10);
    const open = calendar.isOpen(date);
    if (open === null) throw new Error('Trading calendar does not cover requested year');
    if (!open) continue;
    sessions++;
    if (history.some(d=>d.date===date && d.sectors?.length && d.themeVersion===SECTOR_TAXONOMY_VERSION && d.coverageVersion===RESEARCH_COVERAGE_VERSION && d.sourceHealth?.TWSE?.complete && d.sourceHealth?.TPEX?.complete && d.themes?.length===110)) continue;
    let day = history.find(day => day.date === date) || { date, sectors: [], unavailable: true };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { day=await collectHistoryDay(date,companies);console.log(`History ${date}: ${day.sectors.length} sectors`); break; }
      catch(e){console.log(`History ${date}: ${attempt < 3 ? 'retry' : 'unavailable'} (${e.message})`);}
    }
    history = history.filter(d=>d.date!==date); history.push(day);
    await writeFile(historyFile,JSON.stringify(history));
  }
}
history = [...new Map([...history,{date:snapshot.date,sectors:aggregateSectors(snapshot.stocks),themes:aggregateThemes(snapshot.stocks),themeVersion:SECTOR_TAXONOMY_VERSION,coverageVersion:RESEARCH_COVERAGE_VERSION,sourceHealth:snapshot.sourceHealth}].map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
await writeFile(historyFile,JSON.stringify(history));
await writeFile(new URL('../data/tw-research.json',import.meta.url),JSON.stringify(enrichResearch(snapshot,history)));
console.log(`Saved ${snapshot.stocks.length} stocks; ${history.length} trading dates.`);
