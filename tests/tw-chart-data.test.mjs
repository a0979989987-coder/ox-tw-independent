import test from 'node:test';
import assert from 'node:assert/strict';
import {quarterlyCandles,aggregateChartCandles,stockDetails,chartTickFormatter,CHART_FRAMES} from '../src/markets/tw/chart-data.js';

test('every chart timeframe supplies a callable tick formatter and restores the library fallback outside quarters',()=>{
 const t=Date.parse('2026-07-01T00:00:00+08:00')/1000;
 for(const frame of Object.keys(CHART_FRAMES)){
  const formatter=chartTickFormatter(frame);assert.equal(typeof formatter,'function');assert.equal(formatter(t),frame==='1Q'?'2026 Q3':null);
 }
});

test('quarter candles preserve actual OHLC and turnover, exclude partial boundary quarters and retain gaps',()=>{
 const daily=[['2025-12-24',10,12,9,11,1,100],['2026-01-02',11,14,10,13,2,200],['2026-03-30',13,15,12,14,3,300],['2026-04-07',14,16,13,15,4,null],['2026-06-29',15,18,14,17,5,500],['2026-07-01',17,19,16,18,6,600]].map(([date,open,high,low,close,volume,quoteVolume])=>({date,open,high,low,close,volume,quoteVolume}));
 const candles=quarterlyCandles(daily,'2026-07-02');
 assert.deepEqual(candles.map(c=>c.date),['2026-01-01','2026-04-01']);
 assert.deepEqual([candles[0].open,candles[0].high,candles[0].low,candles[0].close,candles[0].volume,candles[0].quoteVolume],[11,15,10,14,5,500]);
 assert.equal(candles[0].lastDate,'2026-03-30');assert.equal(candles[1].quoteVolume,null);
 assert.deepEqual(aggregateChartCandles(daily,'1Q','2026-07-02'),candles);
 assert.deepEqual(quarterlyCandles([],'2026-07-02'),[]);
 const closed=quarterlyCandles([...daily,{date:'2026-09-30',open:18,high:20,low:17,close:19,volume:7,quoteVolume:700}],'2026-09-30');
 assert.deepEqual(closed.map(c=>c.date),['2026-01-01','2026-04-01','2026-07-01']);assert.equal(closed.at(-1).close,19);
 assert.deepEqual(Object.keys(CHART_FRAMES),['1D','2D','3D','5D','1W','2W','1M','1Q']);
 assert.throws(()=>aggregateChartCandles(daily,'1H','2026-07-02'));
});

test('stock details retain missing versus zero and never derive disposition safety',()=>{
 const values=new Map(stockDetails({market:'TPEX',industry:'電子',volume:0,currentCandle:{open:100,high:102,low:99},turnoverRate:0},'2026-09-30'));
 assert.equal(values.get('市場'),'上櫃');assert.equal(values.get('成交量（股）'),'0');assert.equal(values.get('週轉率'),'0%');assert.equal(values.get('處置／注意'),'—');assert.equal(values.get('資料日'),'2026-09-30');
 const unknown=new Map(stockDetails({}));assert.equal(unknown.get('開盤'),'—');assert.equal(unknown.get('成交量（股）'),'—');
});
