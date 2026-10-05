// Retry only transient failures of the read-only Taiwan data API.
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(Object.assign(new Error('Taiwan request cancelled'), { code: 'TW_DATA_ABORTED' }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function retryTWRequest(load, { signal, delays = [750, 1750], wait = waitForRetry, budgetMs=28000 } = {}) {
  const started=Date.now();
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw Object.assign(new Error('Taiwan request cancelled'), { code: 'TW_DATA_ABORTED' });
    try { return await load(); }
    catch (error) {
      const transient = error?.code === 'TW_DATA_NETWORK_ERROR'
        || error?.code === 'TW_DATA_TIMEOUT'
        || (['TW_DATA_HTTP_ERROR', 'TW_DATA_INVALID_RESPONSE'].includes(error?.code) && RETRYABLE_STATUS.has(error.status));
      // A timeout already consumed its full budget; allow only one further attempt.
      if (!transient || signal?.aborted || Date.now()-started+delays[attempt]>=budgetMs || attempt >= delays.length
        || (error?.code === 'TW_DATA_TIMEOUT' && attempt > 0)) throw error;
      await wait(delays[attempt], signal);
    }
  }
}

export function radarNeedsRecovery(state) {
  return state?.status === 'error' || !!state?.data?.usingCachedRadar || !!state?.data?.meta?.sourceErrors?.radar
    || Object.values(state?.data?.radarModesMeta || {}).some(meta => meta?.status === 'error' || meta?.status === 'partial');
}

export function radarAvailability(state, mode, count) {
  const data = state?.data;
  const meta = data?.radarModesMeta?.[mode];
  const loading = state?.status === 'loading';
  const failed = state?.status === 'error' || !!data?.meta?.sourceErrors?.radar;
  const known = mode === 'watchlist' || (mode === 'classic' ? Array.isArray(data?.radar) : !!meta && meta.status !== 'error');
  const cached = !!data?.usingCachedRadar || failed && known;
  const updatedAt = data?.radarUpdatedAt || state?.updatedAt;
  let notice = '';
  if (cached) {
    const date = new Date(updatedAt);
    const stamp = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date) : '時間未記錄';
    notice = `${loading || !failed ? '正在更新' : '更新暫時失敗'}，目前顯示上次成功資料（交易日 ${data?.radarDataDate||"未記錄"}；更新 ${stamp}）。`;
  } else if (meta?.status === 'partial') notice = '部分官方名單更新中，目前顯示已確認資料。';
  return {
    count: known ? String(count) : '—', loading, cached, notice,
    unavailable: !known && !loading,
    retry: !loading && (failed || !known || meta?.status === 'error' || meta?.status === 'partial')
  };
}
