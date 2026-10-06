import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleChart, bubbleLayout, zoomBubbleLayout, drawBubbleAxes } from '../src/markets/tw/research-bubbles.js';
import { drawReplayFrame, replayFrames, replayFrameAt, createReplayPlayer } from '../src/markets/tw/research-replay.js';

const sectors = Array.from({ length: 110 }, (_, i) => ({ name: `板塊${i}`, flow: (i - 54) * 1e8,
  changePct: (i % 7 - 3) / 2, turnoverTwd: 1e9 + i * 1e7 }));
const closeTo = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('zoom and pan preserve all 110 observations and inverse axes in a taller chart', () => {
  const initial = bubbleLayout(sectors, 'day', { height: 780 });
  const moved = zoomBubbleLayout(initial, { zoom: 2.56, panX: -80, panY: 63 });
  assert.equal(moved.points.length, 110);
  assert.equal(moved.xScale, initial.xScale);
  for (const point of moved.points) {
    const original = initial.points.find(p => p.name === point.name);
    closeTo(point.ax, moved.cx + moved.xScale.position(point.x) * 152 * moved.z);
    closeTo(point.ay, moved.cy - moved.yScale.position(point.y) * 152 * moved.z * moved.stretch);
    assert.deepEqual([point.x, point.y, point.size, point.radius, point.lines],
      [original.x, original.y, original.size, original.radius, original.lines]);
  }
  const reset = zoomBubbleLayout(moved);
  for (let i = 0; i < reset.points.length; i++) for (const key of ['px', 'py', 'ax', 'ay'])
    closeTo(reset.points[i][key], initial.points[i][key]);
});

test('continuous zoom updates the same SVG nodes without dimming or replacing the chart', () => {
  const element = dataset => ({ dataset, attrs: {}, style: { setProperty(k, v) { this[k] = v; } },
    setAttribute(k, v) { this.attrs[k] = String(v); } });
  const circle = element(), label = element(), value = element(), title = element(), line = element();
  const group = { ...element({ sector: '板塊0' }),
    querySelector: s => ({ circle, '.twx-bubble-label': label, '.twx-bubble-value': value, title })[s],
    querySelectorAll: () => [line] };
  const xAxis = element(), yAxis = element(), xTick = element({ xTick: '70' }), yTick = element({ yTick: '85' });
  const svg = { querySelector: s => s === '[data-axis="x"]' ? xAxis : yAxis,
    querySelectorAll: s => s === '.twx-bubble' ? [group] : s === '[data-x-tick]' ? [xTick] : s === '[data-y-tick]' ? [yTick] : [],
    classList: { toggle() {} } };
  Object.defineProperty(svg, 'innerHTML', { set() { throw Error('Zoom replaced the SVG'); } });
  let layout = bubbleLayout([sectors[0]], 'day', { height: 780 });
  const coordinates = new Set();
  for (let zoom = 1; zoom <= 3; zoom += .05) {
    layout = zoomBubbleLayout(layout, { zoom, panX: 30 });
    drawReplayFrame(svg, layout.points, 'day'); drawBubbleAxes(svg, layout, 'day');
    coordinates.add(circle.attrs.cx);
    assert.equal(group.style.opacity, 1);
    assert.equal(group.querySelector('circle'), circle);
    assert.equal(group.querySelector('.twx-bubble-label'), label);
    assert.equal(xAxis.attrs.x1, String(layout.cx));
    assert.equal(yAxis.attrs.y1, String(layout.cy));
    assert.match(group.style['--bubble'], /^#[0-9a-f]{6}$/);
  }
  assert.ok(coordinates.size > 30);
  assert.ok(Number.isFinite(Number(xTick.textContent.replaceAll(',', ''))));
});

test('zooming a paused replay retains its fractional position and resumes using the moved frames', () => {
  const frames = replayFrames([{ date: '2026-10-01', sectors },
    { date: '2026-10-02', sectors: sectors.map(s => ({ ...s, flow: s.flow * 1.1 })) }], 'day', { height: 780 });
  let callback, displayed;
  const player = createReplayPlayer({ length: frames.length, position: .4,
    render: p => { displayed = replayFrameAt(frames, p); },
    requestFrame: fn => { callback = fn; return 1; }, cancelFrame() {} });
  player.seek(.4);
  const before = displayed[0];
  frames.forEach((frame, i) => { frames[i] = zoomBubbleLayout(frame, { zoom: 2, panX: 20 }); });
  player.seek(player.position);
  assert.equal(player.position, .4);
  closeTo(displayed[0].ax, 260 + (before.ax - 240) * 2);
  assert.equal(displayed[0].x, before.x);
  player.play(); callback(0); callback(50);
  assert.ok(player.position > .4);
  assert.equal(displayed.length, 110);
  player.destroy();
});


test('landscape desktop uses the full width and keeps true axes through zoom and replay', () => {
  const layout = bubbleLayout(sectors, 'day', { width: 1280, height: 640 });
  assert.equal(layout.cx, 640);
  assert.equal(layout.points.length, 110);
  assert.ok(Math.max(...layout.points.map(p => p.ax)) - Math.min(...layout.points.map(p => p.ax)) > 850);
  for (const p of layout.points) {
    closeTo(layout.xScale.value((p.ax - layout.cx) / (152 * layout.horizontalStretch)) / 1e8, p.x / 1e8);
    closeTo(layout.yScale.value((layout.cy - p.ay) / (152 * layout.stretch)), p.y);
  }
  const html = bubbleChart(sectors, 'day', '', { layout });
  assert.match(html, /viewBox="0 0 1280 640"/);
  assert.match(html, /width="1197"/);
  assert.equal((html.match(/data-x-tick=/g) || []).length, 5);
  const moved = zoomBubbleLayout(layout, { zoom: 2, panX: 100 });
  assert.equal(moved.cx, 740);
  for (let i = 0; i < layout.points.length; i++) {
    closeTo(moved.points[i].ax, 740 + (layout.points[i].ax - 640) * 2);
    assert.equal(moved.points[i].radius, layout.points[i].radius);
  }
  const frames = replayFrames([{ date: '2026-10-01', sectors }, { date: '2026-10-02', sectors }], 'day', { width: 1280, height: 640 });
  assert.equal(frames[0].width, 1280);
  assert.equal(replayFrameAt(frames, .5).length, 110);
});
