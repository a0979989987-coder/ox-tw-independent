import { readFile } from 'node:fs/promises';
import { getOfficialTWRadar } from '../../../api/v1/tw/providers/radar.js';
import { loadInstitutional, joinResearchStocks, enrichResearch, retainResearchFlows } from './research.js';
let cache, pending;
export async function getOfficialTWResearch({refresh=false}={}) {
  if (!refresh && cache && Date.now() - cache.savedAt < 300000) return cache.data;
  if (pending) return pending;
  pending = (async () => {
    let previous=cache?.data;
    if(!previous)try{previous=JSON.parse(await readFile(new URL('../../../data/tw-research.json',import.meta.url),'utf8'));}catch{}
    const universe = await getOfficialTWRadar({ limit: 2000, minimumDate: previous?.date });
    const date = universe.dataDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Research quote date unavailable');
    const results = await Promise.allSettled(['TWSE', 'TPEX'].map(market => loadInstitutional(date, market)));
    let history = [];
    try { history = JSON.parse(await readFile(new URL('../../../data/tw-research-history.json', import.meta.url), 'utf8')); } catch { /* First collection. */ }
    const sourceHealth = Object.fromEntries(results.map((r, i) => [['TWSE', 'TPEX'][i], { ok: r.status === 'fulfilled', rows: r.value?.length || 0 }]));
    const stocks = joinResearchStocks(universe.radar, results.map(r => r.status === 'fulfilled' ? r.value : []), date);
    const data = enrichResearch(retainResearchFlows({ date, updatedAt: new Date().toISOString(), stocks, sourceHealth },previous), history);
    cache = { savedAt: Date.now(), data };
    return data;
  })().finally(() => { pending = null; });
  return pending;
}
