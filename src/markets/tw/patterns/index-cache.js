import { dataDate, TIMEFRAMES } from './source.js?v=20261002-rank8';
export const INDEX_VERSION = 4;
const memory = new Map(); let opening;
export function entryCurrent(entry) {
  const d = entry?.data, date = dataDate();
  return entry?.version === INDEX_VERSION && Object.hasOwn(TIMEFRAMES,d?.frame||'') && d.candles?.length >= 35 && (date ? d.dataDate === date : Date.now() - d.serverTime < 86400000);
}
function database() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return opening ??= new Promise(resolve => {
    let request; try { request = indexedDB.open('ox-tw-independent:ox-tw-pattern-index', 1); } catch { return resolve(null); }
    request.onupgradeneeded = () => request.result.createObjectStore('series', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = request.onblocked = () => resolve(null);
  });
}
export async function readIndex(frames) {
  const db = await database();
  if (db) await new Promise(resolve => {
    let request; try { request = db.transaction('series').objectStore('series').getAll(); } catch { return resolve(); }
    request.onsuccess = () => { for (const entry of request.result) if (entryCurrent(entry)) memory.set(entry.key, entry); resolve(); }; request.onerror = () => resolve();
  });
  return [...memory.values()].filter(entry => frames.includes(entry.data.frame) && entryCurrent(entry));
}
// While a whole market streams in, writes share a transaction per slice of
// 20 stocks (one slice per task) instead of one transaction per stock.
const writes = new Map(); let flushTimer = 0;
async function flush() {
  const batch = [...writes.values()].slice(0, 20); for (const entry of batch) writes.delete(entry.key);
  flushTimer = writes.size ? setTimeout(flush, 0) : 0;
  const db = await database(); if (!db || !batch.length) return;
  try { const tx = db.transaction('series', 'readwrite'), store = tx.objectStore('series'); for (const entry of batch) store.put(entry); tx.onerror = () => {}; } catch {}
}
export async function saveIndex(data, matches) {
  const entry = { key: data.symbol + ':' + data.frame, data, matches, version: INDEX_VERSION, savedAt: Date.now() }; memory.set(entry.key, entry);
  writes.set(entry.key, entry); flushTimer ||= setTimeout(flush, 400);
}
export async function pruneIndex() {
  for (const [key, entry] of memory) if (!entryCurrent(entry)) memory.delete(key);
  const db = await database(); if (!db) return;
  try { const tx = db.transaction('series', 'readwrite'), request = tx.objectStore('series').openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (!entryCurrent(cursor.value)) cursor.delete(); cursor.continue(); }; tx.onerror = () => {}; } catch {}
}
