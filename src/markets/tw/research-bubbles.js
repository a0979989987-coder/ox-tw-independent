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
export function placeBubbleLabels(points, cx, cy, zoom, stretch = 1) {
  const placed = [];
  for (const point of points) {
    const rx = point.labelWidth / 2, ry = point.labelHeight / 2;
    const left = point.x < 0 ? cx - 195 * zoom + rx : cx + rx + 5;
    const right = point.x < 0 ? cx - rx - 5 : cx + 195 * zoom - rx;
    const top = point.y >= 0 ? cy - 195 * zoom * stretch + ry : cy + ry + 5;
    const bottom = point.y >= 0 ? cy - ry - 5 : cy + 195 * zoom * stretch - ry;
    const baseX = clamp(point.ax, left, right), baseY = clamp(point.ay, top, bottom);
    let found;
    for (let distance = 0; distance <= 390 * zoom && !found; distance += 7) {
      const steps = distance ? Math.max(16, Math.ceil(distance / 3)) : 1;
      for (let i = 0; i < steps; i++) {
        const angle = i * Math.PI * 2 / steps;
        const x = baseX + Math.cos(angle) * distance, y = baseY + Math.sin(angle) * distance;
        if (x < left || x > right || y < top || y > bottom) continue;
        if (placed.every(other => Math.abs(x - other.px) >= (point.labelWidth + other.labelWidth) / 2 + 6 || Math.abs(y - other.py) >= (point.labelHeight + other.labelHeight) / 2 + 6)) { found = { px: x, py: y }; break; }
      }
    }
    placed.push({ ...point, ...(found || { px: baseX, py: baseY }) });
  }
  // Crowded quadrants need a compact annotation grid instead of falling back
  // to overlapping labels. Anchor dots retain the actual data coordinates.
  for (let q = 0; q < 4; q++) {
    const cluster = placed.filter(p => quadrant(p.x, p.y) === q);
    const overlaps = cluster.some((p, i) => cluster.slice(i + 1).some(other =>
      Math.abs(p.px - other.px) < (p.labelWidth + other.labelWidth) / 2 + 3 &&
      Math.abs(p.py - other.py) < (p.labelHeight + other.labelHeight) / 2 + 3));
    if (!overlaps) continue;
    const width = 190 * zoom, height = 190 * zoom * stretch, columns = Math.max(1, Math.floor(width / 63));
    const sorted = [...cluster].sort((a, b) => b.labelHeight - a.labelHeight || a.name.localeCompare(b.name));
    const rows = [];
    for (let i = 0; i < sorted.length; i += columns) rows.push(sorted.slice(i, i + columns));
    const heights = rows.map(row => Math.max(...row.map(p => p.labelHeight)));
    const used = heights.reduce((sum, h) => sum + h, 0);
    if (used + (rows.length - 1) * 3 > height) continue;
    const gap = (height - used) / (rows.length + 1);
    const left = q < 2 ? cx + 5 : cx - 195 * zoom;
    let top = (q % 2 === 0 ? cy - 195 * zoom * stretch : cy + 5) + gap;
    rows.forEach((row, index) => {
      row.forEach((point, column) => { point.px = left + width * (column + .5) / columns; point.py = top + heights[index] / 2; });
      top += heights[index] + gap;
    });
  }
  return placed;
}
export function bubbleLayout(sectors, mode = 'day', { density = 'all', zoom = 1, panX = 0, panY = 0,
  xScale, yScale, maxSize, names, height = 494 } = {}) {
  const all = bubblePoints(sectors, mode);
  const ranked = [...all].sort((a, b) => Math.abs(b.x) - Math.abs(a.x) || a.name.localeCompare(b.name));
  const selected = names ? names.map(name => all.find(s => s.name === name)).filter(Boolean) : density === 'top' ? ranked.slice(0, 10) : ranked;
  xScale ||= flowScale(all.map(s => s.x));
  yScale ||= flowScale(all.map(s => s.y));
  maxSize ||= Math.max(...all.map(s => s.size), 1);
  const z = clamp(zoom, 1, 8), cx = 240 + panX, cy = (height - 6) / 2 + panY, stretch = (height - 97) / 397;
  const points = placeBubbleLabels(selected.map(s => {
    const lines = []; let line = '', width = 0;
    for (const letter of Array.from(s.name)) {
      const size = /[\x00-\x7F]/.test(letter) ? .55 : 1;
      if (width + size > 4.4 && line) { lines.push(line.trim()); line = ''; width = 0; }
      line += letter; width += size;
    }
    if (line.trim()) lines.push(line.trim());
    return { ...s, lines, labelWidth: 57, labelHeight: lines.length * 14 + 11, opacity: 1, ax: cx + xScale.position(s.x) * 152 * z,
      ay: cy - yScale.position(s.y) * 152 * z * stretch,
      radius: Math.max(31, lines.length * 8 + 12, 46 * Math.sqrt(Math.max(0, s.size) / maxSize)) };
  }), cx, cy, z, stretch);
  return { points, xScale, yScale, maxSize, cx, cy, z, height, stretch };
}
// Move the existing annotations with the viewport. Text and circle sizes stay
// readable; observed values, scales and replay membership remain unchanged.
export function zoomBubbleLayout(layout, { zoom = 1, panX = 0, panY = 0 } = {}) {
  const z = clamp(zoom, 1, 8), cx = 240 + panX, cy = (layout.height - 6) / 2 + panY;
  const ratio = z / layout.z;
  return { ...layout, z, cx, cy, points: layout.points.map(point => ({ ...point,
    ax: cx + (point.ax - layout.cx) * ratio, ay: cy + (point.ay - layout.cy) * ratio,
    px: cx + (point.px - layout.cx) * ratio, py: cy + (point.py - layout.cy) * ratio
  })) };
}
export function drawBubbleAxes(svg, { xScale, yScale, cx, cy, z, stretch }, mode = 'day') {
  const xAxis = svg.querySelector('[data-axis="x"]'), yAxis = svg.querySelector('[data-axis="y"]');
  xAxis?.setAttribute('x1', cx); xAxis?.setAttribute('x2', cx);
  yAxis?.setAttribute('y1', cy); yAxis?.setAttribute('y2', cy);
  const format = value => value.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  for (const tick of svg.querySelectorAll('[data-x-tick]'))
    tick.textContent = format(xScale.value((Number(tick.dataset.xTick) - cx) / (152 * z)) / 1e8);
  for (const tick of svg.querySelectorAll('[data-y-tick]'))
    tick.textContent = format(yScale.value((cy - Number(tick.dataset.yTick)) / (152 * z * stretch)) / (mode === 'momentum' ? 1e8 : 1));
  svg.classList.toggle('is-zoomed', z > 1);
}
export function bubbleChart(sectors, mode = 'day', selected = '', options = {}) {
  const layout = options.layout || bubbleLayout(sectors, mode, options);
  const { points, xScale, yScale, cx, cy, z, height = 494, stretch = 1 } = layout;
  if (!points.length) return `<div class="twx-empty">${mode === 'momentum' ? '此範圍尚無完整 20 個交易日資料。可切換「當日價量」查看。' : '沒有符合條件且具備完整當日資料的產業。'}</div>`;
  const formatX = value => (value / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  const formatY = value => (value / (mode === 'momentum' ? 1e8 : 1)).toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  const line = (x1, y1, x2, y2, cls = '', axis = '') => `<line class="${cls}" ${axis ? `data-axis="${axis}"` : ''} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const plotted = points;
  const anchors = plotted.map(s => `<g data-anchor-sector="${escape(s.name)}" style="opacity:${s.opacity ?? 1}"><line x1="${s.ax}" y1="${s.ay}" x2="${s.px}" y2="${s.py}"/><circle cx="${s.ax}" cy="${s.ay}" r="2"/></g>`).join('');
  // Every rendered bubble owns its complete name and amount; none are hidden.
  const dots = [...plotted].reverse().map(s => {
    const { lines, radius, px: x, py: y } = s;
    const firstLineY = y - (lines.length * 14 + 11) / 2 + 10;
    const color = colors[quadrant(s.x, s.y)];
    const amount = money(s.x).replace(' 億', '億');
    return `<g class="twx-bubble ${s.name === selected ? 'chosen' : ''}" role="button" tabindex="0" data-sector="${escape(s.name)}" aria-label="${escape(s.name)}，${mode === 'momentum' ? '5 日' : '當日'}${money(s.x)}，${mode === 'momentum' ? '動能' + money(s.y) + '／日' : pct(s.y)}" style="--bubble:${color};opacity:${s.opacity ?? 1}"><title>${escape(s.name)} · ${mode === 'momentum' ? '5 日' : '當日'} ${money(s.x)} · ${mode === 'momentum' ? '動能 ' + money(s.y) + '／日' : pct(s.y)}</title><circle cx="${x}" cy="${y}" r="${radius}"/><text class="twx-bubble-label" x="${x}" y="${firstLineY}" text-anchor="middle">${lines.map((name, i) => `<tspan x="${x}" dy="${i ? 14 : 0}">${escape(name)}</tspan>`).join('')}</text><text class="twx-bubble-value" x="${x}" y="${firstLineY + lines.length * 14}" text-anchor="middle">${amount}</text></g>`;
  }).join('');
  const sy = y => 45 + (y - 45) * stretch;
  const yTicks = [85, 165, 325, 405].map(sy);
  const xTicks = [70, 240, 410];
  return `<svg class="twx-bubbles ${z > 1 ? 'is-zoomed' : ''}" viewBox="0 0 480 ${height}" role="group" aria-label="${mode === 'momentum' ? '資金動向圖' : '當日價量圖'}；兩軸為對稱壓縮刻度；${points.length} 個產業，泡泡內金額為${mode === 'momentum' ? '近五日' : '當日'}估算"><defs><clipPath id="twx-plot-clip"><rect x="45" y="45" width="397" height="${height - 97}" rx="8"/></clipPath></defs><g class="twx-chart-grid" clip-path="url(#twx-plot-clip)">${yTicks.map(y => line(45, y, 442, y)).join('')}${line(cx, 45, cx, height - 52, 'axis', 'x')}${line(45, cy, 442, cy, 'axis', 'y')}</g><g class="twx-axis-label"><text x="14" y="27">${mode === 'momentum' ? '↑ 更偏買入 · ↓ 更偏賣出（億／日）' : '當日產業漲跌幅（%）'}</text><text x="240" y="${height - 11}" text-anchor="middle">${mode === 'momentum' ? '近五日' : '當日'}淨買賣超（億） · ← 流出｜流入 →</text>${xTicks.map(x => `<text data-x-tick="${x}" x="${x}" y="${height - 33}" text-anchor="middle">${formatX(xScale.value((x - cx) / (152 * z)))}</text>`).join('')}${yTicks.map(y => `<text data-y-tick="${y}" x="5" y="${y + 4}">${formatY(yScale.value((cy - y) / (152 * z * stretch)))}</text>`).join('')}</g>${mode === 'momentum' ? `<g class="twx-quadrant-label" aria-hidden="true"><text x="55" y="62">流出收斂</text><text x="430" y="62" text-anchor="end">流入加速</text><text x="55" y="${height - 64}">流出加速</text><text x="430" y="${height - 64}" text-anchor="end">流入放緩</text></g>` : ''}<g class="twx-bubble-anchors" clip-path="url(#twx-plot-clip)">${anchors}</g><g clip-path="url(#twx-plot-clip)">${dots}</g></svg>`;
}
