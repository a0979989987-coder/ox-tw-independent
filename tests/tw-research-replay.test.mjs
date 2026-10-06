import test from 'node:test';
import assert from 'node:assert/strict';
import { replayHistory, replayFrames, replayFrameAt, drawReplayFrame, createReplayPlayer } from '../src/markets/tw/research-replay.js';

const sector = (name, flow, size = 100) => ({ name, count: 1, covered: 1, flow, changePct: flow / 100,
  turnoverTwd: size, flow5: flow, flow20: size, momentum: flow / 5 });

test('historical money movement uses each dated rolling window and keeps unavailable sessions', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, sectors: [sector('晶圓代工', i + 1)] }));
  const days = replayHistory([...history, history[0]], 'momentum');
  assert.equal(days.length, 6);
  assert.equal(days[0].date, '2026-09-20');
  assert.equal(days[0].sectors[0].flow5, 90);
  assert.equal(days[0].sectors[0].flow20, 210);
  assert.equal(days[0].sectors[0].momentum, 7.5);
  history[21] = { ...history[21], sectors: [], unavailable: true };
  const incomplete = replayHistory(history, 'momentum');
  assert.equal(incomplete.length, 6);
  assert.equal(incomplete[2].sectors.length, 0);
  assert.equal(incomplete.at(-1).sectors[0].momentum, null);
  assert.equal(replayHistory(history.slice(0, 19), 'momentum').length, 0);
});

test('replay fixes scales and top-ten membership throughout changing rankings', () => {
  const first = Array.from({ length: 12 }, (_, i) => sector(`類股${i}`, i + 1));
  const next = first.map((s, i) => ({ ...s, flow: i === 11 ? 10000 : s.flow }));
  const frames = replayFrames([{ date: '2026-09-21', sectors: first }, { date: '2026-09-22', sectors: next }], 'day', { density: 'top' });
  assert.equal(frames[0].points.length, 10);
  assert.deepEqual(frames[0].points.map(p => p.name), frames[1].points.map(p => p.name));
  const unchanged = frames.map(frame => frame.points.find(p => p.name === '類股10'));
  assert.equal(unchanged[0].ax, unchanged[1].ax);
  assert.equal(unchanged[0].ay, unchanged[1].ay);
});

test('position, radius and color pass through intermediate values; missing data fades rather than becoming zero', () => {
  const frames = replayFrames([{ date: '2026-09-21', sectors: [sector('HBM', -20, 10)] },
    { date: '2026-09-22', sectors: [sector('HBM', 200, 1000)] },
    { date: '2026-09-23', sectors: [] }], 'day');
  const a = replayFrameAt(frames, 0)[0], mid = replayFrameAt(frames, .5)[0], b = replayFrameAt(frames, 1)[0];
  for (const key of ['px', 'py', 'ax', 'ay', 'radius']) assert.equal(mid[key], (a[key] + b[key]) / 2);
  assert.notEqual(mid.color, a.color); assert.notEqual(mid.color, b.color);
  assert.equal(mid.x, a.x); // Values stay on the dated observation.
  const gap = replayFrameAt(frames, 1.5)[0];
  assert.equal(gap.opacity, .5); assert.equal(gap.x, 200);
  assert.equal(replayFrameAt(frames, 2)[0].opacity, 0);
  assert.equal(replayFrameAt(frames, 99)[0].opacity, 0);
});

function clock() {
  let id = 0;
  const pending = new Map();
  return { pending, requestFrame(fn) { pending.set(++id, fn); return id; }, cancelFrame(id) { pending.delete(id); },
    step(t) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(t)); } };
}

test('one frame clock preserves fractional pause/resume, responds to speed, and cancels after leaving', () => {
  const time = clock(), positions = []; let active = true;
  const player = createReplayPlayer({ length: 5, render: p => positions.push(p), ...time, isActive: () => active });
  player.play(); player.play(); assert.equal(time.pending.size, 1);
  time.step(0); for (let t = 20; t <= 600; t += 20) time.step(t);
  assert.ok(Math.abs(player.position - .5) < 1e-8);
  assert.ok(new Set(positions).size >= 30);
  player.pause(); const paused = player.position; assert.equal(time.pending.size, 0);
  time.step(2000); assert.equal(player.position, paused);
  player.play(); time.step(2100); time.step(2120); assert.ok(player.position > paused);
  player.setSpeed(2); const previous = player.position; time.step(2140);
  assert.ok(Math.abs(player.position - previous - 40 / 1200) < 1e-8);
  player.seek(2.25); assert.equal(player.position, 2.25); assert.equal(time.pending.size, 0);
  player.play(); active = false; time.step(2200);
  assert.equal(player.playing, false); assert.equal(time.pending.size, 0);
  player.destroy(); player.play(); assert.equal(time.pending.size, 0);
});

test('replay finishes on the final observation and restart starts at the first one', () => {
  const time = clock();
  const player = createReplayPlayer({ length: 2, position: .95, render() {}, ...time });
  player.play(); time.step(0); time.step(100);
  assert.equal(player.position, 1); assert.equal(player.playing, false);
  assert.equal(time.pending.size, 0);
  player.play(); assert.equal(player.position, 0); player.destroy();
});

test('SVG updates retain the exact same label and circle objects across animation frames', () => {
  const element = () => ({ attrs: {}, style: { setProperty(key, value) { this[key] = value; } },
    setAttribute(key, value) { this.attrs[key] = String(value); } });
  const circle = element(), label = element(), value = element(), title = element(), line = element();
  const group = { ...element(), dataset: { sector: 'HBM' },
    querySelector: selector => ({ circle, '.twx-bubble-label': label, '.twx-bubble-value': value, title })[selector],
    querySelectorAll: () => [line] };
  const svg = { querySelectorAll: selector => selector === '.twx-bubble' ? [group] : [] };
  Object.defineProperty(svg, 'innerHTML', { set() { throw new Error('Replay replaced the chart'); } });
  const frames = replayFrames([{ date: '2026-09-21', sectors: [sector('HBM', -20)] },
    { date: '2026-09-22', sectors: [sector('HBM', 30)] }], 'day');
  const positions = new Set();
  for (let p = 0; p <= 1; p += .05) {
    drawReplayFrame(svg, replayFrameAt(frames, p), 'day');
    positions.add(circle.attrs.cx);
    assert.equal(group.querySelector('.twx-bubble-label'), label);
    assert.equal(group.querySelector('circle'), circle);
    assert.equal(line.attrs.x, circle.attrs.cx);
  }
  assert.ok(positions.size >= 19);
});

test('daily replay skips empty leading history but retains an internal unavailable session', () => {
 const sector={name:'A',flow:1,changePct:2,turnoverTwd:100};
 const days=[{date:'2026-09-01',sectors:[]},{date:'2026-09-02',sectors:[sector]},{date:'2026-09-03',sectors:[]},{date:'2026-09-04',sectors:[sector]}];
 assert.deepEqual(replayHistory(days,'day').map(day=>day.date),['2026-09-02','2026-09-03','2026-09-04']);
});
