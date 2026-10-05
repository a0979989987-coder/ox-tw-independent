import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { evaluateClassic, qualifyClassicRow, CLASSIC_VERSION, compactClassic } from '../../../src/core/classic-server.js';

const base = new URL('../../../data/tw-patterns/', import.meta.url);
let cache = null, pending = null;

// Reuse the actual official OHLCV history built by the snapshot job. Quotes
// alone cannot establish tested liquidity or directional volume.
export async function loadClassicHistory(date) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  if (manifest.date !== date) return new Map();
  const revision = manifest.date + ':' + manifest.updatedAt + ':' + CLASSIC_VERSION;
  if (cache?.revision === revision) return cache.rows;
  if (pending?.revision === revision) return pending.promise;
  const promise = (async () => {
    const rows = new Map();
    for (const chunk of manifest.chunks) {
      if (!/^daily-\d+\.json(?:\.gz)?$/.test(chunk.file)) continue;
      const bytes = await readFile(new URL(chunk.file, base));
      const payload = JSON.parse(chunk.file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
      if (payload.date !== date) continue;
      for (const entry of payload.entries || []) {
        const bars = entry.data?.candles;
        if (entry.data?.dataDate !== date || bars?.at(-1)?.date !== date) continue;
        rows.set(entry.data.symbol, {...Object.fromEntries(['long','short'].map(side =>
          [side, compactClassic(evaluateClassic(bars, {side, frame:'1D', now:Date.parse(date+'T16:00:00+08:00')}))])),
          close:bars.at(-1).close});
      }
    }
    cache = {revision, rows};
    return rows;
  })().finally(() => { if (pending?.revision === revision) pending = null; });
  pending = {revision, promise};
  return promise;
}

export async function applyClassicToRows(rows, date) {
  const history = await loadClassicHistory(date).catch(() => new Map());
  const radarSignal = s => {
    const summary={version:s.version,eligible:s.eligible,observationEligible:s.observationEligible,side:s.side,tier:s.tier,
      phase:s.phase,stage:s.stage,qualityScore:s.qualityScore,frame:s.frame,closedAt:s.closedAt};
    if(!s.eligible&&!s.observationEligible)return summary;
    const level=p=>p?{kind:p.kind,state:p.state,level:p.level,slope:p.slope,touches:p.touches}:null;
    return {...summary,priority:s.priority,atr:s.atr,pressure:level(s.pressure),target:level(s.target),
      invalidation:s.invalidation,volume:{supported:s.volume.supported,ratio:s.volume.ratio,
        impulseRatio:s.volume.impulseRatio,upwardShare:s.volume.upwardShare}};
  };
  return rows.map(row => {
    const saved = history.get(row.symbol);
    const classic = row.dataDate === date && saved && Math.abs(row.price-saved.close)<1e-8 ? saved : null;
    const signal = qualifyClassicRow({classic}, 'long');
    const summaries=classic?Object.fromEntries(['long','short'].map(side=>[side,radarSignal(classic[side])])):null;
    return Object.freeze({...row, classic:summaries, eligible:!!signal,
      oxScore:signal?.qualityScore ?? null, tier:signal?.tier || '',
      setup:signal ? 'OX 經典 · '+signal.stage : '結構／量能待確認',
      stage:signal?.stage || '待確認', volumeRatio:signal?.volume?.ratio ?? null,
      rs:null, breakout:signal?.phase === 'breakout', breakoutState:signal?.stage || '',
      nearLimitUp:false, distanceToLimitUpPct:null, foreignNet:null, trustNet:null,
      dealerNet:null, bigOrderBias:'', updatedAt:row.dataDate || null});
  });
}
