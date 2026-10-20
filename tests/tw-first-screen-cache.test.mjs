import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Minimal asynchronous IndexedDB stand-in: open → transaction → objectStore get/put.
function fakeIndexedDB() {
  const stores = new Map();
  const later = fn => setTimeout(fn, 0);
  return {
    open() {
      const request = {};
      later(() => {
        const db = {
          createObjectStore() {},
          transaction(name) {
            const tx = {};
            const store = {
              get(key) { const r = {}; later(() => { r.result = structuredClone(stores.get(key)); later(() => tx.oncomplete?.()); }); return r; },
              put(value, key) { const r = {}; later(() => { stores.set(key, structuredClone(value)); r.result = key; later(() => tx.oncomplete?.()); }); return r; }
            };
            tx.objectStore = () => store;
            return tx;
          }
        };
        request.result = db; request.onupgradeneeded?.(); request.onsuccess?.();
      });
      return request;
    },
    stores
  };
}
const idb = fakeIndexedDB();
globalThis.indexedDB = idb;
const removed = [];
globalThis.localStorage = { removeItem: key => removed.push(key), getItem: () => null, setItem() {} };
const { firstScreenSnapshot, validFirstScreenSnapshot, readCachedRadar, writeCachedRadar } = await import('../src/markets/tw/radar-snapshot.js?first-screen-cache');
const { seedTWRadar, createTWMarketState } = await import('../src/markets/tw/engine.js');
const published = JSON.parse(readFileSync(new URL('../data/tw-radar.json', import.meta.url), 'utf8'));

test('first-screen cache keeps only the official mode lists and is far smaller than the full snapshot', () => {
  const slim = firstScreenSnapshot({ ...published, savedAt: Date.now() - 1000 });
  assert(validFirstScreenSnapshot(slim));
  assert.equal(slim.data.radar, undefined);
  assert.equal(slim.data.modes.risk.length, published.data.modes.risk.length);
  const ratio = JSON.stringify(slim).length / JSON.stringify(published).length;
  assert(ratio < .25, `cache is ${Math.round(ratio * 100)}% of the full snapshot`);
  assert.equal(firstScreenSnapshot({ ...published, savedAt: Date.now() - 8 * 86400000 }), null);
});

test('IndexedDB cache is written and read asynchronously, rejects older trading dates and drops the legacy localStorage copy', async () => {
  assert.equal(await readCachedRadar(), null);
  assert.deepEqual(removed, ['ox-tw-independent:ox-tw-official-radar-v3']);
  const fresh = { ...published, savedAt: Date.now() - 1000 };
  assert(await writeCachedRadar(fresh));
  const cached = await readCachedRadar();
  assert.equal(cached.data.dataDate, published.data.dataDate);
  const day = new Date(published.data.dataDate + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() - 1);
  const date = day.toISOString().slice(0, 10);
  const older = { ...published, savedAt: Date.now(), data: { ...published.data, dataDate: date, modesMeta: { ...published.data.modesMeta, asOf: date } } };
  assert.equal(await writeCachedRadar(older), false);
  assert.equal((await readCachedRadar()).data.dataDate, published.data.dataDate);
});

test('a cached mode list fills the first screen but the full snapshot still replaces it', () => {
  const slim = firstScreenSnapshot({ ...published, savedAt: Date.now() - 1000 });
  seedTWRadar(slim);
  const seeded = createTWMarketState().data;
  assert.equal(seeded.radarModes.risk.length, published.data.modes.risk.length);
  assert.equal(seeded.radar, undefined, 'the quote list is not invented from the cache');
  seedTWRadar({ ...published, savedAt: slim.savedAt });
  assert.equal(createTWMarketState().data.radar.length, published.data.radar.length);
  assert.equal(seedTWRadar(slim), createTWMarketState(), 'the cache never replaces lists already on screen');
});
