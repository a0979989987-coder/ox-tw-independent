// Taiwan calendar events from official lists that cover every listed and OTC
// company: MOPS investor conferences, TWSE ex-rights/dividend results and
// MOPS dividend announcements (cash payment dates).
import { MOPS_MARKETS, parseConferenceList } from '../server/markets/tw/conferences.js';
import { base, rocDate, nullableNumber } from './news-providers.mjs';

const MOPS = 'https://mopsov.twse.com.tw/mops/web/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// One MOPS list query; MOPS answers slowly and sometimes cuts a response short.
export async function mopsPost(endpoint, form, { attempts = 3, timeoutMs = 90000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(MOPS + endpoint, { method: 'POST', body: new URLSearchParams({ encodeURIComponent: '1', step: '1', firstin: '1', off: '1', ...form }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 OX-Market-Command-Center' }, signal: AbortSignal.timeout(timeoutMs) });
      const html = await response.text();
      if (!response.ok || !/公開資訊觀測站/.test(html)) throw Error(`${endpoint}: HTTP ${response.status}`);
      if (!/<\/html>/i.test(html)) throw Error(`${endpoint}: truncated response`);
      return html;
    } catch (error) { last = error; await sleep(4000 * (i + 1)); }
  }
  throw last;
}

export function monthsBetween(today, from, to) {
  const [y, m] = today.split('-').map(Number), months = [];
  for (let offset = from; offset <= to; offset++) { const d = new Date(Date.UTC(y, m - 1 + offset, 1)); months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); }
  return months;
}

// Every conference in the MOPS list becomes a calendar event.
export function mopsConferenceEvents(rows, updatedAt) {
  return rows.map(row => {
    const company = row.name, title = `${company}（${row.symbol}）法說會`, start = row.time || '00:00';
    return {
      id: `mops-conference:${row.symbol}:${row.date}:${row.time || 'na'}`, kind: 'event', category: 'earnings', markets: ['tw'], company, symbol: row.symbol,
      title, titleZh: title, translationStatus: 'translated', shortTitle: `${company}法說`,
      date: row.time ? null : row.date, allDay: !row.time, occursAt: row.time ? new Date(`${row.date}T${start}:00+08:00`).toISOString() : null,
      endDate: row.endDate, originalTimezone: 'Asia/Taipei', location: row.location, description: row.summary,
      announcementStatus: 'confirmed', status: 'confirmed', sourceId: 'mops-conferences', source: '公開資訊觀測站・法說會',
      sourceUrl: `${MOPS}t100sb02_1`, link: `${MOPS}t100sb02_1`, documentUrl: row.zhUrl, englishDocumentUrl: row.enUrl, slideNote: row.slideNote,
      board: row.market, assets: [{ id: `tw:${row.symbol}`, market: 'tw', symbol: row.symbol, name: company }],
      impact: { stars: null, ruleVersion: 'unassessed-v1', reason: '官方一覽表未提供重要性分級' }, updatedAt
    };
  });
}
export async function collectMopsConferences(updatedAt, today, post = mopsPost, pause = 1500) {
  const rows = [], failures = [];
  for (const [year, month] of monthsBetween(today, -1, 2)) for (const type of Object.keys(MOPS_MARKETS)) {
    try { rows.push(...parseConferenceList(await post('ajax_t100sb02_1', { TYPEK: type, year: String(year - 1911), month: String(month), co_id: '' }), MOPS_MARKETS[type])); }
    catch (error) { failures.push(`${type} ${year}-${month}: ${error.message}`); }
    await sleep(pause);
  }
  if (failures.length) throw Error(`MOPS conference list incomplete: ${failures.join('; ')}`);
  // Listed companies hold conferences every month; an empty current month means the list was not read.
  if (!rows.some(row => row.market === 'TWSE' && row.date.slice(0, 7) === today.slice(0, 7))) throw Error('MOPS conference list has no listed company this month');
  return mopsConferenceEvents(rows, updatedAt);
}

// TWSE ex-rights/dividend results (除權除息計算結果表).
export function twseDividendResults(payload, updatedAt) {
  if (String(payload?.stat).toUpperCase() !== 'OK' || !Array.isArray(payload.fields) || !Array.isArray(payload.data)) {
    if (/沒有符合條件|查無/.test(String(payload?.stat))) return [];
    throw Error('TWSE TWT49U response unavailable');
  }
  const at = name => payload.fields.findIndex(f => String(f).replace(/\s/g, '') === name);
  const col = { date: at('資料日期'), symbol: at('股票代號'), name: at('股票名稱'), value: at('權值+息值'), kind: at('權/息') };
  if (Object.values(col).some(i => i < 0)) throw Error('TWSE TWT49U layout changed');
  const url = 'https://www.twse.com.tw/zh/trading/exright/twt49u.html';
  return payload.data.flatMap(row => {
    const date = rocDate(String(row[col.date]).replace(/年|月/g, '/').replace(/日/, '')), symbol = clean(row[col.symbol]), company = clean(row[col.name]), kind = clean(row[col.kind]);
    if (!date || !symbol || !company) return [];
    const label = kind === '息' ? '除息' : kind === '權' ? '除權' : '除權息';
    const value = nullableNumber(row[col.value]);
    return [{ ...base(`twse-dividends-daily:${symbol}:${date}`, 'twse-dividends-daily', url, `${company}（${symbol}）${label}`, date), category: 'dividend', shortTitle: `${company}${label}`,
      company, symbol, exDividendDate: date, cashDividend: kind === '息' ? value : null, stockDividend: null, totalDividend: value, paymentDate: null,
      assets: [{ id: `tw:${symbol}`, market: 'tw', symbol, name: company }], updatedAt }];
  });
}

// MOPS dividend announcement summary (t108sb27). Two header rows; the data
// columns follow them in order, ending with the cash payment date at index 11.
export function mopsDividendRows(html) {
  if (/查無資料/.test(html) && !/<td[^>]*>\s*\d{4}\s*</.test(html)) return [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => clean(c[1])));
  const sub = rows.find(r => r.includes('現金股利發放日'));
  if (!sub || sub.indexOf('除息交易日') !== 6 || sub.indexOf('現金股利發放日') !== 7) throw Error('MOPS dividend layout changed');
  return rows.filter(r => /^\d{4}[A-Z]?$/.test(r[0]) && r.length >= 17).map(r => ({
    symbol: r[0], name: r[1], period: r[2], recordDate: rocDate(r[3]), exDividendDate: rocDate(r[10]), paymentDate: rocDate(r[11]),
    cash: nullableNumber(r[7]), reserveCash: nullableNumber(r[8]), stock: nullableNumber(r[4]), announcedDate: rocDate(r[16])
  }));
}
export function mopsPaymentEvents(rows, updatedAt) {
  const seen = new Map();
  for (const row of rows) {
    if (!row.paymentDate) continue;
    const cash = row.cash === null && row.reserveCash === null ? null : (row.cash || 0) + (row.reserveCash || 0);
    const title = `${row.name}（${row.symbol}）現金股利發放`;
    // A later announcement for the same payment replaces the earlier one.
    seen.set(`${row.symbol}:${row.paymentDate}`, { ...base(`mops-payment:${row.symbol}:${row.paymentDate}`, 'mops-payments', `${MOPS}t108sb27`, title, row.paymentDate), category: 'payment', shortTitle: `${row.name}股利發放`,
      company: row.name, symbol: row.symbol, cashDividend: cash, exDividendDate: row.exDividendDate, paymentDate: row.paymentDate, dividendPeriod: row.period, announcedDate: row.announcedDate,
      assets: [{ id: `tw:${row.symbol}`, market: 'tw', symbol: row.symbol, name: row.name }], updatedAt });
  }
  return [...seen.values()];
}
export async function collectMopsPayments(updatedAt, today, post = mopsPost, pause = 1500) {
  const rows = [], failures = [];
  // Announcements come months before payment, so recent announcement months are read.
  for (const [year, month] of monthsBetween(today, -6, 0)) for (const type of Object.keys(MOPS_MARKETS)) {
    try { rows.push(...mopsDividendRows(await post('ajax_t108sb27', { TYPEK: type, year: String(year - 1911), month: String(month), b_date: '', e_date: '', type: '' }))); }
    catch (error) { failures.push(`${type} ${year}-${month}: ${error.message}`); }
    await sleep(pause);
  }
  if (failures.length) throw Error(`MOPS dividend list incomplete: ${failures.join('; ')}`);
  if (!rows.length) throw Error('MOPS dividend list returned no announcements');
  rows.sort((a, b) => String(a.announcedDate).localeCompare(String(b.announcedDate)));
  return mopsPaymentEvents(rows, updatedAt);
}
