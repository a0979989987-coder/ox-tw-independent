import { evaluateClassic, qualifyClassicRow, compactClassic } from '../../core/classic.js?v=20261002-rank8';

export function classifyTWSeries(candles, frame = '1D') {
  return Object.fromEntries(['long','short'].map(side => [side, compactClassic(evaluateClassic(candles, {side, frame}))]));
}
export function classicTWRow(row, entry, asOf) {
  const date = asOf || row.dataDate || row.updatedAt;
  const last = entry?.data?.candles?.at(-1);
  // Never carry a yesterday grade into today's quote or substitute a daily
  // result for a missing weekly/monthly history.
  const same = entry?.data?.dataDate === date && (entry.data.frame !== '1D' ||
    last?.date === date && (!Number.isFinite(row.price) || Math.abs(row.price-last.close)<1e-8));
  const classic = same ? entry.classic || entry.data.classic || classifyTWSeries(entry.data.candles, entry.data.frame) : null;
  const signal = classic && qualifyClassicRow({classic}, 'long');
  return {...row, classic, classicSignal:signal, eligible:!!signal, tier:signal?.tier || '',
    oxScore:signal?.qualityScore ?? null, setup:signal ? 'OX 經典 · '+signal.stage : '結構／量能待確認',
    stage:signal?.stage || '待確認', volumeRatio:signal?.volume?.ratio ?? null,
    t1Fit:signal?.qualityScore ?? 0,t2Fit:signal?.qualityScore ?? 0,t3Fit:signal?.qualityScore ?? 0};
}
