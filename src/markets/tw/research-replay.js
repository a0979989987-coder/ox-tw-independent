import { bubblePoints, bubbleLayout, flowScale, meetsBubbleFlow, REPLAY_TRAIL_PIECES, zoomBubbleLayout, bubbleViewMatches } from './research-bubbles.js';
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
  const layouts = days.map(day => bubbleLayout(day.sectors || [], mode, { ...options, ...scale, names, minFlow: 0, labelPlacement: 'observed' }));
  const reference = new Map(layouts.flatMap(layout => layout.points).map(point => [point.name, point]));
  const last = new Map();
  return layouts.map((layout, i) => ({ ...layout, replay: true, date: days[i].date, sectors: days[i].sectors || [],
    points: names.map(name => {
      const point = layout.points.find(p => p.name === name);
      if (point) last.set(name, point);
      return { ...(point || last.get(name) || reference.get(name)), available: !!point,
        opacity: point && meetsBubbleFlow(point, mode, options.minFlow || 0) ? 1 : 0 };
    }) }));
}

function blendColor(a, b, t) {
  const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return '#' + channels(a).map((n, i) => Math.round(mix(n, channels(b)[i], t)).toString(16).padStart(2, '0')).join('');
}

// A shape-preserving cubic shares its velocity at each dated observation.
// Unlike an ease-in/out per day it has no artificial hold at every boundary;
// unlike a free spline it cannot overshoot or invent extra extrema.
function smoothCoordinate(before, a, b, after, key, t) {
  const delta = b[key] - a[key];
  if (!delta) return a[key];
  const tangent = other => delta * other > 0 ? 2 * delta * other / (delta + other) : 0;
  const m0 = before?.available ? tangent(a[key] - before[key]) : delta;
  const m1 = after?.available ? tangent(after[key] - b[key]) : delta;
  const t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1)*a[key] + (t3 - 2*t2 + t)*m0
    + (-2*t3 + 3*t2)*b[key] + (t3 - t2)*m1;
}
function positionAt(name, position, maps) {
  const index = Math.floor(position), t = position - index;
  const a = maps.get(index)?.get(name), b = maps.get(index + 1)?.get(name);
  if (!a?.available) return b?.available ? b : a;
  if (!b?.available || !t) return a;
  const before = maps.get(index - 1)?.get(name), after = maps.get(index + 2)?.get(name);
  return { px: smoothCoordinate(before, a, b, after, 'px', t),
    py: smoothCoordinate(before, a, b, after, 'py', t),
    ax: smoothCoordinate(before, a, b, after, 'ax', t),
    ay: smoothCoordinate(before, a, b, after, 'ay', t), radius: mix(a.radius, b.radius, t) };
}
const TRAIL_DURATION = 3;
// A sliding time window avoids dropping an entire dated segment at a turn.
// Small contiguous pieces taper and fade with age; no orphan turning-point dots.
function replayTrail(name, position, maps) {
  const index = Math.floor(position), current = maps.get(index)?.get(name);
  if (!current?.available || !current.opacity) return [];
  let first = index;
  while (first > Math.max(0, Math.floor(position - TRAIL_DURATION)) && maps.get(first - 1)?.get(name)?.opacity === 1) first--;
  const end = maps.get(index + 1)?.get(name)?.available ? position : index;
  const start = Math.max(first, position - TRAIL_DURATION);
  if (end <= start) return [];
  const pieces = [];
  let from = positionAt(name, start, maps);
  for (let i = 1; i <= REPLAY_TRAIL_PIECES; i++) {
    const time = mix(start, end, i / REPLAY_TRAIL_PIECES), to = positionAt(name, time, maps);
    const freshness = clamp(1 - (position - time) / TRAIL_DURATION, 0, 1);
    pieces.push({ from, to, opacity: .48 * freshness ** 1.6, width: .6 + freshness * 1.5 });
    from = to;
  }
  return pieces;
}
const frameMaps = new WeakMap();
function pointMap(frame) {
  if (!frameMaps.has(frame)) frameMaps.set(frame, new Map(frame.points.map(p => [p.name, p])));
  return frameMaps.get(frame);
}

export function replayFrameAt(frames, position, { trails = true } = {}) {
  if (!frames.length) return [];
  const value = clamp(position, 0, frames.length - 1), index = Math.floor(value), t = value - index;
  const from = frames[index].points, to = frames[Math.min(index + 1, frames.length - 1)].points;
  const target = new Map(to.map(p => [p.name, p]));
  const maps = new Map();
  for (let i = Math.max(0, index - 4); i <= Math.min(frames.length - 1, index + 2); i++)
    maps.set(i, pointMap(frames[i]));
  return from.map(a => {
    const b = target.get(a.name) || a;
    const visible = a.opacity ? a : b.opacity ? b : a;
    const point = { ...visible, opacity: mix(a.opacity, b.opacity, t),
      color: a.available && b.available ? blendColor(colors[quadrant(a.x, a.y)], colors[quadrant(b.x, b.y)], t)
        : colors[quadrant(visible.x, visible.y)], trail: trails ? replayTrail(a.name, value, maps) : [] };
    // Retain below-threshold coordinates so entering/leaving bubbles move
    // continuously. Truly missing observations fade in place and break trails.
    const geometry = positionAt(a.name, value, maps);
    for (const key of ['px', 'py', 'ax', 'ay', 'radius']) point[key] = geometry[key];
    return point;
  });
}

// Details follow the real observation whose label is currently visible,
// including a bubble entering from the next date or fading out of this one.
export function replaySectorAt(frames, position, name) {
  if (!frames?.length) return null;
  const value = clamp(position, 0, frames.length - 1), index = Math.floor(value);
  const first = frames[index], next = frames[Math.min(index + 1, frames.length - 1)];
  const a = first.points.find(p => p.name === name), b = next.points.find(p => p.name === name);
  if (!a || mix(a.opacity, b?.opacity ?? a.opacity, value - index) <= 0) return null;
  const frame = a.opacity ? first : next;
  const sector = frame.sectors.find(s => s.name === name);
  return sector ? { ...sector, date: frame.date } : null;
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
      trail: trails.get(group.dataset.sector), trailPieces: [...(trails.get(group.dataset.sector)?.querySelectorAll('path') || [])]
    }]));
    svgNodes.set(svg, nodes);
  }
  for (const p of points) {
    const node = nodes.get(p.name); if (!node) continue;
    if (p.opacity === 0 && node.hidden) continue;
    node.hidden = p.opacity === 0;
    const { group, circle, label, lines, value, title, anchor, trail, trailPieces } = node;
    const y = p.py - (p.lines.length * 14 + 11) / 2 + 10;
    circle.setAttribute('cx', p.px); circle.setAttribute('cy', p.py); circle.setAttribute('r', p.radius);
    label.setAttribute('x', p.px); label.setAttribute('y', y);
    for (const line of lines) line.setAttribute('x', p.px);
    value.setAttribute('x', p.px); value.setAttribute('y', y + p.lines.length * 14);
    // The amount stays on the dated observation; the in-between coordinates
    // are animation, not a fabricated intraday institutional observation.
    const valueKey = `${mode}:${p.x}:${p.y}`;
    if (node.valueKey !== valueKey) {
      value.textContent = money(p.x).replace(' 億', '億');
      const description = `${p.name}，${mode === 'momentum' ? '近五日' : '當日'} ${money(p.x)}，${mode === 'momentum' ? '買入力道 ' + money(p.y) + '／日' : pct(p.y)}`;
      group.setAttribute('aria-label', description); if (title) title.textContent = description;
      node.valueKey = valueKey;
    }
    group.style.setProperty('--bubble', p.color || colors[quadrant(p.x, p.y)]);
    group.style.opacity = p.opacity;
    group.style.pointerEvents = p.opacity > 0 ? '' : 'none';
    group.setAttribute('tabindex', p.opacity > 0 ? '0' : '-1');
    group.setAttribute('aria-hidden', p.opacity <= 0 ? 'true' : 'false');
    if (anchor) {
      const dot = anchor.querySelector('circle');
      dot.setAttribute('cx', p.ax); dot.setAttribute('cy', p.ay);
      anchor.style.opacity = p.opacity;
    }
    if (trail) {
      trail.style.setProperty('--bubble', p.color || colors[quadrant(p.x, p.y)]);
      trail.style.opacity = p.opacity;
      if (p.trail?.length || node.hadTrail) trailPieces.forEach((path, i) => {
        const piece = p.trail?.[i];
        path.setAttribute('d', piece ? `M${piece.from.px.toFixed(2)},${piece.from.py.toFixed(2)}L${piece.to.px.toFixed(2)},${piece.to.py.toFixed(2)}` : '');
        path.style.opacity = piece?.opacity || 0;
        if (piece) path.style.strokeWidth = piece.width;
      });
      node.hadTrail = !!p.trail?.length;
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
    seek(position, { pause: shouldPause = true } = {}) { if (destroyed) return; if (shouldPause) pause(); else previous = null; value = clamp(Number(position) || 0, 0, Math.max(0, length - 1)); render(value); notify(); },
    setSpeed(speed) { if (Number.isFinite(speed) && speed > 0) rate = speed; },
    destroy() { pause(); destroyed = true; }
  };
}

// Frames replayFrameAt reads for one position (trail history and the next date).
export function replayWindow(position, length) {
  const index = Math.floor(clamp(position, 0, Math.max(0, length - 1)));
  return [Math.max(0, index - 4), Math.min(length - 1, index + 2)];
}
// Bring frames [from, to] to the current zoom/pan in place. During a gesture
// only the on-screen window is moved; the rest catch up when it settles.
export function zoomReplayFrames(frames, view, from = 0, to = frames.length - 1) {
  let moved = 0;
  for (let i = Math.max(0, from); i <= Math.min(frames.length - 1, to); i++)
    if (!bubbleViewMatches(frames[i], view)) { frames[i] = zoomBubbleLayout(frames[i], view); moved++; }
  return moved;
}
