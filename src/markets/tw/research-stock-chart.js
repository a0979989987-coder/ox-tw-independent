import { escape, number } from './research-ui.js';
import { dailyCandles } from './patterns/model.js';
import { aggregateChartCandles } from './chart-data.js?v=20261001-loading1';

export function stockDetailCandles(daily, frame, date) {
  return aggregateChartCandles(dailyCandles(daily, date), frame, date).slice(-100);
}

// A real OHLC overview with readable price/date axes, not the tiny radar sparkline.
export function stockDetailChart(candles, name = '') {
  if (!candles.length) return '';
  const width = 620, height = 350, left = 10, right = 84, top = 16, bottom = 32;
  const low = Math.min(...candles.map(c => c.low)), high = Math.max(...candles.map(c => c.high));
  const pad = Math.max((high - low) * .08, Math.abs(high) * .002, .01), min = low - pad, max = high + pad;
  const plotWidth = width - left - right, plotHeight = height - top - bottom, step = plotWidth / candles.length;
  const y = price => top + (max - price) / (max - min) * plotHeight;
  const x = i => left + (i + .5) * step;
  const ticks = Array.from({ length: 4 }, (_, i) => {
    const value = max - (max - min) * i / 3, py = y(value);
    return `<line class="twx-candle-grid" x1="${left}" x2="${width - right}" y1="${py}" y2="${py}"/><text x="${width - right + 10}" y="${py + 4}">${number(value)}</text>`;
  }).join('');
  const bars = candles.map((c, i) => {
    const px = x(i), body = Math.max(.8, Math.min(7, step * .65));
    return `<g class="${c.close >= c.open ? 'twx-candle-up' : 'twx-candle-down'}"><title>${escape(c.date)} 開 ${number(c.open)} 高 ${number(c.high)} 低 ${number(c.low)} 收 ${number(c.close)}</title><path d="M${px} ${y(c.high)}V${y(c.low)}"/><rect x="${px - body / 2}" y="${Math.min(y(c.open), y(c.close))}" width="${body}" height="${Math.max(1, Math.abs(y(c.open) - y(c.close)))}"/></g>`;
  }).join('');
  const dates = [...new Set([0, Math.floor((candles.length - 1) / 2), candles.length - 1])].map((i, index, list) =>
    `<text x="${index === 0 ? left : index === list.length - 1 ? width - right : x(i)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === list.length - 1 ? 'end' : 'middle'}">${escape(candles[i].date)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(name)} 官方 K 線，${candles.length} 根"><g class="twx-candle-labels">${ticks}${dates}</g>${bars}</svg>`;
}
