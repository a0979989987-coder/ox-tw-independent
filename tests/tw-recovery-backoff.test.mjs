import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryScheduler } from '../src/markets/tw/recovery.js';
import { twProvider } from '../src/markets/tw/api.js';

function clock() {
  const timers = new Map(); let id = 0;
  return { timers, setTimer(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimer(i) { timers.delete(i); },
    fire() { const [key, t] = [...timers][0]; timers.delete(key); t.fn(); return t.ms; } };
}

test('background recovery backs off 5s, 15s, 45s, then caps at two minutes', () => {
  const c = clock(); let runs = 0, scheduler;
  scheduler = createRecoveryScheduler({ needed: () => true, run: () => { runs++; scheduler.schedule(); }, setTimer: c.setTimer, clearTimer: c.clearTimer });
  scheduler.schedule(); scheduler.schedule();
  assert.equal(c.timers.size, 1, 'one pending attempt at a time');
  assert.deepEqual([c.fire(), c.fire(), c.fire(), c.fire(), c.fire()], [5000, 15000, 45000, 120000, 120000]);
  assert.equal(runs, 5);
});

test('recovery does not run once a verified snapshot is shown, pauses while hidden and retries once on return', () => {
  const c = clock(); let runs = 0, needed = true, hidden = false;
  const scheduler = createRecoveryScheduler({ needed: () => needed, hidden: () => hidden, run: () => runs++, setTimer: c.setTimer, clearTimer: c.clearTimer });
  scheduler.schedule(); needed = false; c.fire(); assert.equal(runs, 0, 'snapshot arrived before the timer');
  needed = true; scheduler.schedule(); hidden = true; scheduler.visibilityChanged();
  assert.equal(c.timers.size, 0, 'hidden tab holds no timer');
  scheduler.schedule(); assert.equal(c.timers.size, 0);
  hidden = false; scheduler.visibilityChanged(); scheduler.visibilityChanged();
  assert.equal(runs, 1, 'exactly one attempt on returning to the foreground');
});

test('concurrent requests to one endpoint share a single network request', async t => {
  twProvider.configure({ apiBase: 'https://taiwan.test/api' });
  let calls = 0, release;
  const gate = new Promise(r => release = r);
  t.mock.method(globalThis, 'fetch', async () => { calls++; await gate; return new Response(JSON.stringify({ ok: true, data: { value: 1 } })); });
  const a = twProvider.getMarketPulse(), b = twProvider.getMarketPulse();
  const controller = new AbortController();
  const c = twProvider.getMarketPulse({ signal: controller.signal });
  controller.abort();
  await assert.rejects(c, { code: 'TW_DATA_ABORTED' });
  release();
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
  await twProvider.getMarketPulse();
  assert.equal(calls, 2, 'a later request after completion is a new request');
});

test('a recovery attempt makes one request per endpoint instead of three', async t => {
  twProvider.configure({ apiBase: 'https://taiwan.test/api' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(twProvider.getBreadth({ retryDelays: [] }));
  assert.equal(calls, 1);
});
