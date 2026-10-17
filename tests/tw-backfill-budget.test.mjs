import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boundedAttempts,curlRequest,MIN_ATTEMPT_MS} from '../server/markets/tw/official-attempts.js';

test('the daily snapshot keeps its six attempts with back-off between them',async()=>{
  const calls=[],sleeps=[];
  const result=await boundedAttempts(async(index,options)=>{calls.push(options);if(index<2)throw Error('busy');return 'ok';},{sleep:async ms=>{sleeps.push(ms);}});
  assert.equal(result,'ok');assert.deepEqual(calls,[{},{},{}]);assert.deepEqual(sleeps,[500,1000]);
  await assert.rejects(boundedAttempts(async()=>{throw Error('down');},{sleep:async ms=>{sleeps.push(ms);}}),/down/);
  assert.equal(sleeps.length,2+5,'no back-off after the last attempt');
});

test('a back-fill report is tried once, with only the time left before the deadline',async()=>{
  let clock=1000;const calls=[],sleeps=[];
  await assert.rejects(boundedAttempts(async(index,options)=>{calls.push(options);clock+=options.timeoutMs;throw Error('timeout');},
    {attempts:1,deadline:1000+9000,now:()=>clock,sleep:async ms=>{sleeps.push(ms);}}),/timeout/);
  assert.deepEqual(calls,[{timeoutMs:9000,retry:false}]);assert.deepEqual(sleeps,[]);
  assert.ok(clock<=1000+9000,'the attempt ends by the deadline');
  // Too little time left: no request at all.
  await assert.rejects(boundedAttempts(async()=>assert.fail('must not start'),{attempts:1,deadline:clock+MIN_ATTEMPT_MS-1,now:()=>clock}),/budget/);
});

test('curl gets the remaining seconds as --max-time and no retries during the back-fill',()=>{
  const daily=curlRequest('https://example.test/r');
  assert.deepEqual(daily.args,['--http1.1','-fsSL','--retry','2','--max-time','35','https://example.test/r']);
  const backfill=curlRequest('https://example.test/r',{timeoutMs:12900,retry:false});
  assert.deepEqual(backfill.args,['--http1.1','-fsSL','--max-time','12','https://example.test/r']);
  assert.ok(backfill.execTimeoutMs<=12000+5000);
  assert.equal(curlRequest('u',{timeoutMs:999999}).args.at(-2),'35');
});

test('the collector bounds every back-fill report by the back-fill deadline',async()=>{
  const source=await readFile(new URL('../scripts/collect-tw-patterns.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/report\(date,'(?:TWSE|TPEX)',\{cache:false,attempts:1,deadline\}\)/g)||[]).length,2);
  assert.match(source,/boundedAttempts\(/);assert.match(source,/curlRequest\(url,options\)/);
  assert.match(source,/Date\.now\(\)<deadline/);
});
