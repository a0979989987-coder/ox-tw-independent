import { bubblePoints, bubbleLayout, flowScale } from './research-bubbles.js';
import { money, pct } from './research-ui.js';
import { quadrant } from './research-data.js';

const colors = ['#ed686d', '#e2ba5e', '#b4bab9', '#43b998'];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const mix = (a, b, t) => a + (b - a) * t;

// Keep unavailable sessions in the window. A gap must not turn into a zero or
// allow an older session to stand in for a missing trading day's observation.
export function replayHistory(history, mode = 'momentum') {
  const days = [...new Map((history || []).filter(d => d?.date).map(d => [d.date, d])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  if (mode === 'day') {
    const first = days.findIndex(day => bubblePoints(day.sectors || [], mode).length);
    return first < 0 ? [] : days.slice(first);
  }
  const enriched = days.map((day, index) => ({ ...day, sectors: (day.sectors || []).map(sector => {
    const window = days.slice(Math.max(0, index - 19), index + 1)
      .map(d => d.sectors?.find(s => s.name === sector.name));
    const complete = n => window.length >= n && window.slice(-n).every(s =>
      s && s.count > 0 && s.covered === s.count && Number.isFinite(s.flow));
    const flow5 = complete(5) ? window.slice(-5).reduce((n, s) => n + s.flow, 0) : null;
    const flow20 = complete(20) ? window.reduce((n, s) => n + s.flow, 0) : null;
    return { ...sector, flow5, flow20, momentum: flow5 !== null && flow20 !== null ? flow5 / 5 - flow20 / 20 : null };
  }) }));
  const first = enriched.findIndex(day => bubblePoints(day.sectors, mode).length);
  return first < 0 ? [] : enriched.slice(first);
}

// Fix the scales and the displayed roster for the whole replay. Otherwise an
// unchanged sector can jump when another sector enters the day's top ten.
export function replayFrames(days, mode, options = {}) {
  const universe = days.flatMap(day => bubblePoints(day.sectors || [], mode));
  const peak = new Map();
  for (const point of universe) peak.set(point.name, Math.max(peak.get(point.name) || 0, Math.abs(point.x)));
  let names = [...peak].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  if (options.density === 'top') names = names.slice(0, 10);
  const scale = { xScale: flowScale(universe.map(p => p.x)), yScale: flowScale(universe.map(p => p.y)),
    maxSize: Math.max(1, ...universe.map(p => p.size)) };
  const layouts = days.map(day => bubbleLayout(day.sectors || [], mode, { ...options, ...scale, names }));
  const reference = new Map(layouts.flatMap(layout => layout.points).map(point => [point.name, point]));
  const last = new Map();
  return layouts.map((layout, i) => ({ ...layout, date: days[i].date, sectors: days[i].sectors || [],
    points: names.map(name => {
      const point = layout.points.find(p => p.name === name);
      if (point) last.set(name, point);
      return { ...(point || last.get(name) || reference.get(name)), opacity: point ? 1 : 0 };
    }) }));
}

function blendColor(a, b, t) {
  const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return '#' + channels(a).map((n, i) => Math.round(mix(n, channels(b)[i], t)).toString(16).padStart(2, '0')).join('');
}

export function replayFrameAt(frames, position) {
  if (!frames.length) return [];
  const value = clamp(position, 0, frames.length - 1), index = Math.floor(value), t = value - index;
  const from = frames[index].points, to = frames[Math.min(index + 1, frames.length - 1)].points;
  const target = new Map(to.map(p => [p.name, p]));
  return from.map(a => {
    const b = target.get(a.name) || a;
    const point = { ...a, opacity: mix(a.opacity, b.opacity, t),
      color: blendColor(colors[quadrant(a.x, a.y)], colors[quadrant(b.x, b.y)], t) };
    for (const key of ['px', 'py', 'ax', 'ay', 'radius']) point[key] = mix(a[key], b[key], t);
    return point;
  });
}

const svgNodes = new WeakMap();
export function drawReplayFrame(svg, points, mode) {
  let nodes = svgNodes.get(svg);
  if (!nodes) {
    nodes = new Map([...svg.querySelectorAll('.twx-bubble')].map(group => [group.dataset.sector, {
      group, circle: group.querySelector('circle'), label: group.querySelector('.twx-bubble-label'),
      lines: [...group.querySelectorAll('tspan')], value: group.querySelector('.twx-bubble-value'),
      title: group.querySelector('title'), anchor: [...svg.querySelectorAll('[data-anchor-sector]')]
        .find(anchor => anchor.dataset.anchorSector === group.dataset.sector)
    }]));
    svgNodes.set(svg, nodes);
  }
  for (const p of points) {
    const node = nodes.get(p.name); if (!node) continue;
    const { group, circle, label, lines, value, title, anchor } = node;
    const y = p.py - (p.lines.length * 14 + 11) / 2 + 10;
    circle.setAttribute('cx', p.px); circle.setAttribute('cy', p.py); circle.setAttribute('r', p.radius);
    label.setAttribute('x', p.px); label.setAttribute('y', y);
    for (const line of lines) line.setAttribute('x', p.px);
    value.setAttribute('x', p.px); value.setAttribute('y', y + p.lines.length * 14);
    // The amount stays on the dated observation; the in-between coordinates
    // are animation, not a fabricated intraday institutional observation.
    value.textContent = p.opacity > .99 ? money(p.x).replace(' 億', '億') : '—';
    const description = `${p.name}，${mode === 'momentum' ? '近五日' : '當日'} ${money(p.x)}，${mode === 'momentum' ? '買入力道 ' + money(p.y) + '／日' : pct(p.y)}`;
    group.setAttribute('aria-label', description); if (title) title.textContent = description;
    group.style.setProperty('--bubble', p.color || colors[quadrant(p.x, p.y)]);
    group.style.opacity = p.opacity;
    group.style.pointerEvents = p.opacity > .99 ? '' : 'none';
    group.setAttribute('tabindex', p.opacity > .99 ? '0' : '-1');
    group.setAttribute('aria-hidden', p.opacity <= 0 ? 'true' : 'false');
    if (anchor) {
      const dot = anchor.querySelector('circle'), line = anchor.querySelector('line');
      dot.setAttribute('cx', p.ax); dot.setAttribute('cy', p.ay);
      line.setAttribute('x1', p.ax); line.setAttribute('y1', p.ay);
      line.setAttribute('x2', p.px); line.setAttribute('y2', p.py);
      anchor.style.opacity = p.opacity;
    }
  }
}

// One clock owns the replay; pause/seek/resume keep a fractional position, and
// never replace the SVG or the range control. Clock injection tests actual
// frame behavior without timers, networking or a browser implementation.
export function createReplayPlayer({ length, render, onState = () => {}, isActive = () => true,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, position = 0, speed = 1 }) {
  let value = clamp(position, 0, Math.max(0, length - 1)), rate = speed;
  let playing = false, frame = null, previous = null, destroyed = false;
  const notify = () => onState({ position: value, playing });
  const pause = () => {
    playing = false; previous = null;
    if (frame !== null) cancelFrame(frame);
    frame = null; notify();
  };
  const tick = timestamp => {
    frame = null;
    if (!playing || destroyed) return;
    if (!isActive()) { pause(); return; }
    if (previous !== null) value = Math.min(length - 1, value + Math.max(0, Math.min(100, timestamp - previous)) / 1200 * rate);
    previous = timestamp; render(value); notify();
    if (value >= length - 1) { pause(); return; }
    frame = requestFrame(tick);
  };
  return {
    get position() { return value; }, get playing() { return playing; },
    play() {
      if (destroyed || length < 2 || playing) return;
      if (value >= length - 1) value = 0;
      playing = true; previous = null; render(value); notify(); frame = requestFrame(tick);
    },
    pause,
    seek(position) { if (destroyed) return; pause(); value = clamp(Number(position) || 0, 0, Math.max(0, length - 1)); render(value); notify(); },
    setSpeed(speed) { if (Number.isFinite(speed) && speed > 0) rate = speed; },
    destroy() { pause(); destroyed = true; }
  };
}
