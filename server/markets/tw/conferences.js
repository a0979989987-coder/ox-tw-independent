// Investor conferences from the MOPS list (公開資訊觀測站・法人說明會一覽表)
// and their price reaction from official daily closes. Everything here is
// parsed or computed from official data; nothing is written by hand.
export const MOPS_LIST_URL = 'https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1';
export const MOPS_FILE_BASE = 'https://mopsov.twse.com.tw/nas/STR/';
export const TAIEX_URL = 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST';
export const MOPS_MARKETS = Object.freeze({ sii: 'TWSE', otc: 'TPEX' });
export const WINDOWS = Object.freeze([['pre10', -10], ['pre5', -5], ['day1', 1], ['post5', 5], ['post10', 10]]);
export const CHART_SPAN = 10;
const CLOSE_MINUTES = 13 * 60 + 30;

// The list escapes some symbols twice (&amp;#174;), so entities decode until stable.
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text) {
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(nbsp|amp|lt|gt|quot|apos));/gi, (all, dec, hex, name) => dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name.toLowerCase()]);
    if (next === text) break; text = next;
  }
  return text;
}
const clean = value => decode(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function rocDate(value) {
  const m = String(value ?? '').trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  const iso = `${Number(m[1]) + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : '';
}
const number = value => { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
// A slide cell names an uploaded file; anything else is a notice such as
// 「內容檔案於當日會後公告於公開資訊觀測站」.
function slide(cell) {
  const file = clean(cell);
  return /^[A-Za-z0-9_-]+\.(?:pdf|pptx?|docx?)$/i.test(file) ? { url: MOPS_FILE_BASE + file, note: null } : { url: null, note: file || null };
}

export function parseConferenceList(html, market) {
  if (/查無資料/.test(html) && !/<td/i.test(html)) return [];
  if (!/召開法人說明會日期/.test(html)) throw Error(`${market}: MOPS list layout not recognized`);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]));
  const result = [];
  for (const cells of rows) {
    const symbol = clean(cells[0]);
    if (!/^\d{4}[A-Z]?$/.test(symbol) || cells.length < 8) continue;
    const dates = clean(cells[2]).split(/\s*至\s*/).map(rocDate);
    const time = clean(cells[3]).match(/^(\d{1,2}):(\d{2})$/);
    if (!dates[0]) continue;
    const zh = slide(cells[6]), en = slide(cells[7]);
    result.push({
      id: `${market}:${symbol}:${dates[0]}:${time ? time[0] : ''}`,
      symbol, name: clean(cells[1]), market,
      date: dates[0], endDate: dates[1] && dates[1] !== dates[0] ? dates[1] : null,
      time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : null,
      location: clean(cells[4]) || null, summary: clean(cells[5]) || null,
      zhUrl: zh.url, enUrl: en.url, slideNote: zh.url || en.url ? null : zh.note || en.note
    });
  }
  return result;
}

export function parseTaiex(payload, month) {
  if (String(payload?.stat).toUpperCase() !== 'OK' || !Array.isArray(payload.data)) {
    if (/沒有符合條件|查無/.test(String(payload?.stat))) return [];
    throw Error(`TAIEX ${month}: official response unavailable`);
  }
  const at = Array.isArray(payload.fields) ? payload.fields.findIndex(f => String(f).includes('收盤')) : 4;
  return payload.data.flatMap(row => { const date = rocDate(row[0]), close = number(row[at]); return date && close > 0 ? [{ date, close }] : []; });
}

// The base is the last session that closed before the conference: the same
// day when it starts at or after 13:30, otherwise the previous session.
export function baseIndex(days, date, time) {
  const [h, m] = (time || '00:00').split(':').map(Number), afterClose = h * 60 + m >= CLOSE_MINUTES;
  let index = -1;
  for (let i = 0; i < days.length && (days[i] < date || afterClose && days[i] === date); i++) index = i;
  return index;
}

const change = (to, from) => Number.isFinite(to) && Number.isFinite(from) && from > 0 ? (to / from - 1) * 100 : null;
const round = value => value === null ? null : Math.round(value * 100) / 100;

// days: official trading days (TAIEX sessions), ascending. stock/index: Map date -> close.
// A window whose session is not in the data yet (not closed) stays null and is shown as "-".
export function priceReaction(conference, days, stock, index) {
  const empty = { baseDate: null, stock: {}, index: {}, excess: {}, series: [], eventDate: null };
  // After the last known session the base session is not known yet.
  if (!days.length || conference.date > days.at(-1)) return empty;
  const base = baseIndex(days, conference.date, conference.time);
  if (base < 0 || !stock.has(days[base])) return { ...empty, baseDate: base < 0 ? null : days[base] };
  const at = (map, offset) => { const day = days[base + offset]; return day ? map.get(day) ?? null : null; };
  const window = map => Object.fromEntries(WINDOWS.map(([key, offset]) => [key, round(offset < 0 ? change(at(map, 0), at(map, offset)) : change(at(map, offset), at(map, 0)))]));
  const s = window(stock), i = window(index);
  const excess = Object.fromEntries(WINDOWS.map(([key]) => [key, s[key] === null || i[key] === null ? null : round(s[key] - i[key])]));
  const series = [];
  for (let offset = -CHART_SPAN; offset <= CHART_SPAN; offset++) {
    const day = days[base + offset]; if (!day) continue;
    series.push({ date: day, offset, stock: round(change(stock.get(day), at(stock, 0))), index: round(change(index.get(day), at(index, 0))) });
  }
  // The conference falls on its own date, or the next session when that is not one.
  const eventDate = days.find(day => day >= conference.date) || null;
  return { baseDate: days[base], stock: s, index: i, excess, series, eventDate };
}

export function monthsAround(today) {
  const [y, m] = today.split('-').map(Number), next = m === 12 ? [y + 1, 1] : [y, m + 1];
  return [[y, m], next];
}
