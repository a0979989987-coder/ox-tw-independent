import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_PREFERENCE_KEY,readLivePreference} from '../src/app/live-preference.js';
import {releaseRangeRows} from '../src/markets/tw/release-range.js';
import {eventIdentityInfo,EVENT_ICON_PATHS} from '../src/components/news/event-identity.js';

test('automatic legacy LIVE enablement is not treated as user opt-in',()=>{
 const stored=new Map([['ox-tw-independent-live','1']]);
 const storage={getItem:key=>stored.get(key)??null};
 assert.equal(readLivePreference(storage),false);
 stored.set(LIVE_PREFERENCE_KEY,'1');assert.equal(readLivePreference(storage),true);
 stored.set(LIVE_PREFERENCE_KEY,'0');assert.equal(readLivePreference(storage),false);
 assert.equal(readLivePreference({getItem(){throw Error('blocked');}}),false);
});
test('release range expands verified active rows without including unknown, scheduled or ended dispositions',()=>{
 const source=[0,1,2,3,4,5,6,null,-1].map((days,i)=>({symbol:String(1000+i),disposition:{status:'active',releaseDays:days,endDate:'2026-10-'+String(6+i).padStart(2,'0')}}));
 source.push({symbol:'9999',disposition:{scheduled:true,releaseDays:2,endDate:'2026-10-12'}});
 assert.equal(releaseRangeRows(source,'3').length,4);assert.equal(releaseRangeRows(source,'5').length,6);assert.equal(releaseRangeRows(source,'all').length,7);
 assert(releaseRangeRows(source,'all').every(r=>r.disposition.status==='release'));
 assert(source.slice(0,9).every(r=>r.disposition.status==='active'));
});
test('stock event keeps its distinct category icon and symbol, and macro retains country identity',()=>{
 for(const category of ['dividend','dividend-preview','payment','earnings']){
  const info=eventIdentityInfo({category,assets:[{symbol:'0050'}]});
  assert.equal(info.symbol,'0050');assert.equal(info.path,EVENT_ICON_PATHS[category]);assert(info.label);
 }
 assert.equal(new Set(['dividend','dividend-preview','payment','earnings'].map(k=>EVENT_ICON_PATHS[k])).size,4);
 assert.equal(eventIdentityInfo({category:'macro',sourceId:'bls-calendar'}).flag,'🇺🇸');
});
