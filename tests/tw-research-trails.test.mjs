import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleChart, zoomBubbleLayout } from '../src/markets/tw/research-bubbles.js';
import { replayFrames, replayFrameAt, drawReplayFrame } from '../src/markets/tw/research-replay.js';

const sector = (name, flow, changePct = 1) => ({ name, flow, changePct, turnoverTwd: 1000 });
const day = (date, sectors) => ({ date, sectors });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const pathLength = trail => trail.reduce((sum, { from, to }) => sum + Math.hypot(to.px - from.px, to.py - from.py), 0);

test('replay movement follows observations, not another sector changing the label layout', () => {
  const fixed = sector('不動板塊', 20);
  const frames = replayFrames([
    day('2026-10-01', [fixed, sector('移動板塊', 20)]),
    day('2026-10-02', [fixed, sector('移動板塊', -80, -3)]),
    day('2026-10-05', [fixed, sector('移動板塊', 50, 4)])
  ], 'day');
  for (const frame of frames) for (const point of frame.points) {
    assert.equal(point.px, point.ax); assert.equal(point.py, point.ay);
  }
  const start = replayFrameAt(frames, 0).find(p => p.name === fixed.name);
  for (const position of [.25, .8, 1, 1.6, 2]) {
    const point = replayFrameAt(frames, position).find(p => p.name === fixed.name);
    near(point.px, start.px); near(point.py, start.py);
    assert.equal(pathLength(point.trail), 0);
  }
});

test('each bubble has a fading contiguous tail behind its labels without annotation leaders', () => {
  const frames = replayFrames([
    day('2026-10-01', [sector('A', -30, 1), sector('B', 10, -1)]),
    day('2026-10-02', [sector('A', -5, 2), sector('B', 40, -4)]),
    day('2026-10-05', [sector('A', -10, 4), sector('B', 90, -3)])
  ], 'day');
  const points = replayFrameAt(frames, 1.7);
  for (const point of points) {
    assert.ok(point.trail.length > 1);
    near(point.trail[0].from.px, frames[0].points.find(p => p.name === point.name).px);
    near(point.trail.at(-1).to.px, point.px); near(point.trail.at(-1).to.py, point.py);
    for (let i = 1; i < point.trail.length; i++) {
      const a = point.trail[i - 1], b = point.trail[i];
      near(a.to.px, b.from.px); near(a.to.py, b.from.py);
      assert.ok(a.opacity <= b.opacity);
    }
    // A and B remain in opposite quadrants; neither tail can join the other.
    for (const segment of point.trail) for (const p of [segment.from, segment.to]) {
      assert.equal(p.px < frames[0].cx, point.name === 'A');
      assert.equal(p.py < frames[0].cy, point.name === 'A');
    }
  }
  const html = bubbleChart([], 'day', '', { layout: frames[0] });
  assert.equal((html.match(/data-trail-sector=/g) || []).length, 2);
  assert.doesNotMatch(html, /data-anchor-sector="[^"]+"[^>]*><line/);
  assert.ok(html.indexOf('class="twx-bubble-trails"') < html.indexOf('class="twx-bubble '));
  assert.doesNotMatch(html, /<circle r="2.3"/);
  assert.equal((bubbleChart([sector('A', 1)]).match(/data-trail-sector=/g) || []).length, 0);
});

test('missing sessions break trails and fade-in never travels from an older missing position', () => {
  const frames = replayFrames([
    day('2026-10-01', [sector('A', -100)]),
    day('2026-10-02', []),
    day('2026-10-05', [sector('A', 100)]),
    day('2026-10-06', [sector('A', 80)])
  ], 'day');
  for (const position of [.5, 1, 1.5, 2]) assert.deepEqual(replayFrameAt(frames, position)[0].trail, []);
  const reappearing = replayFrameAt(frames, 1.5)[0];
  near(reappearing.px, frames[2].points[0].px);
  near(reappearing.py, frames[2].points[0].py);
  const resumed = replayFrameAt(frames, 2.5)[0];
  assert.ok(resumed.trail.length);
  assert.ok(resumed.trail.every(s => s.from.px > frames[0].cx && s.to.px > frames[0].cx));
});

test('seeking is deterministic and zoom transforms past and present together', () => {
  const frames = replayFrames([
    day('2026-10-01', [sector('A', 10)]),
    day('2026-10-02', [sector('A', 11)]),
    day('2026-10-05', [sector('A', 12)])
  ], 'day');
  const before = replayFrameAt(frames, 1.7)[0];
  replayFrameAt(frames, .1);
  assert.deepEqual(replayFrameAt(frames, 1.7)[0].trail, before.trail);
  assert.deepEqual(replayFrameAt(frames, 0)[0].trail, []);
  const moved = frames.map(frame => zoomBubbleLayout(frame, { zoom: 2, panX: 20, panY: -30 }));
  const after = replayFrameAt(moved, 1.7)[0];
  assert.equal(after.trail.length, before.trail.length);
  for (let i = 0; i < after.trail.length; i++) for (const endpoint of ['from', 'to']) {
    near(after.trail[i][endpoint].px, moved[0].cx + (before.trail[i][endpoint].px - frames[0].cx) * 2);
    near(after.trail[i][endpoint].py, moved[0].cy + (before.trail[i][endpoint].py - frames[0].cy) * 2);
  }
});

test('SVG trail nodes are reused and cleared when seeking back to the start', () => {
  const element = () => ({ attrs: {}, style: { setProperty(key, value) { this[key] = value; } },
    setAttribute(key, value) { this.attrs[key] = String(value); } });
  const circle = element(), label = element(), value = element(), title = element(), text = element();
  const paths = Array.from({ length: 6 }, element), dots = Array.from({length:6}, element);
  const trail = { ...element(), dataset: { trailSector: 'A' }, querySelectorAll: selector => selector === 'path' ? paths : dots };
  const group = { ...element(), dataset: { sector: 'A' },
    querySelector: s => ({ circle, '.twx-bubble-label': label, '.twx-bubble-value': value, title })[s],
    querySelectorAll: () => [text] };
  const svg = { querySelectorAll: s => s === '.twx-bubble' ? [group] : s === '[data-trail-sector]' ? [trail] : [] };
  Object.defineProperty(svg, 'innerHTML', { set() { throw Error('Chart was replaced'); } });
  const frames = replayFrames([day('2026-10-01', [sector('A', 1)]), day('2026-10-02', [sector('A', 10)])], 'day');
  drawReplayFrame(svg, replayFrameAt(frames, .8), 'day');
  assert.ok(paths.some(path => path.attrs.d.startsWith('M')));
  assert.match(trail.style['--bubble'], /^#[0-9a-f]{6}$/);
  drawReplayFrame(svg, replayFrameAt(frames, 0), 'day');
  assert.ok(paths.every(path => path.attrs.d === '' && path.style.opacity === 0));
});

test('threshold crossings retain their observed location and fade without a position jump', () => {
  const frames = replayFrames([
    day('2026-10-01', [sector('A', 2e9)]), day('2026-10-02', [sector('A', .5e9)]),
    day('2026-10-05', [sector('A', -2e9)]), day('2026-10-06', [sector('A', -3e9)])
  ], 'day', { minFlow: 1e9 });
  assert.equal(frames[1].points[0].opacity, 0);
  assert.notEqual(frames[1].points[0].px, frames[0].points[0].px);
  for (const boundary of [1, 2]) {
    const before = replayFrameAt(frames, boundary - 1e-5)[0];
    const after = replayFrameAt(frames, boundary + 1e-5)[0];
    assert.ok(Math.abs(before.px - after.px) < .02);
    assert.ok(Math.abs(before.opacity - after.opacity) < .001);
  }
  assert.equal(replayFrameAt(frames, 1)[0].opacity, 0);
  assert.equal(replayFrameAt(frames, .5)[0].opacity, .5);
});

test('smooth dated turns share velocity and cannot overshoot either coordinate', () => {
  const frames = replayFrames([10, 20, 30, 35, 20].map((flow, i) => day(`2026-10-0${i+1}`, [sector('A', flow, flow / 4)])), 'day');
  const epsilon = 1e-4;
  for (const index of [1, 2, 3]) {
    const a = replayFrameAt(frames, index - epsilon)[0], b = replayFrameAt(frames, index)[0], c = replayFrameAt(frames, index + epsilon)[0];
    for (const key of ['px', 'py']) assert.ok(Math.abs((b[key] - a[key]) / epsilon - (c[key] - b[key]) / epsilon) < .1);
  }
  for (let index = 0; index < frames.length - 1; index++) for (let t = 0; t <= 1; t += .02) {
    const point = replayFrameAt(frames, index + t)[0];
    for (const key of ['px', 'py']) {
      const endpoints = [frames[index].points[0][key], frames[index+1].points[0][key]];
      assert.ok(point[key] >= Math.min(...endpoints) - 1e-8 && point[key] <= Math.max(...endpoints) + 1e-8);
    }
  }
});

test('a disappearing sector keeps its old tail while fading, and trail visibility does not change the frame', () => {
  const frames = replayFrames([day('2026-10-01', [sector('A', 10)]), day('2026-10-02', [sector('A', 30)]), day('2026-10-05', [])], 'day');
  const departing = replayFrameAt(frames, 1.5)[0];
  assert.equal(departing.opacity, .5);
  assert.ok(departing.trail.length > 0);
  near(departing.trail.at(-1).to.px, departing.px);
  const hidden = replayFrameAt(frames, 1.5, { trails:false })[0];
  assert.deepEqual(hidden.trail, []);
  assert.deepEqual({...departing,trail:[]},hidden);
  assert.deepEqual(replayFrameAt(frames, 2)[0].trail, []);
});
