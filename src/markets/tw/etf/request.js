import { createSnapshotLoader, waitForSignal } from './static-snapshot.js?v=20261005-load16';
import { withDeadline } from '../../../components/resource-deadline.js';

// Published daily data is the normal read path. A slow upstream refresh must
// not block entry into either tool. Dates/source labels remain in the payload.
export function createETFRequester({ fetcher = fetch, rootUrl, getApiBase, timeoutMs = 12000 }) {
  const snapshot = createSnapshotLoader(fetcher, rootUrl);
  const cache = new Map(), pending = new Map(), generations = new Map();
  const incomplete = (action, data) => action === 'history' ? data.rows?.some(row => row.unavailable) :
    action === 'holdings' ? !data.holdings?.length : false;
  async function load(action, params, refresh) {
    let published;
    if (!refresh) {
      try {
        published = await snapshot(action, params);
        if (!incomplete(action, published)) return published;
      } catch (error) { if (error.name === 'TimeoutError') throw error; }
    }
    try {
      return await withDeadline(async signal => {
      const base = await getApiBase();
      const query = new URLSearchParams({ action, ...params, ...(refresh ? { refresh: '1' } : {}) });
      const response = await fetcher(`${(base || '/api').replace(/\/$/, '')}/v1/tw/etf?${query}`, {
        cache: 'no-store', signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw Error(payload.error?.message || 'ETF 資料暫時無法取得');
      return payload.data;
      }, timeoutMs, 'ETF 來源回應逾時，請重試');
    } catch (error) {
      if (published) return published;
      try { return await snapshot(action, params, undefined, refresh); }
      catch { throw error; }
    }
  }
  return function request(action = 'catalog', params = {}, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const refresh = params.refresh === '1';
    const clean = Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'refresh'));
    const query = new URLSearchParams({ action, ...clean }); query.sort();
    const key = query.toString(), saved = cache.get(key);
    if (!refresh && saved && Date.now() - saved.at < 300000) return waitForSignal(Promise.resolve(saved.data), signal);
    const pendingKey = `${refresh ? 'refresh:' : ''}${key}`;
    let task = pending.get(pendingKey);
    if (!task) {
      const generation = (generations.get(key) || 0) + 1; generations.set(key, generation);
      task = load(action, clean, refresh).then(data => {
        if (generations.get(key) === generation) cache.set(key, { data, at: Date.now() });
        return data;
      }).finally(() => pending.delete(pendingKey));
      pending.set(pendingKey, task);
    }
    return waitForSignal(task, signal);
  };
}
