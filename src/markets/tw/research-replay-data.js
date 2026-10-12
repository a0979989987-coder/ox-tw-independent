import { mergeResearchHistory } from './research-data.js';
import { REPLAY_HISTORY_LIMIT } from './research-replay-options.js';
import { withDeadline } from '../../components/resource-deadline.js';

export function createReplayHistoryLoader(fetcher = fetch) {
  let cached, pending, loadedAt = 0;
  return async snapshot => {
    try {
      if (!cached || Date.now() - loadedAt > 300000) {
        pending ||= withDeadline(async signal => {
          const response = await fetcher(new URL('../../../data/tw-research-history.json', import.meta.url), { cache: 'no-store', signal });
          if (!response.ok) throw new Error('歷史資料暫時無法更新');
          const history = await response.json();
          if (!Array.isArray(history) || history.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day?.date))) throw new Error('歷史資料格式異常');
          cached = history; loadedAt = Date.now();
          return history;
        }, 8000, '歷史資料載入逾時').finally(() => { pending = null; });
        await pending;
      }
      return { history: mergeResearchHistory(cached, snapshot.history, snapshot.date, REPLAY_HISTORY_LIMIT), error: null };
    } catch {
      return { history: snapshot.history || [], error: '較長期間歷史載入失敗，目前顯示已載入資料。' };
    }
  };
}

export const loadReplayHistory = createReplayHistoryLoader();
