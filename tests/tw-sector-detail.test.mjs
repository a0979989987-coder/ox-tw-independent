import test from 'node:test';
import assert from 'node:assert/strict';
import { replayFrames, replayFrameAt, replaySectorAt, drawReplayFrame } from '../src/markets/tw/research-replay.js';
import { sectorDetailSnapshot } from '../src/markets/tw/research-detail-model.js';
import { stockDetailCandles, stockDetailChart } from '../src/markets/tw/research-stock-chart.js';
import { openResearchStockChart } from '../src/markets/tw/research-detail.js';

const sector = flow => ({ name:'半導體業', flow, count:1, covered:1, buyCount:1, changePct:1, turnoverTwd:1e10 });
const days = [{ date:'2026-09-28', sectors:[sector(2e9)] }, { date:'2026-09-29', sectors:[sector(1e8)] }];
test('fading bubbles keep pointer/keyboard access until invisible and detail uses their visible dated values', () => {
  const frames = replayFrames(days, 'day', { minFlow:1e9 });
  const element = () => ({ attrs:{}, style:{setProperty(k,v){this[k]=v;}}, setAttribute(k,v){this.attrs[k]=String(v);} });
  const circle=element(), label=element(), value=element(), title=element();
  const group={...element(),dataset:{sector:'半導體業'},querySelector:s=>({circle,'.twx-bubble-label':label,'.twx-bubble-value':value,title})[s],querySelectorAll:()=>[]};
  const svg={querySelectorAll:s=>s==='.twx-bubble'?[group]:[]};
  for(const position of [.1,.5,.99]){
    drawReplayFrame(svg,replayFrameAt(frames,position),'day');
    assert.notEqual(group.style.pointerEvents,'none');assert.equal(group.attrs.tabindex,'0');
    assert.equal(replaySectorAt(frames,position,'半導體業').flow,2e9);
    assert.equal(replaySectorAt(frames,position,'半導體業').date,'2026-09-28');
  }
  drawReplayFrame(svg,replayFrameAt(frames,1),'day');
  assert.equal(group.style.pointerEvents,'none');assert.equal(group.attrs.tabindex,'-1');
  assert.equal(replaySectorAt(frames,1,'半導體業'),null);
  const incoming=replayFrames([...days].reverse(),'day',{minFlow:1e9});
  assert.equal(replaySectorAt(incoming,.5,'半導體業').date,'2026-09-28');
});

test('replay constituents retain the quote date and theme membership, with market filtering', () => {
  const stock={symbol:'2330',name:'台積電',market:'TWSE',industry:'半導體業',price:1000,netTwd:2e9};
  const snapshot={date:'2026-10-08',stocks:[stock,{...stock,symbol:'6488',market:'TPEX'}],history:[]};
  const detail=sectorDetailSnapshot(snapshot,{...sector(9e9),date:'2026-09-28'},{classification:'industry',market:'TWSE'});
  assert.equal(detail.date,'2026-09-28');assert.equal(detail.memberDate,'2026-10-08');assert.equal(detail.flow,9e9);
  assert.deepEqual(detail.rows,[stock]);assert.equal(snapshot.stocks.length,2);
  const theme=sectorDetailSnapshot(snapshot,{name:'晶圓代工',date:'2026-09-28'},{classification:'theme'});
  assert.ok(theme.rows.some(s=>s.symbol==='2330'));
  assert.ok(!theme.rows.some(s=>s.symbol==='6488'));
  snapshot.history=[{date:'2026-09-28',stocks:[{...stock,price:900}],sectors:[]}];
  const historical=sectorDetailSnapshot(snapshot,{...sector(9e9),date:'2026-09-28'},{classification:'industry'});
  assert.equal(historical.memberDate,'2026-09-28');assert.equal(historical.rows[0].price,900);
});

test('stock K overview preserves true OHLC, rejects invalid/future bars and uses completed multi-day candles', () => {
  // Real TWSE sessions (2026-09-28 was a market holiday): 09-29 and 09-30
  // form one 2-session bar on the fixed session numbering.
  const daily=['2026-09-29','2026-09-30','2026-10-01'].map((date,i)=>({date,open:10+i,high:12+i,low:9+i,close:11+i,volume:100}));
  const rows=[...daily,{...daily[0],date:'2026-09-28',low:20}];
  const bars=stockDetailCandles(rows,'1D','2026-09-30');assert.equal(bars.length,2);
  const merged=stockDetailCandles(rows,'2D','2026-09-30');assert.equal(merged.length,1);
  assert.equal(merged[0].open,10);assert.equal(merged[0].close,12);assert.equal(merged[0].volume,200);
  const chart=stockDetailChart(bars,'測試<script>');
  assert.match(chart,/2026-09-29/);assert.match(chart,/2026-09-30/);assert.ok(!chart.includes('2026-10-01'));
  assert.ok(!chart.includes('<script>'));assert.ok(!chart.includes('NaN'));assert.match(chart,/官方 K 線，2 根/);
  assert.equal(stockDetailChart([]),'');
});

test('stock-name and detail chart destinations use the application API and close the modal', () => {
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  const calls=[];globalThis.document={querySelectorAll:()=>[{close(){calls.push('close');},remove(){calls.push('remove');}}]};
  globalThis.window={OXTW:{openStock(symbol){calls.push(symbol);}}};
  try{openResearchStockChart('2330');assert.deepEqual(calls,['close','remove','2330']);openResearchStockChart('<2330>');assert.equal(calls.length,3);}
  finally{globalThis.document=previousDocument;globalThis.window=previousWindow;}
});
