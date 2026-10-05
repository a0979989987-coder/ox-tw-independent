import test from 'node:test';
import assert from 'node:assert/strict';
import { retryTWRequest, radarAvailability, radarNeedsRecovery } from '../src/markets/tw/recovery.js';
import { twProvider } from '../src/markets/tw/api.js';
import { twProvider as engineProvider } from '../src/markets/tw/api.js?v=20261005-recovery20';
import { refreshTWMarketState } from '../src/markets/tw/engine.js';
import handleTW from '../api/v1/tw/[endpoint].js';

twProvider.configure({apiBase:'https://taiwan.test/api'});
engineProvider.configure({apiBase:'https://taiwan.test/api'});
const failure = (code, status = 0) => Object.assign(new Error('test connection failure'), { code, status });
const modesMeta = { risk: { status: 'ready' }, disposal: { status: 'ready' }, release: { status: 'ready' }, asOf: '2026-09-30' };

test('TW retries transient failures with bounded backoff and returns the recovered result', async () => {
  const waits = []; let calls = 0;
  const result = await retryTWRequest(() => {
    if (++calls === 1) throw failure('TW_DATA_NETWORK_ERROR');
    if (calls === 2) throw failure('TW_DATA_HTTP_ERROR', 503);
    return 'official data';
  }, { wait: async ms => waits.push(ms) });
  assert.equal(result, 'official data'); assert.equal(calls, 3);
  assert.deepEqual(waits, [750, 1750]);
  calls = 0;
  await assert.rejects(retryTWRequest(() => { calls++; throw failure('TW_DATA_NETWORK_ERROR'); }, { wait: async () => {} }));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retryTWRequest(() => { calls++; throw failure('TW_DATA_INVALID_RESPONSE', 502); }, { wait: async () => {} }));
  assert.equal(calls, 3, 'temporary gateway HTML errors remain retryable');
});

test('TW does not retry forbidden, invalid input, cancellation or invalid successful JSON', async () => {
  for (const error of [failure('TW_DATA_HTTP_ERROR', 403), failure('TW_DATA_HTTP_ERROR', 400), failure('TW_DATA_ABORTED'), failure('TW_DATA_INVALID_RESPONSE', 200)]) {
    let calls = 0;
    await assert.rejects(retryTWRequest(() => { calls++; throw error; }, { wait: async () => assert.fail('unexpected retry') }));
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(retryTWRequest(() => { calls++; throw failure('TW_DATA_NETWORK_ERROR'); }, {
    signal: controller.signal, wait: async () => controller.abort()
  }), { code: 'TW_DATA_ABORTED' });
  assert.equal(calls, 1);
});

test('TW aborts a real pending backoff immediately and caps timeout retries', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = retryTWRequest(() => { calls++; throw failure('TW_DATA_NETWORK_ERROR'); }, { signal: controller.signal, delays: [60000],budgetMs:120000 });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { code: 'TW_DATA_ABORTED' }); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retryTWRequest(() => { calls++; throw failure('TW_DATA_TIMEOUT'); }, { wait: async () => {} }));
  assert.equal(calls, 2);
});

test('Taiwan gateway accepts only the independent site Origin and rejects the original site', async t => {
  const previous=process.env.OX_ALLOWED_ORIGINS;
  process.env.OX_ALLOWED_ORIGINS='https://ox-tw-independent.btcfly.chatgpt.site';
  t.after(()=>{if(previous===undefined)delete process.env.OX_ALLOWED_ORIGINS;else process.env.OX_ALLOWED_ORIGINS=previous;});
  for (const [origin, status] of [[undefined, 200], ['https://ox-tw-independent.btcfly.chatgpt.site', 200], ['https://ox-crypto-screener.vercel.app', 403], ['https://a0979989987-coder.github.io', 403], ['https://untrusted.example', 403]]) {
    const response = { headers: {}, status(code) { this.code = code; }, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
    await handleTW({ method: 'GET', headers: { origin }, query: { endpoint: 'health' } }, response);
    assert.equal(response.code, status, origin);
    assert.equal(response.body.ok, status === 200);
    if (origin && status === 200) assert.equal(response.headers['Access-Control-Allow-Origin'], origin);
  }
});

test('TW distinguishes unavailable lists from confirmed empty lists and dates retained data', () => {
  const offline = radarAvailability({ status: 'error', data: null }, 'risk', 0);
  assert.equal(offline.count, '—'); assert(offline.unavailable && offline.retry);
  const empty = radarAvailability({ status: 'ready', data: { radarModesMeta: modesMeta } }, 'risk', 0);
  assert.equal(empty.count, '0'); assert(!empty.unavailable && !empty.retry);
  const cached = { status: 'partial', data: { radarModesMeta: modesMeta, usingCachedRadar: true,
    radarUpdatedAt: '2026-09-30T07:30:00Z', meta: { sourceErrors: { radar: failure('TW_DATA_NETWORK_ERROR') } } } };
  assert.equal(radarAvailability(cached, 'risk', 121).count, '121');
  assert.match(radarAvailability(cached, 'risk', 121).notice, /上次成功資料.*09\/30.*15:30/);
  assert(radarNeedsRecovery(cached));
  assert(!radarNeedsRecovery({ status: 'ready', data: { radarModesMeta: modesMeta } }));
});

test('TW engine retains official radar membership on partial and total outage, then accepts a genuine empty result', async t => {
  let mode = 'ready';
  const radar = { radar: [{ symbol: '2330', name: '台積電', market: 'TWSE', price: 100 }],
    modes: { risk: [{ symbol: '2330', name: '台積電', market: 'TWSE' }], disposal: [], release: [] }, modesMeta };
  t.mock.method(globalThis, 'fetch', async input => {
    const endpoint = new URL(input).pathname.split('/').at(-1);
    if (mode === 'total' || mode === 'partial' && endpoint === 'radar') return new Response('{"ok":false}', { status: 403 });
    const data = endpoint === 'radar' ? mode === 'empty' ? { radar: [], modes: { risk: [], disposal: [], release: [] }, modesMeta } : radar : {};
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  });
  const ready = await refreshTWMarketState({ force: true });
  assert.equal(ready.data.radarModes.risk[0].symbol, '2330');
  const lastUpdate = ready.data.radarUpdatedAt;
  mode = 'partial'; const partial = await refreshTWMarketState({ force: true });
  assert.equal(partial.status, 'partial'); assert.equal(partial.data.radar.length, 1);
  assert.equal(partial.data.radarModes.risk[0].symbol, '2330');
  assert.equal(partial.data.radarUpdatedAt, lastUpdate); assert(partial.data.usingCachedRadar);
  mode = 'total'; const offline = await refreshTWMarketState({ force: true });
  assert.equal(offline.status, 'error'); assert.equal(offline.data.radarModes.risk.length, 1);
  mode = 'empty'; const empty = await refreshTWMarketState({ force: true });
  assert.equal(empty.status, 'ready'); assert.equal(empty.data.radarModes.risk.length, 0);
  assert(!empty.data.usingCachedRadar); assert(!empty.data.meta.sourceErrors.radar);
});

test('TW API integration retries a dropped fetch without retrying forbidden requests', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) throw new TypeError('Failed to fetch');
    return new Response('{"ok":true,"data":{"service":"official"}}');
  });
  assert.equal((await twProvider.health()).service, 'official'); assert.equal(calls, 2);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{"ok":false}', { status: 403 }); });
  calls = 0; await assert.rejects(twProvider.health(), { code: 'TW_DATA_HTTP_ERROR', status: 403 }); assert.equal(calls, 1);
});
