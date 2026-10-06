import test from 'node:test';
import assert from 'node:assert/strict';
import {createETFRequester} from '../src/markets/tw/etf/request.js';
test('ETF manual refresh reports a failed acquisition without discarding dated published quotes',async()=>{
 const saved={rows:[{symbol:'0050',price:100,date:'2026-10-02'}],acquiredAt:'2026-10-02T06:00:00Z'};
 const requests=[];
 const request=createETFRequester({rootUrl:'https://tw.test/',getApiBase:async()=>'/api',fetcher:async input=>{
  const url=String(input);requests.push(url);
  if(url.startsWith('/api/'))return Response.json({ok:false,error:{message:'來源逾時'}},{status:503});
  return Response.json(saved);
 }});
 const initial=await request('catalog');assert.equal(initial.stale,undefined);assert.equal(requests.length,1);
 const result=await request('catalog',{refresh:'1'});
 assert.equal(result.stale,true);assert.match(result.status,/更新未完成/);assert.equal(result.refreshError,'來源逾時');
 assert.deepEqual(result.rows,saved.rows);assert.equal(result.acquiredAt,saved.acquiredAt);assert.equal(result.snapshot,true);
 assert(requests.some(url=>url.includes('refresh=1')));assert(requests.some(url=>url.includes('?check=')));
});

test('ETF timeout keeps original dates and recovery clears failure status',async()=>{
 const saved={rows:[{symbol:'0050',date:'2026-10-02'}],acquiredAt:'2026-10-02T06:00:00Z'};
 let healthy=false;
 const request=createETFRequester({rootUrl:'https://tw.test/',getApiBase:async()=>'/api',timeoutMs:10,fetcher:async input=>{
  if(String(input).startsWith('/api/'))return healthy?Response.json({ok:true,data:{...saved,acquiredAt:'2026-10-06T01:00:00Z'}}):new Promise(()=>{});
  return Response.json(saved);
 }});
 const stale=await request('catalog',{refresh:'1'});
 assert.equal(stale.stale,true);assert.match(stale.refreshError,/逾時/);assert.equal(stale.acquiredAt,saved.acquiredAt);
 assert.equal((await request('catalog')).stale,true);
 healthy=true;
 const fresh=await request('catalog',{refresh:'1'});
 assert.equal(fresh.stale,undefined);assert.equal(fresh.refreshError,undefined);assert.equal(fresh.acquiredAt,'2026-10-06T01:00:00Z');
});

test('ETF failed refresh and failed snapshot retain previously loaded data',async()=>{
 let failed=false;
 const saved={rows:[{symbol:'0050',date:'2026-10-02'}]};
 const request=createETFRequester({rootUrl:'https://tw.test/',getApiBase:async()=>'/api',fetcher:async()=>failed?Response.json({ok:false},{status:503}):Response.json(saved)});
 await request('catalog');failed=true;
 const data=await request('catalog',{refresh:'1'});
 assert.deepEqual(data.rows,saved.rows);assert.equal(data.stale,true);assert.match(data.status,/上次有效/);
});

test('ETF failed acquisition without any saved data remains an error',async()=>{
 const request=createETFRequester({rootUrl:'https://tw.test/',getApiBase:async()=>'/api',fetcher:async()=>Response.json({ok:false,error:{message:'上游逾時'}},{status:503})});
 await assert.rejects(request('catalog',{refresh:'1'}),/上游逾時/);
});

test('ETF history refresh failures also carry stale status and preserve row dates',async()=>{
 const row={symbol:'0050',date:'2026-10-02',return1y:10};
 const request=createETFRequester({rootUrl:'https://tw.test/',getApiBase:async()=>'/api',fetcher:async input=>String(input).startsWith('/api/')?Response.json({ok:false,error:{message:'歷史來源逾時'}},{status:503}):Response.json({rows:{'0050':row}})});
 const data=await request('history',{symbols:'0050',refresh:'1'});
 assert.equal(data.stale,true);assert.equal(data.refreshError,'歷史來源逾時');assert.deepEqual(data.rows,[row]);
});

test('ETF stale source label takes precedence over snapshot label',async()=>{
 const {sourceNote}=await import('../src/markets/tw/etf/ui.js');
 const label=sourceNote({snapshot:true,stale:true,rows:[{date:'2026-10-02'}],acquiredAt:'2026-10-02T06:00:00Z'});
 assert.match(label,/上次有效資料（更新未完成）/);assert.match(label,/2026-10-02/);assert.doesNotMatch(label,/已發布資料快照|最新/);
});
