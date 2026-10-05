import test from 'node:test';
import assert from 'node:assert/strict';
import {twBubbleRows,volumeWindow,threeVolumeIncreases,twBubbleText} from '../src/markets/tw/bubbles/model.js';
const dates=['2026-09-23','2026-09-24','2026-09-29','2026-09-30'],date=dates.at(-1);
const entry=(volumes,stamp=date)=>({data:{dataDate:stamp,candles:dates.map((date,i)=>({date,volume:volumes[i]}))}});
const snapshot={date,stocks:[{symbol:'2330',name:'台積電',price:1000,changePct:-1,netTwd:3000000},{symbol:'2454',name:'聯發科',price:900,changePct:2,netTwd:-1800000}]};
const entryFor=symbol=>entry(symbol==='2330'?[1000,2000,3000,5000]:[1000,2000,1500,5000]);
test('three consecutive volume increases use four completed official trading days across holidays',()=>{
 assert(threeVolumeIncreases(volumeWindow(entry([1,2,3,4]),date,dates)));
 assert(!threeVolumeIncreases(volumeWindow(entry([1,2,2,4]),date,dates)));
 assert.equal(volumeWindow(entry([1,2,3,4],'2026-09-29'),date,dates),null);
 const missing=entry([1,2,3,4]);missing.data.candles[1].date='2026-09-22';assert.equal(volumeWindow(missing,date,dates),null);
 assert.deepEqual(twBubbleRows(snapshot,{metric:'volumeTrend',entryFor,dates}).map(r=>r.symbol),['2330']);
});
test('institutional direction follows net buying rather than the stock price; volume is shares rather than turnover',()=>{
 const long=twBubbleRows(snapshot,{metric:'institution',direction:'long',entryFor,dates});assert.equal(long[0].symbol,'2330');assert.equal(long[0].value,3);assert.equal(long[0].sign,3000);
 const short=twBubbleRows(snapshot,{metric:'institution',direction:'short',entryFor,dates});assert.equal(short[0].symbol,'2454');assert.equal(short[0].value,-2);
 const volume=twBubbleRows(snapshot,{metric:'volume',entryFor,dates});assert.equal(volume[0].value,5);assert.equal(volume[0].volume,5000);
 assert.equal(twBubbleRows(snapshot,{metric:'volume'}).length,0);
 assert.equal(twBubbleRows(snapshot,{metric:'change',watch:new Set(['2330'])})[0].symbol,'2330');
 assert.equal(twBubbleRows(snapshot,{metric:'change',limit:1})[0].symbol,'2454');
});
test('unavailable institutional values remain unknown and units match official stock data',()=>{
 const missing={date,stocks:[{symbol:'1101',name:'台泥',price:30,changePct:1,netTwd:null}]};assert.equal(twBubbleRows(missing,{metric:'institution'}).length,0);
 assert.equal(twBubbleText(-1234,'institution'),'−1,234張');assert.equal(twBubbleText(10000,'volume'),'1萬張');assert.equal(twBubbleText(null,'volume'),'—');
});
