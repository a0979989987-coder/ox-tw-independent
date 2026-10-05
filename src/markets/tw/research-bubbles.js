import { escape, money, pct } from './research-ui.js';
import { quadrant } from './research-data.js?v=20261001-twhome1';
const colors = ['#ed686d', '#e2ba5e', '#b4bab9', '#43b998'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Symmetric, invertible compression: sign/order stay unchanged and axes show true values.
export function flowScale(values) {
  const magnitudes = values.map(Math.abs).filter(value => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
  const maximum = magnitudes.at(-1) || 1;
  const typical = magnitudes[Math.floor((magnitudes.length - 1) / 4)] || maximum;
  const knee = Math.max(typical, maximum / 1000, 1);
  const denominator = Math.asinh(maximum / knee);
  return { maximum, position: value => Math.asinh(value / knee) / denominator, value: position => Math.sinh(position * denominator) * knee };
}
export function bubblePoints(sectors, mode = 'day') {
  return sectors.map(s => ({ ...s,
    x: mode === 'momentum' ? s.flow5 : s.flow,
    y: mode === 'momentum' ? s.momentum : s.changePct,
    size: mode === 'momentum' ? Math.abs(s.flow20 ?? NaN) : s.turnoverTwd
  })).filter(s => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.size));
}
// Bubble labels are annotations: small anchor dots retain the exact plotted
// coordinates, while deterministic placement avoids covering nearby labels.
export function placeBubbleLabels(points, cx, cy, zoom) {
  const placed = [];
  for (const point of points) {
    const { radius: r } = point;
    const left = point.x < 0 ? cx - 195 * zoom + r : cx + r + 5;
    const right = point.x < 0 ? cx - r - 5 : cx + 195 * zoom - r;
    const top = point.y >= 0 ? cy - 195 * zoom + r : cy + r + 5;
    const bottom = point.y >= 0 ? cy - r - 5 : cy + 195 * zoom - r;
    const baseX = clamp(point.ax, left, right), baseY = clamp(point.ay, top, bottom);
    let found;
    for (let distance = 0; distance <= 390 * zoom && !found; distance += 7) {
      const steps = distance ? Math.max(16, Math.ceil(distance / 3)) : 1;
      for (let i = 0; i < steps; i++) {
        const angle = i * Math.PI * 2 / steps;
        const x = baseX + Math.cos(angle) * distance, y = baseY + Math.sin(angle) * distance;
        if (x < left || x > right || y < top || y > bottom) continue;
        if (placed.every(other => Math.hypot(x - other.px, y - other.py) >= r + other.radius + 5)) { found = { px: x, py: y }; break; }
      }
    }
    placed.push({ ...point, ...(found || { px: baseX, py: baseY }) });
  }
  return placed;
}
export function bubbleChart(sectors, mode = 'day', selected = '', { density = 'all', zoom = 1, panX = 0, panY = 0 } = {}) {
  const all = bubblePoints(sectors, mode);
  if (!all.length) return `<div class="twx-empty">${mode === 'momentum' ? '此範圍尚無完整 20 個交易日資料。可切換「當日價量」查看。' : '沒有符合條件且具備完整當日資料的產業。'}</div>`;
  const ranked = [...all].sort((a, b) => Math.abs(b.x) - Math.abs(a.x) || a.name.localeCompare(b.name));
  const points = density === 'top' ? ranked.slice(0, 10) : ranked;
  const xScale = flowScale(all.map(s => s.x));
  const yScale = flowScale(all.map(s => s.y));
  const maxSize = Math.max(...all.map(s => s.size), 1);
  const z = clamp(zoom, 1, 8), cx = 240 + panX, cy = 244 + panY;
  const xAt = value => cx + xScale.position(value) * 152 * z;
  const yAt = value => cy - yScale.position(value) * 152 * z;
  const formatX = value => (value / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  const formatY = value => (value / (mode === 'momentum' ? 1e8 : 1)).toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  const line = (x1, y1, x2, y2, cls = '') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const plotted = placeBubbleLabels(points.map(s => {
    const letters = Array.from(s.name), lines = [];
    for (let i = 0; i < letters.length; i += 4) lines.push(letters.slice(i, i + 4).join(''));
    return { ...s, lines, ax: xAt(s.x), ay: yAt(s.y), radius: Math.max(31, lines.length * 8 + 12, 46 * Math.sqrt(Math.max(0, s.size) / maxSize)) };
  }), cx, cy, z);
  const anchors = plotted.map(s => `<line x1="${s.ax}" y1="${s.ay}" x2="${s.px}" y2="${s.py}"/><circle cx="${s.ax}" cy="${s.ay}" r="2"/>`).join('');
  // Every rendered bubble owns its complete name and amount; none are hidden.
  const dots = [...plotted].reverse().map(s => {
    const { lines, radius, px: x, py: y } = s;
    const firstLineY = y - (lines.length * 14 + 11) / 2 + 10;
    const color = colors[quadrant(s.x, s.y)];
    const amount = money(s.flow).replace(' 億', '億');
    return `<g class="twx-bubble ${s.name === selected ? 'chosen' : ''}" role="button" tabindex="0" data-sector="${escape(s.name)}" aria-label="${escape(s.name)}，${mode === 'momentum' ? '5 日' : '當日'}${money(s.x)}，${mode === 'momentum' ? '動能' + money(s.y) + '／日' : pct(s.y)}" style="--bubble:${color}"><title>${escape(s.name)} · ${mode === 'momentum' ? '5 日' : '當日'} ${money(s.x)} · ${mode === 'momentum' ? '動能 ' + money(s.y) + '／日' : pct(s.y)}</title><circle cx="${x}" cy="${y}" r="${radius}"/><text class="twx-bubble-label" x="${x}" y="${firstLineY}" text-anchor="middle">${lines.map((name, i) => `<tspan x="${x}" dy="${i ? 14 : 0}">${escape(name)}</tspan>`).join('')}</text><text class="twx-bubble-value" x="${x}" y="${firstLineY + lines.length * 14}" text-anchor="middle">${amount}</text></g>`;
  }).join('');
  const yTicks = [85, 165, 325, 405];
  const xTicks = [70, 240, 410];
  return `<svg class="twx-bubbles ${z > 1 ? 'is-zoomed' : ''}" viewBox="0 0 480 494" role="group" aria-label="${mode === 'momentum' ? '5／20 日法人資金圖' : '當日價量圖'}；兩軸為對稱壓縮刻度；${points.length} 個產業，泡泡內金額為當日估算"><defs><clipPath id="twx-plot-clip"><rect x="45" y="45" width="397" height="397" rx="8"/></clipPath></defs><g class="twx-chart-grid" clip-path="url(#twx-plot-clip)">${yTicks.map(y => line(45, y, 442, y)).join('')}${line(cx, 45, cx, 442, 'axis')}${line(45, cy, 442, cy, 'axis')}</g><g class="twx-axis-label"><text x="14" y="27">${mode === 'momentum' ? '5 日均值 − 20 日均值（億／日）' : '當日產業漲跌幅（%）'}</text><text x="240" y="483" text-anchor="middle">${mode === 'momentum' ? '近 5 日' : '當日'}淨買賣超（億）· 雙軸壓縮刻度</text>${xTicks.map(x => `<text x="${x}" y="461" text-anchor="middle">${formatX(xScale.value((x - cx) / (152 * z)))}</text>`).join('')}${yTicks.map(y => `<text x="5" y="${y + 4}">${formatY(yScale.value((cy - y) / (152 * z)))}</text>`).join('')}</g><g class="twx-bubble-anchors" clip-path="url(#twx-plot-clip)">${anchors}</g><g clip-path="url(#twx-plot-clip)">${dots}</g></svg>`;
}
