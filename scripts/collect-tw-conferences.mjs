// Collects investor conferences (MOPS list) for the next 14 days plus the
// ones already held, with their price reaction against the TAIEX.
//   node scripts/collect-tw-conferences.mjs [--out path]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MOPS_LIST_URL, MOPS_MARKETS, TAIEX_URL, parseConferenceList, parseTaiex, priceReaction, monthsAround, CHART_SPAN } from '../server/markets/tw/conferences.js';

const root = new URL('../', import.meta.url);
const flag = process.argv.indexOf('--out');
const out = flag >= 0 ? pathToFileURL(resolve(process.argv[flag + 1])) : new URL('data/tw-conferences.json', root);
const UPCOMING_DAYS = 14, KEEP_DAYS = 180;
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = { 'User-Agent': 'Mozilla/5.0 OX-Market-Command-Center', Accept: 'text/html,application/json' };

async function attempt(load, label) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await load(); } catch (error) { last = error; console.warn(`${label}: attempt ${i + 1} failed: ${error.message}`); await sleep(5000 * (i + 1)); }
  }
  throw last;
}
async function mopsMonth(type, year, month) {
  return attempt(async () => {
    const body = new URLSearchParams({ encodeURIComponent: '1', step: '1', firstin: '1', off: '1', TYPEK: type, year: String(year - 1911), month: String(month), co_id: '' });
    const response = await fetch(MOPS_LIST_URL, { method: 'POST', body, headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(90000) });
    const html = await response.text();
    if (!response.ok || !/公開資訊觀測站/.test(html)) throw Error(`HTTP ${response.status}`);
    if (!/<\/html>/i.test(html)) throw Error('truncated MOPS response');
    return parseConferenceList(html, MOPS_MARKETS[type]);
  }, `MOPS ${type} ${year}-${month}`);
}
async function taiexMonth(month) {
  return attempt(async () => {
    const response = await fetch(`${TAIEX_URL}?response=json&date=${month.replace('-', '')}01`, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return parseTaiex(await response.json(), month);
  }, `TAIEX ${month}`);
}
async function packCloses() {
  const dir = new URL('data/tw-patterns/', root), manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8')), closes = new Map();
  for (const file of (await readdir(dir)).filter(f => /^daily-\d+\.json\.gz$/.test(f))) {
    const chunk = JSON.parse(gunzipSync(await readFile(new URL(file, dir))));
    if (chunk.date !== manifest.date) continue;
    for (const entry of chunk.entries) closes.set(entry.data.symbol, new Map(entry.data.candles.map(c => [c.date, c.close])));
  }
  return { date: manifest.date, closes };
}

const today = taipeiToday(), prior = await readFile(out, 'utf8').then(JSON.parse).catch(() => null);
const fetched = [], sources = [];
for (const [year, month] of monthsAround(today)) {
  for (const type of Object.keys(MOPS_MARKETS)) {
    const key = `${MOPS_MARKETS[type]}:${year}-${String(month).padStart(2, '0')}`;
    try { const rows = await mopsMonth(type, year, month); fetched.push(...rows); sources.push({ key, ok: true, count: rows.length }); }
    catch (error) { sources.push({ key, ok: false, error: error.message.slice(0, 120) }); }
    await sleep(3000);
  }
}
if (!sources.some(s => s.ok)) { console.error('No MOPS month could be read; the previous file is kept.'); process.exit(1); }
// Months read now replace their earlier rows; failed months keep the last good rows.
const refreshed = new Set(sources.filter(s => s.ok).map(s => s.key));
const kept = (prior?.items || []).filter(item => !refreshed.has(`${item.market}:${item.date.slice(0, 7)}`));
const byId = new Map([...kept, ...fetched].map(item => [item.id, item]));
const items = [...byId.values()].filter(item => item.date >= addDays(today, -KEEP_DAYS) && item.date <= addDays(today, UPCOMING_DAYS));

// Index sessions from 10 sessions before the earliest conference to today.
const first = items.map(i => i.date).sort()[0] || today, months = [];
for (let m = addDays(first, -31).slice(0, 7); m <= today.slice(0, 7); m = addDays(`${m}-01`, 32).slice(0, 7)) months.push(m);
const index = new Map();
for (const month of months) { for (const row of await taiexMonth(month)) index.set(row.date, row.close); await sleep(1500); }
const days = [...index.keys()].sort();
const pack = await packCloses();
for (const item of items) {
  const reaction = priceReaction(item, days, pack.closes.get(item.symbol) || new Map(), index);
  item.reaction = { ...reaction, stockAvailable: pack.closes.has(item.symbol) };
}
items.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.symbol.localeCompare(b.symbol));
const result = {
  generatedAt: new Date().toISOString(), today, upcomingDays: UPCOMING_DAYS, keepDays: KEEP_DAYS, chartSpan: CHART_SPAN,
  source: { list: '公開資訊觀測站・法人說明會一覽表（ajax_t100sb02_1）', listUrl: MOPS_LIST_URL, index: '臺灣證券交易所・發行量加權股價指數歷史資料（MI_5MINS_HIST）收盤指數', indexUrl: TAIEX_URL, prices: `官方日 K 線包 data/tw-patterns（資料日 ${pack.date}）`, indexDate: days.at(-1) || null, priceDate: pack.date },
  months: sources, items
};
await writeFile(out, JSON.stringify(result) + '\n');
console.log(`Conferences: ${items.length} (${sources.filter(s => s.ok).length}/${sources.length} MOPS months), index to ${days.at(-1)}, prices to ${pack.date}`);
