import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {emaSeries,calculateRSI,calculateMACD,calculateATR} from '../api/v1/tw/providers/indicators.js';

// Real official daily bars (fixed copy in tests/fixtures).
const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/tw-patterns-sample.json.gz',import.meta.url))));
const payload=fixture;
const candles=payload.entries[0].data.candles.slice(-120),closes=candles.map(c=>c.close);
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} != ${b}`);

test('EMA is seeded with the SMA of the first period and undefined before it',()=>{
  assert.deepEqual(emaSeries([1,2,3,4,5],3),[null,null,2,3,4]);
  assert.deepEqual(emaSeries([1,2],3),[null,null]);
});

test('RSI is 50 on a completely flat series, 100 only when there are gains and no losses',()=>{
  assert.equal(calculateRSI(Array(30).fill(100),14),50);
  assert.equal(calculateRSI(Array.from({length:30},(_,i)=>100+i),14),100);
  assert.equal(calculateRSI(Array.from({length:30},(_,i)=>100-i),14),0);
  assert.equal(calculateRSI(Array(14).fill(1),14),null);
});

test('MACD needs 26 + 9 closes and matches a textbook SMA-seeded 12/26/9 on real closes',()=>{
  assert.equal(calculateMACD(closes.slice(0,34)),null);
  assert.ok(calculateMACD(closes.slice(0,35)));
  // Independent reference.
  const ema=(v,n)=>{const k=2/(n+1);let e=v.slice(0,n).reduce((a,b)=>a+b,0)/n;const out=Array(n-1).fill(null);out.push(e);for(let i=n;i<v.length;i++){e=v[i]*k+e*(1-k);out.push(e);}return out;};
  const e12=ema(closes,12),e26=ema(closes,26),dif=closes.map((_,i)=>i>=25?e12[i]-e26[i]:null).filter(v=>v!==null),sig=ema(dif,9);
  const macd=calculateMACD(closes);
  close(macd.dif,dif.at(-1));close(macd.signal,sig.at(-1));close(macd.histogram,dif.at(-1)-sig.at(-1));
});

test('ATR uses Wilder smoothing, not a 14-bar simple average',()=>{
  const tr=candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
  let wilder=tr.slice(0,14).reduce((a,b)=>a+b,0)/14;for(let i=14;i<tr.length;i++)wilder=(wilder*13+tr[i])/14;
  close(calculateATR(candles,14),wilder);
  // Exactly 14 true ranges: the seed equals the simple average.
  const short=candles.slice(0,15);close(calculateATR(short,14),tr.slice(0,14).reduce((a,b)=>a+b,0)/14);
  assert.equal(calculateATR(candles.slice(0,14),14),null);
});
