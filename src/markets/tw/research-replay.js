import { bubblePoints, bubbleLayout, flowScale, meetsBubbleFlow } from './research-bubbles.js';
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
  const universe = days.flatMap(day => bubblePoints(day.sectors || [], mode)).filter(p => meetsBubbleFlow(p, mode, options.minFlow || 0));
  const peak = new Map();
  for (const point of universe) peak.set(point.name, Math.max(peak.get(point.name) || 0, Math.abs(point.x)));
  let names = [...peak].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  if (options.density === 'top') names = names.slice(0, 10);
  const scale = { xScale: flowScale(universe.map(p => p.x)), yScale: flowScale(universe.map(p => p.y)),
    maxSize: Math.max(1, ...universe.map(p => p.size)) };
  const layouts = days.map(day => bubbleLayout(day.sectors || [], mode, { ...options, ...scale, names, labelPlacement: 'observed' }));
  const reference = new Map(layouts.flatMap(layout => layout.points).map(point => [point.name, point]));
  const last = new Map();
  return layouts.map((layout, i) => ({ ...layout, replay: true, date: days[i].date, sectors: days[i].sectors || [],
    points: names.map(name => {
      const point = layout.points.find(p => p.name === name);
      if (point) last.set(name, point);
      return { ...(point || last.get(name) || reference.get(name)), opacity: point ? 1 : 0,
        filteredOut: (days[i].sectors || []).some(s => s.name === name && !meetsBubbleFlow(s, mode, options.minFlow || 0)) };
    }) }));
}

function blendColor(a, b, t) {
  const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return '#' + channels(a).map((n, i) => Math.round(mix(n, channels(b)[i], t)).toString(16).padStart(2, '0')).join('');
}

// Match Crypto: six dated observations, a connected historical polyline and
// dots at real turning points. Missing observations break the path.
function replayTrail(name, position, maps) {
  const index = Math.floor(position), fraction = position - index;
  const current = maps.get(index)?.get(name), next = maps.get(index + 1)?.get(name);
  if (!current || current.opacity !== 1 || (fraction > 0 && next?.opacity !== 1)) return [];
  const points = [];
  for (let i = index; i >= Math.max(0, index - 5); i--) {
    const point = maps.get(i)?.get(name);
    if (!point || point.opacity !== 1) break;
    points.unshift({px: point.px, py: point.py, date: point.date});
  }
  if (fraction > 0) points.push({px: mix(current.px, next.px, fraction), py: mix(current.py, next.py, fraction)});
  return points.slice(1).map((to, i) => ({from: points[i], to, opacity: .68}));
}
const frameMaps = new WeakMap();
function pointMap(frame) {
  if (!frameMaps.has(frame)) frameMaps.set(frame, new Map(frame.points.map(p => [p.name, p])));
  return frameMaps.get(frame);
}

export function replayFrameAt(frames, position) {
  if (!frames.length) return [];
  const value = clamp(position, 0, frames.length - 1), index = Math.floor(value), t = value - index;
  const from = frames[index].points, to = frames[Math.min(index + 1, frames.length - 1)].points;
  const target = new Map(to.map(p => [p.name, p]));
  const maps = new Map();
  for (let i = Math.max(0, index - 5); i <= Math.min(frames.length - 1, index + 1); i++)
    maps.set(i, pointMap(frames[i]));
  return from.map(a => {
    const b = target.get(a.name) || a;
    const visible = a.opacity ? a : b;
    const point = { ...a, opacity: a.filteredOut ? 0 : mix(a.opacity, b.opacity, t),
      color: a.opacity && b.opacity ? blendColor(colors[quadrant(a.x, a.y)], colors[quadrant(b.x, b.y)], t)
        : colors[quadrant(visible.x, visible.y)], trail: replayTrail(a.name, value, maps) };
    // A missing day fades at the last/next known location; it never travels
    // from a fabricated zero or bridges a hole in the source history.
    for (const key of ['px', 'py', 'ax', 'ay', 'radius'])
      point[key] = a.opacity && b.opacity ? mix(a[key], b[key], t) : visible[key];
    return point;
  });
}

const svgNodes = new WeakMap();
export function drawReplayFrame(svg, points, mode) {
  let nodes = svgNodes.get(svg);
  if (!nodes) {
    const anchors = new Map([...svg.querySelectorAll('[data-anchor-sector]')].map(node => [node.dataset.anchorSector, node]));
    const trails = new Map([...svg.querySelectorAll('[data-trail-sector]')].map(node => [node.dataset.trailSector, node]));
    nodes = new Map([...svg.querySelectorAll('.twx-bubble')].map(group => [group.dataset.sector, {
      group, circle: group.querySelector('circle'), label: group.querySelector('.twx-bubble-label'),
      lines: [...group.querySelectorAll('tspan')], value: group.querySelector('.twx-bubble-value'),
      title: group.querySelector('title'), anchor: anchors.get(group.dataset.sector),
      trail: trails.get(group.dataset.sector), trailPieces: [...(trails.get(group.dataset.sector)?.querySelectorAll('path') || [])],
      trailDots: [...(trails.get(group.dataset.sector)?.querySelectorAll('circle') || [])]
    }]));
    svgNodes.set(svg, nodes);
  }
  for (const p of points) {
    const node = nodes.get(p.name); if (!node) continue;
    const { group, circle, label, lines, value, title, anchor, trail, trailPieces, trailDots } = node;
    const y = p.py - (p.lines.length * 14 + 11) / 2 + 10;
    circle.setAttribute('cx', p.px); circle.setAttribute('cy', p.py); circle.setAttribute('r', p.radius);
    label.setAttribute('x', p.px); label.setAttribute('y', y);
    for (const line of lines) line.setAttribute('x', p.px);
    value.setAttribute('x', p.px); value.setAttribute('y', y + p.lines.length * 14);
    // The amount stays on the dated observation; the in-between coordinates
    // are animation, not a fabricated intraday institutional observation.
    const valueKey = `${mode}:${p.x}:${p.y}:${p.opacity > .99}`;
    if (node.valueKey !== valueKey) {
      value.textContent = p.opacity > .99 ? money(p.x).replace(' 億', '億') : '—';
      const description = `${p.name}，${mode === 'momentum' ? '近五日' : '當日'} ${money(p.x)}，${mode === 'momentum' ? '買入力道 ' + money(p.y) + '／日' : pct(p.y)}`;
      group.setAttribute('aria-label', description); if (title) title.textContent = description;
      node.valueKey = valueKey;
    }
    group.style.setProperty('--bubble', p.color || colors[quadrant(p.x, p.y)]);
    group.style.opacity = p.opacity;
    group.style.pointerEvents = p.opacity > .99 ? '' : 'none';
    group.setAttribute('tabindex', p.opacity > .99 ? '0' : '-1');
    group.setAttribute('aria-hidden', p.opacity <= 0 ? 'true' : 'false');
    if (anchor) {
      const dot = anchor.querySelector('circle');
      dot.setAttribute('cx', p.ax); dot.setAttribute('cy', p.ay);
      anchor.style.opacity = p.opacity;
    }
    if (trail) {
      trail.style.setProperty('--bubble', p.color || colors[quadrant(p.x, p.y)]);
      trail.style.opacity = p.opacity;
      trailPieces.forEach((path, i) => {
        const piece = p.trail?.[i];
        path.setAttribute('d', piece ? `M${piece.from.px.toFixed(2)},${piece.from.py.toFixed(2)}L${piece.to.px.toFixed(2)},${piece.to.py.toFixed(2)}` : '');
        path.style.opacity = piece?.opacity || 0;
      });
      trailDots.forEach((dot, i) => {
        const point = p.trail?.[i]?.from;
        if (point) { dot.setAttribute('cx', point.px); dot.setAttribute('cy', point.py); }
        dot.style.opacity = point ? 1 : 0;
      });
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
    if (previous !== null) value = Math.min(length - 1, value + Math.max(0, timestamp - previous) / 1200 * rate);
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
