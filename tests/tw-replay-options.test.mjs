import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLAY_SPEEDS, REPLAY_HISTORY_LIMIT, replayPositionForDate, replayOptionControls } from '../src/markets/tw/research-replay-options.js';
import { createReplayPlayer } from '../src/markets/tw/research-replay.js';
import { createReplayHistoryLoader } from '../src/markets/tw/research-replay-data.js';
import { mergeResearchHistory } from '../src/markets/tw/research-data.js';
import { SECTOR_TAXONOMY_VERSION } from '../src/markets/tw/sector-taxonomy.js';

function dates(start, end) {
  const result = [], cursor = new Date(`${start}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    result.push({ date: cursor.toISOString().slice(0, 10) }); cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
function clock() {
  let id = 0; const pending = new Map();
  return { pending, requestFrame(fn) { pending.set(++id, fn); return id; }, cancelFrame(id) { pending.delete(id); },
    step(t) { const frames = [...pending.values()]; pending.clear(); frames.forEach(fn => fn(t)); } };
}

test('replay controls retain ten speeds and omit the period selector', () => {
  const html = replayOptionControls(0.3);
  assert.equal((html.match(/<option /g) || []).length, 10);
  assert.match(html, /value="0.3" selected/);
  assert.doesNotMatch(html, /data-replay-period|回放期間/);
});

test('loading older history retains the fractional date and clamps when a date is unavailable', () => {
  const original = dates('2026-09-01', '2026-10-08'), expanded = dates('2026-08-01', '2026-10-08');
  assert.equal(replayPositionForDate(original, 3.25, expanded), 34.25);
  const shorter = expanded.slice(-7);
  assert.equal(replayPositionForDate(original, 3.25, shorter), 0);
  assert.equal(replayPositionForDate(original, original.length - 1, shorter), shorter.length - 1);
});

test('all ten rates including 0.1x control real elapsed time and preserve pause, seek and resume', () => {
  assert.ok(REPLAY_SPEEDS.length >= 6); assert.ok(REPLAY_SPEEDS.includes(0.1));
  for (const speed of REPLAY_SPEEDS) {
    const time = clock();
    const player = createReplayPlayer({ length: 200, render() {}, speed, ...time });
    player.play(); time.step(0); time.step(1200);
    assert.ok(Math.abs(player.position - speed) < 1e-8, `rate ${speed}`);
    player.pause(); const position = player.position;
    player.setSpeed(0.1); time.step(2000); assert.equal(player.position, position);
    player.play(); time.step(3000); time.step(4200);
    assert.ok(Math.abs(player.position - position - 0.1) < 1e-8);
    player.seek(15.5); assert.equal(player.playing, false);
    player.setSpeed(4); player.play(); time.step(5000); time.step(6200);
    assert.equal(player.position, 19.5); assert.equal(time.pending.size, 1);
    player.destroy(); assert.equal(time.pending.size, 0);
  }
});

test('on-demand archive loading is shared, stays within its date, and preserves repaired observations', async () => {
  let calls = 0;
  const archive = dates('2025-01-01', '2026-10-09').map(day => ({ ...day, sectors: [] }));
  const repaired = { date: '2026-10-07', sectors: [{ name: '半導體', flow: 7 }], themeVersion: SECTOR_TAXONOMY_VERSION,
    coverageVersion: 'complete-market-report-v2', sourceHealth: { TWSE: { complete: true }, TPEX: { complete: true } } };
  archive[archive.findIndex(day => day.date === repaired.date)] = repaired;
  const snapshot = { date: '2026-10-08', history: [{ date: '2026-10-07', sectors: [] }, { date: '2026-10-08', sectors: [] }] };
  const load = createReplayHistoryLoader(async () => { calls++; return new Response(JSON.stringify(archive)); });
  assert.equal(calls, 0);
  const [first, second] = await Promise.all([load(snapshot), load(snapshot)]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  assert.equal(first.history.length, REPLAY_HISTORY_LIMIT); assert.ok(first.history.length > 280);
  assert.equal(first.history.at(-1).date, snapshot.date); assert.equal(first.error, null);
  assert.deepEqual(first.history.find(day => day.date === repaired.date), repaired);
  await load(snapshot); assert.equal(calls, 1);
  assert.equal(mergeResearchHistory(archive, [], snapshot.date).length, 60);
});

test('failed or malformed archive loads retain the current usable data and can retry', async () => {
  const snapshot = { date: '2026-10-08', history: dates('2026-10-01', '2026-10-08') };
  for (const response of [new Response('', { status: 503 }), new Response('{broken'), new Response(JSON.stringify({ history: [] })), new Response('[null]')]) {
    let calls = 0;
    const load = createReplayHistoryLoader(async () => ++calls === 1 ? response : new Response(JSON.stringify(snapshot.history)));
    const failed = await load(snapshot);
    assert.equal(failed.history, snapshot.history); assert.ok(failed.error);
    const recovered = await load(snapshot);
    assert.equal(recovered.error, null); assert.deepEqual(recovered.history, snapshot.history); assert.equal(calls, 2);
  }
});

test('seeking during playback preserves running state and manual pause remains paused', () => {
  const time = clock();
  const player = createReplayPlayer({ length: 40, render() {}, ...time });
  player.play(); time.step(0); time.step(600);
  player.seek(12.25, { pause: false });
  assert.equal(player.playing, true); assert.equal(time.pending.size, 1);
  time.step(1200); time.step(1800); assert.equal(player.position, 12.75);
  player.pause(); player.seek(8, { pause: false }); time.step(2400);
  assert.equal(player.playing, false); assert.equal(player.position, 8);
  player.destroy(); assert.equal(time.pending.size, 0);
});
