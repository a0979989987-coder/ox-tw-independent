import { qualifyClassicRow } from '../../core/classic.js?v=20261002-rank8';
export function patternFrameTier(entry,side='long') {
 if(!entry?.data?.candles?.length)return null;
 const signal=qualifyClassicRow({classic:entry.classic||entry.data.classic},side);
 return signal?{tier:signal.tier,side:signal.side,classicSignal:signal,classic:entry.classic||entry.data.classic,
  eligible:true,setup:'OX 經典 · '+signal.stage,stage:signal.stage,reasons:signal.reasons}:null;
}
