import { ensureBundleManifest, ensureBundleChunks, bundleChunks, bundleChunkStatus, bundleState, subscribeBundle, ensureHistoryChunks, bundleHistoryChunks, bundleHistoryStatus } from './bundle.js?v=20261005-load16';
// Progressive pattern-board loading. The manifest comes first, then the chunks
// holding what the screen needs (selected, visible, watchlist, radar
// candidates), then the rest of the market in the background: two downloads
// at a time (the very first alone, so the first results appear sooner), a
// progress-based timeout per download, one retry with backoff, no new download
// while the page is hidden. With Save-Data only the first step runs until the
// user asks for the whole market. Downloaded chunks stay in memory.
export const PRIORITY_WEIGHTS = Object.freeze({ selected: 1000, visible: 300, watchlist: 100, tier: [0, 30, 20, 10] });
// Weights order every chunk; `pinned` (selected, visible, watchlist) also
// defines the first step.
export function priorityPlan({ selected = [], visible = [], watchlist = [], candidates = [] } = {}) {
  const weights = new Map(), pinned = new Set(), add = (symbol, weight, pin) => { if (!symbol) return; weights.set(symbol, (weights.get(symbol) || 0) + weight); if (pin) pinned.add(symbol); };
  for (const row of candidates) add(row.symbol, PRIORITY_WEIGHTS.tier[row.tier] || PRIORITY_WEIGHTS.tier[3], false);
  for (const symbol of watchlist) add(symbol, PRIORITY_WEIGHTS.watchlist, true);
  for (const symbol of visible) add(symbol, PRIORITY_WEIGHTS.visible, true);
  for (const symbol of [].concat(selected)) add(symbol, PRIORITY_WEIGHTS.selected, true);
  return { weights, pinned };
}
// Highest weighted score first; manifest order (by turnover) on ties.
export function prioritizeChunks(chunks, weights) {
  return chunks.map((chunk, index) => ({ chunk, index, score: (chunk.symbols || []).reduce((n, symbol) => n + (weights.get(symbol) || 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
// First step: chunks holding a pinned stock (at most `maxFirst`, best first),
// topped up to `minFirst` with chunks already in memory, then with the
// best-scoring (radar candidate) chunks.
export function firstStep(ordered, pinned = new Set(), { minFirst = 2, maxFirst = 4, loaded = new Set() } = {}) {
  const files = new Set(ordered.filter(item => item.chunk.symbols?.some(symbol => pinned.has(symbol))).slice(0, maxFirst).map(item => item.chunk.file));
  for (const item of [...ordered.filter(item => loaded.has(item.chunk.file)), ...ordered]) { if (files.size >= minFirst) break; files.add(item.chunk.file); }
  return files;
}
const IN_FLIGHT = new Set(['downloading', 'classifying']);
export function createChunkLoader({
  manifest = () => ensureBundleManifest(), chunks = bundleChunks, status = bundleChunkStatus, load = ensureBundleChunks, subscribe = subscribeBundle,
  revisionOf = () => { const state = bundleState(); return `${state.date}:${state.revision}`; },
  saveData = () => globalThis.navigator?.connection?.saveData === true, hidden = () => globalThis.document?.hidden === true,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random,
  concurrency = 2, retries = 1, backoffMs = 2000, maxBacklog = 2, idleMs, totalMs, minFirst = 2, maxFirst = 4, events = true
} = {}) {
  const listeners = new Set(), active = new Set(), waiting = new Set(), handed = new Set(), failed = new Set();
  let run = 0, files = [], index = new Map(), symbolsOf = new Map(), queue = [], first = new Set(), plan = { weights: new Map(), pinned: new Set() }, full = true,
    initialized = false, revision = null, manifestJob = null, manifestError = null, legacy = null, mapped = true, downloadedOnce = false, published = '';
  const owned = file => active.has(file) || waiting.has(file) || handed.has(file) || queue.includes(file);
  // Classification continues after a download; its outcome arrives through the bundle.
  function reconcile() {
    for (const file of handed) { const value = status(file); if (!IN_FLIGHT.has(value)) { handed.delete(file); if (value !== 'loaded') failed.add(file); } }
    // A chunk another view (e.g. a selected stock) failed to load joins the queue.
    if (initialized && mapped) for (const file of files) { const value = status(file); if ((value === 'idle' || value === 'failed') && !owned(file) && !failed.has(file)) queue.push(file); }
  }
  function state() {
    let loaded = 0, elsewhere = false, failures = 0;
    for (const file of files) {
      const value = status(file);
      if (value === 'loaded') loaded++;
      else if (IN_FLIGHT.has(value)) elsewhere = true;
      else if (failed.has(file) || value === 'failed' && !owned(file)) failures++;
    }
    const runnable = queue.some(file => full || first.has(file)), deferred = full ? 0 : queue.filter(file => !first.has(file)).length;
    const pending = active.size || waiting.size || handed.size || runnable || elsewhere || legacy;
    let phase = 'idle';
    if (manifestJob) phase = 'manifest';
    else if (!initialized) phase = manifestError ? 'failed' : 'idle';
    else if (pending) phase = [...first].some(file => status(file) !== 'loaded' && !failed.has(file)) ? 'priority' : 'background';
    else if (deferred) phase = 'deferred';
    else if (failures || manifestError) phase = 'failed';
    else if (files.length && loaded === files.length) phase = 'done';
    return { phase, loaded, total: files.length, failed: failures, deferred, paused: hidden(), error: manifestError?.message || '' };
  }
  function publish() {
    if (!listeners.size) return;
    const value = state(), signature = JSON.stringify(value);
    if (signature === published) return; published = signature;
    for (const listener of listeners) { try { listener(value); } catch (error) { console.warn('台股分塊進度更新失敗', error); } }
  }
  function backlog() { let n = 0; for (const file of files) if (status(file) === 'classifying') n++; return n; }
  function pump() {
    reconcile();
    const current = run;
    while (queue.length && active.size + waiting.size < concurrency && !hidden()) {
      if (!downloadedOnce && active.size + waiting.size >= 1) break;
      if (backlog() >= maxBacklog) break;
      const next = queue.findIndex(file => full || first.has(file));
      if (next < 0) break;
      const [file] = queue.splice(next, 1);
      void fetchChunk(file, current);
    }
    publish();
  }
  async function fetchChunk(file, current) {
    const value = status(file);
    if (value === 'loaded' || IN_FLIGHT.has(value)) { pump(); return; }
    active.add(file); failed.delete(file); publish();
    try {
      for (let attempt = 0; ; attempt++) {
        const result = await load(symbolsOf.get(file), { stage: 'downloaded', idleMs, totalMs }).catch(error => ({ failed: [file], errors: [error] }));
        if (current !== run) return;
        if (!result.failed.includes(file)) { downloadedOnce = true; handed.add(file); break; }
        if (attempt >= retries) { failed.add(file); break; }
        // One retry after a randomized backoff; other chunks keep loading.
        active.delete(file); waiting.add(file); publish();
        await sleep(backoffMs * (1 + attempt) * (0.75 + random() * 0.5));
        while (hidden() && current === run) await sleep(1000);
        if (current !== run) return;
        waiting.delete(file); active.add(file); publish();
      }
    } finally {
      if (current === run) { active.delete(file); waiting.delete(file); pump(); }
    }
  }
  function refreshManifest() {
    manifestJob ??= Promise.resolve().then(manifest).then(() => { manifestError = null; }, error => { manifestError = error; throw error; }).finally(() => { manifestJob = null; publish(); });
    publish(); return manifestJob;
  }
  // Start, or re-prioritize for a new scan. Chunks already in memory are never
  // fetched again, so switching timeframes downloads nothing.
  async function start({ priority = plan, all = false } = {}) {
    plan = priority;
    if (!initialized) full = !saveData();
    if (all) full = true;
    await refreshManifest();
    const next = revisionOf(), current = chunks();
    if (next !== revision) {
      revision = next; run++; active.clear(); waiting.clear(); handed.clear(); failed.clear(); queue = [];
      files = current.map(chunk => chunk.file); symbolsOf = new Map(current.map(chunk => [chunk.file, chunk.symbols]));
      index = new Map(current.flatMap(chunk => (chunk.symbols || []).map(symbol => [symbol, chunk.file])));
      mapped = current.every(chunk => Array.isArray(chunk.symbols));
      downloadedOnce = current.some(chunk => chunk.status === 'loaded');
    }
    initialized = true;
    if (!mapped) {
      // Older manifests do not map stocks to chunks: the bounded preloader loads them all.
      legacy ??= Promise.resolve().then(() => load(null)).catch(() => {}).finally(() => { legacy = null; publish(); });
      publish(); return;
    }
    const ordered = prioritizeChunks(current, plan.weights);
    first = firstStep(ordered, plan.pinned, { minFirst, maxFirst, loaded: new Set(files.filter(file => status(file) === 'loaded')) });
    queue = ordered.map(item => item.chunk.file).filter(file => { const value = status(file); return (value === 'idle' || value === 'failed') && !active.has(file) && !waiting.has(file) && !handed.has(file) && !failed.has(file); });
    pump();
  }
  // The whole market on request (Save-Data), or failed chunks once more.
  function loadAll() { failed.clear(); return start({ all: true }); }
  const unsubscribe = subscribe(() => { if (initialized) pump(); });
  const onVisibility = () => { if (hidden()) publish(); else pump(); };
  const onOnline = () => { if (state().phase === 'failed') loadAll().catch(() => {}); };
  if (events) { globalThis.document?.addEventListener?.('visibilitychange', onVisibility); globalThis.addEventListener?.('online', onOnline); }
  return {
    start, state, loadAll,
    // 'loaded' | 'failed' | 'deferred' | 'pending' for the chunk holding a stock.
    symbolState(symbol) {
      if (manifestJob) return 'pending';
      if (!initialized) return manifestError ? 'failed' : 'pending';
      if (!mapped) return legacy ? 'pending' : 'loaded';
      const file = index.get(symbol);
      if (!file) return 'failed';
      const value = status(file);
      if (value === 'loaded') return 'loaded';
      if (IN_FLIGHT.has(value) || active.has(file) || waiting.has(file) || handed.has(file)) return 'pending';
      if (failed.has(file)) return 'failed';
      if (queue.includes(file)) return full || first.has(file) ? 'pending' : 'deferred';
      return value === 'failed' ? 'failed' : 'pending';
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { run++; unsubscribe(); globalThis.document?.removeEventListener?.('visibilitychange', onVisibility); globalThis.removeEventListener?.('online', onOnline); listeners.clear(); }
  };
}
let shared, sharedHistory;
export function marketLoader() { return shared ??= createChunkLoader(); }
// The 2W/1M history files, started only when a view needs those frames, with
// the same scheduling (priority, concurrency, progress timeout, retry, paused
// while hidden, Save-Data first step only).
export function historyLoader() {
  return sharedHistory ??= createChunkLoader({ chunks: bundleHistoryChunks, status: bundleHistoryStatus, load: ensureHistoryChunks });
}
