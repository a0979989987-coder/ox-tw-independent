import { aggregateCandles } from './model.js';
import { classifyTWSeries } from '../classic.js';
import { qualifyPatternMatches } from '../../../components/patterns/matcher.js';

// Shared by the worker and the compatibility fallback: moving computation
// off the UI thread must not change a stock's grade or pattern eligibility.
export function validateBundleEntry(entry, date) {
  if (entry?.key !== entry?.data?.symbol + ':1D' || entry?.data?.dataDate !== date ||
      !Array.isArray(entry?.data?.candles) || entry.data.candles.length < 35 || !entry.matches) {
    throw Error('分類資料格式異常');
  }
}
function* steps(entry, date, now) {
  validateBundleEntry(entry, date);
  // Background workers do not share the page's session calendar; it travels
  // with the entry so both paths build identical multi-session bars.
  // Algorithm 5/6 snapshots keep their own bar grouping, so the named shapes
  // they published stay valid and are shown as before (legacy: true).
  const options = {history: entry.data.history, legacy: entry.legacyFrames === true, ...(entry.calendar === undefined ? {} : {calendar: entry.calendar})};
  // deferFrames: frames waiting for their separately published history (they
  // are computed once it arrives); onlyFrames: compute just these frames.
  const deferred = new Set(entry.deferFrames || []), only = Array.isArray(entry.onlyFrames) ? new Set(entry.onlyFrames) : null;
  for (const [frame, prepared] of [['1D', entry], ...Object.entries(entry.frames || {})]) {
    if (deferred.has(frame) || only && !only.has(frame)) continue;
    const candles = aggregateCandles(entry.data.candles, frame, date, now, options);
    const classic = classifyTWSeries(candles, frame);
    yield [frame, { classic, matches: qualifyPatternMatches({candles, classic,
      volatility: classic.long.atr || classic.short.atr || 0}, prepared.matches) }];
  }
}
function result(frames) {
  const { '1D': daily, ...other } = frames;
  return daily ? { ...daily, frames: other } : { frames: other };
}
export function qualifyBundleEntry(entry, date, now = Date.now()) {
  return result(Object.fromEntries(steps(entry, date, now)));
}
export async function qualifyBundleEntryCooperatively(entry, date, now = Date.now(),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))) {
  // Older/restricted webviews retain every grade, but yield between frames
  // instead of performing all daily/weekly calculations in one long task.
  const frames = {};
  await yieldTask();
  for (const [frame, value] of steps(entry, date, now)) {
    frames[frame] = value;
    await yieldTask();
  }
  return result(frames);
}
