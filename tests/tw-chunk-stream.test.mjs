import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createEntryParser} from '../src/markets/tw/patterns/chunk-stream.js';

const text=gunzipSync(await readFile(new URL('../data/tw-patterns/daily-00.json.gz',import.meta.url))).toString();
const whole=JSON.parse(text);

function parseIn(pieces){
 const order=[],entries=[];let header=null;
 const parser=createEntryParser({onHeader:value=>{header=value;order.push('header');},onEntry:entry=>{entries.push(entry);order.push('entry');}});
 for(const piece of pieces)parser.push(piece);
 return {header,entries,order,end:()=>parser.end()};
}
const split=(value,size)=>Array.from({length:Math.ceil(value.length/size)},(_,i)=>value.slice(i*size,(i+1)*size));

test('a real chunk read in any block size yields the same stocks, header first',()=>{
 for(const size of [1,7,1000,65536,text.length]){
  const result=parseIn(size===1?split(text.slice(0,200000),1).concat([text.slice(200000)]):split(text,size));
  const header=result.end();
  assert.deepEqual(header,{date:whole.date,algorithmVersion:whole.algorithmVersion});
  assert.equal(result.order[0],'header');
  assert.equal(result.entries.length,whole.entries.length);
  assert.deepEqual(result.entries,whole.entries);
 }
});

test('the first stocks are available long before the chunk has fully arrived',()=>{
 const result=parseIn([text.slice(0,Math.floor(text.length*0.05))]);
 assert(result.header);assert.equal(result.header.date,whole.date);
 assert(result.entries.length>=3,`${result.entries.length} stocks from the first 5%`);
 assert.deepEqual(result.entries,whole.entries.slice(0,result.entries.length));
 assert.throws(()=>result.end(),/分類資料不完整/);
});

test('a stock boundary pattern inside a nested list is not mistaken for the next stock',()=>{
 const nested={date:'2026-10-14',algorithmVersion:7,entries:[{key:'1:1D',rows:[{key:'a'},{key:'b'}],name:'x},{"key":y'},{key:'2:1D',rows:[]}]};
 const json=JSON.stringify(nested);assert(json.includes('},{"key":"b"'));
 for(const size of [1,5,json.length]){const result=parseIn(split(json,size));assert.deepEqual(result.end(),{date:'2026-10-14',algorithmVersion:7});assert.deepEqual(result.entries,nested.entries);}
 const empty=parseIn(['{"date":"d","algorithmVersion":7,"entries":[]}']);assert.deepEqual(empty.end(),{date:'d',algorithmVersion:7});assert.deepEqual(empty.entries,[]);
});

test('braces and escaped quotes inside strings, keys after the entries and a header-less payload',()=>{
 const tricky={date:'2026-10-14',algorithmVersion:7,note:'a "}]" [{ \\\\ x',entries:[{key:'1:1D',name:'測試 "{" ]\\\\',n:[1,{a:'}'}]},{key:'2:1D'}],after:{nested:[1,2]}};
 const json=JSON.stringify(tricky);
 const result=parseIn(split(json,3));
 assert.deepEqual(result.entries,tricky.entries.slice(0,1),'a stock is complete once the next one begins');
 assert.deepEqual(result.end(),{date:'2026-10-14',algorithmVersion:7,note:tricky.note,after:{nested:[1,2]}});
 assert.deepEqual(result.entries,tricky.entries);
 // Without "date" before the stocks they are held until the payload ends.
 const late=JSON.stringify({entries:[{key:'1:1D'}],date:'2026-10-14',algorithmVersion:6});
 const held=parseIn([late]);
 assert.deepEqual(held.order,[]);
 assert.deepEqual(held.end(),{date:'2026-10-14',algorithmVersion:6});
 assert.deepEqual(held.order,['header','entry']);
 assert.throws(()=>parseIn(['{"date":"x","rows":[]}']).end(),/分類資料格式異常/);
});
