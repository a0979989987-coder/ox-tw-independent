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
  for (const [frame, prepared] of [['1D', entry], ...Object.entries(entry.frames || {})]) {
    const candles = aggregateCandles(entry.data.candles, frame, date, now);
    const classic = classifyTWSeries(candles, frame);
    yield [frame, { classic, matches: qualifyPatternMatches({candles, classic,
      volatility: classic.long.atr || classic.short.atr || 0}, prepared.matches) }];
  }
}
function result(frames) {
  const { '1D': daily, ...other } = frames;
  return { ...daily, frames: other };
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
