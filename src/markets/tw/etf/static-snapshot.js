import { withDeadline } from '../../../components/resource-deadline.js';
// Cancelling one view must not cancel data shared with the next mounted tool.
export function waitForSignal(task, signal) {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
// Both hosts serve validated daily files; concurrent symbol requests share
// one file download, without sharing a mounted view's cancellation signal.
export function createSnapshotLoader(fetcher, rootUrl, timeoutMs = 8000) {
  const cache = new Map(), pending = new Map();
  function read(file, { refresh = false, signal } = {}) {
    const saved = cache.get(file);
    if (!refresh && saved && Date.now() - saved.at < 300000) return waitForSignal(Promise.resolve(saved.data), signal);
    let task = pending.get(file);
    if (!task) {
      task = withDeadline(async signal => {
        const url = new URL(`data/${file}`, rootUrl);
        if (refresh) url.searchParams.set('check', String(Date.now()));
        const response = await fetcher(url, { cache: 'no-cache', signal });
        if (!response.ok) throw Error(`已發布的 ETF 資料暫時無法下載（${response.status}）`);
        const data = await response.json(); if(signal.aborted)throw signal.reason;
        cache.set(file, { at: Date.now(), data }); return data;
      }, timeoutMs, 'ETF 資料下載逾時，請重試').finally(() => pending.delete(file));
      pending.set(file, task);
    }
    return waitForSignal(task, signal);
  }
  return async function load(action, params = {}, signal, refresh = false) {
    if (action === 'catalog') {
      const data = await read('tw-etf/catalog.json', { refresh, signal });
      if (!Array.isArray(data.rows) || !data.rows.length) throw Error('ETF 清單尚未發布');
      return { ...data, snapshot: true };
    }
    if (action === 'history') {
      const data = await read('tw-etf/history.json', { refresh, signal });
      const symbols = String(params.symbols || params.symbol || '').split(',').filter(Boolean);
      return { rows: [...new Set(symbols)].map(symbol => data.rows?.[symbol] || { symbol, unavailable: true }) };
    }
    if (action === 'offering') return { ...await read('tw-etf/offerings.json', { refresh, signal }), snapshot: true };
    if (action === 'radar') return { ...await read('tw-etf/hot-stocks.json', { refresh, signal }), snapshot: true };
    if (action === 'holdings') {
      const symbol = String(params.symbol || '');
      let holdings;
      try { holdings = (await read('tw-etf/holdings.json', { refresh, signal })).rows?.[symbol]; } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
      if (!holdings) {
        const older = await read('tw-etf-holdings.json', { refresh, signal });
        const fund = older.funds?.find(row => row.symbol === symbol);
        if (fund) {
          const rows = fund.holdings.map(row => ({ code: row.symbol, name: row.name, weight: row.weight }));
          const coverage = rows.reduce((sum, row) => sum + row.weight, 0);
          holdings = { symbol, date: fund.date, source: fund.source, url: fund.sourceUrl,
            holdings: rows, coverage, complete: false,
            sectors: [{ name: '已發布持股（產業待補）', weight: coverage },
              { name: '現金／期貨及其他', weight: Math.max(0, 100 - coverage) }] };
        }
      }
      return holdings || { symbol, date: null, holdings: [], sectors: [], complete: false,
        status: '此 ETF 尚無已發布的完整持股資料；可自行匯入發行商清單。' };
    }
    throw Error('未知的 ETF 資料類型');
  };
}
