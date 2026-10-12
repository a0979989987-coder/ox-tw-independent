import { qualifyBundleEntryCooperatively } from './qualification.js';

export function createBundleComputer({workerFactory = () => new Worker(
  new URL('../../../generated/tw-bundle-worker.js?v=20261012-startup2', import.meta.url), {type:'module'}),
  fallback = qualifyBundleEntryCooperatively, timeoutMs = 8000} = {}) {
  let worker, unavailable = false, sequence = 0;
  const jobs = new Map();
  function failWorker() {
    unavailable = true;
    worker?.terminate(); worker = null;
    for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(Error('背景分類改用分段計算')); }
    jobs.clear();
  }
  return async function compute(entry, date, now = Date.now()) {
    if (!worker && !unavailable) {
      try {
        worker = workerFactory();
        worker.onmessage = ({data}) => {
          const job = jobs.get(data.id); if (!job) return;
          jobs.delete(data.id); clearTimeout(job.timer);
          data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
        };
        worker.onerror = event => { event.preventDefault?.(); failWorker(); };
        worker.onmessageerror = failWorker;
      } catch { failWorker(); }
    }
    if (!worker) return fallback(entry, date, now);
    try {
      // At most one stock per downloading chunk is queued. A user-selected
      // stock can interleave with background work, never wait for the market.
      return await new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(failWorker, timeoutMs);
        jobs.set(id, {resolve, reject, timer});
        try { worker.postMessage({id, entry, date, now}); } catch { failWorker(); }
      });
    } catch { return fallback(entry, date, now); }
  };
}
export const computeBundleEntry = createBundleComputer();
