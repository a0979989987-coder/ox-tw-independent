import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBubbleGestures } from '../src/markets/tw/research-gestures.js';
import { replayFrames, replayFrameAt, replayWindow, zoomReplayFrames, createReplayPlayer } from '../src/markets/tw/research-replay.js';
import { zoomBubbleLayout } from '../src/markets/tw/research-bubbles.js';

const sector = (name, flow, size = 100) => ({ name, count: 1, covered: 1, flow, changePct: flow / 100, turnoverTwd: size, flow5: flow, flow20: size, momentum: flow / 5 });
const days = Array.from({ length: 46 }, (_, d) => ({ date: `2026-08-${String(d + 1).padStart(2, '0')}`, sectors: Array.from({ length: 12 }, (_, i) => sector(`類股${i}`, (i + 1) * (d % 5 + 1) - 20, 100 + i * 10)) }));

function fakeChart() {
  const handlers = new Map(), captured = new Set();
  const chart = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 494 }), viewBox: { baseVal: { width: 480, height: 494 } } };
  const target = { closest: selector => selector === '.twx-bubbles' ? chart : null };
  const root = {
    addEventListener(type, fn) { handlers.set(type, fn); },
    querySelector: () => chart,
    hasPointerCapture: id => captured.has(id), setPointerCapture: id => captured.add(id), releasePointerCapture: id => captured.delete(id),
    fire(type, init) { handlers.get(type)?.({ target, preventDefault() {}, button: 0, ...init }); }
  };
  return root;
}

test('pinch and drag during playback never pause the replay, and the clock keeps advancing', () => {
  let rafs = [], position = 0;
  const frames = replayFrames(days, 'day');
  const player = createReplayPlayer({ length: frames.length, render(p) { position = p; }, requestFrame: fn => rafs.push(fn), cancelFrame() {} });
  const pause = player.pause; let pauses = 0;
  player.pause = (...args) => { pauses++; return pause(...args); };
  player.play();
  const prefs = { zoom: 2, panX: 0, panY: 0, replayIndex: 0 };
  const s = { player, replayFrames: frames }, draws = [];
  let settled = 0;
  const tick = t => { const queued = rafs; rafs = []; for (const fn of queued) fn(t); };
  tick(0);
  const root = fakeChart();
  attachBubbleGestures(root, { session: s, prefs, minZoom: () => 1, draw: options => draws.push(options), settle: () => settled++, repaint() {} });
  root.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 200 });
  root.fire('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 280, clientY: 200 });
  for (let i = 1; i <= 10; i++) {
    root.fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 200 - i * 4, clientY: 200 });
    root.fire('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 280 + i * 4, clientY: 200 });
    tick(i * 100);
  }
  assert(prefs.zoom > 2, 'pinch zoomed in');
  assert(draws.length > 0 && draws.every(options => options.partial), 'moves request partial redraws only');
  root.fire('pointerup', { pointerType: 'touch', pointerId: 1 });
  root.fire('pointerup', { pointerType: 'touch', pointerId: 2 });
  assert.equal(settled, 1, 'all frames are recomputed once, when the gesture ends');
  assert.equal(pauses, 0);
  assert(player.playing && position > 0.5, `replay advanced to ${position}`);
});

test('a partial zoom moves only the frames on screen; settling brings the rest to the same view', () => {
  const frames = replayFrames(days, 'day'), view = { zoom: 3, panX: 20, panY: -10 };
  const [from, to] = replayWindow(10.4, frames.length);
  assert.deepEqual([from, to], [6, 12]);
  assert.equal(zoomReplayFrames(frames, view, from, to), 7);
  const reference = replayFrames(days, 'day').map(frame => zoomBubbleLayout(frame, view));
  assert.deepEqual(replayFrameAt(frames, 10.4), replayFrameAt(reference, 10.4), 'the drawn frame matches a fully zoomed replay');
  assert.equal(zoomReplayFrames(frames, view), frames.length - 7);
  assert.equal(zoomReplayFrames(frames, view), 0, 'already in view: nothing recomputed');
});
