import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../dist/server/index.js';
import {MARKETS} from '../server/markets/tw/home-markets.js';
import {SOURCE_CATALOG,MARKET_CATEGORIES} from '../src/components/news/config.js';
const origin='https://ox-tw-independent.btcfly.chatgpt.site';
test('independent runtime exposes Taiwan only and rejects requests from the original site even after caching',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('own asset')}};
 const health=await worker.fetch(new Request(origin+'/api/v1/tw/health'),env,{});
 assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 const other=await worker.fetch(new Request(origin+'/api/v1/crypto/health'),env,{});assert.equal(other.status,404);
 const old=await worker.fetch(new Request(origin+'/api/v1/tw/health',{headers:{Origin:'https://ox-crypto-screener.vercel.app'}}),env,{});assert.equal(old.status,403);
 const own=await worker.fetch(new Request(origin+'/api/v1/tw/health',{headers:{Origin:origin}}),env,{});assert.equal(own.status,200);
});
test('Taiwan snapshots, morning source list and news catalog contain no crypto market',async()=>{
 const home=JSON.parse(await readFile(new URL('../data/tw-home.json',import.meta.url)));
 const news=JSON.parse(await readFile(new URL('../data/news.json',import.meta.url)));
 assert(home.briefing.rows.every(row=>row.group!=='crypto'));
 assert(MARKETS.every(row=>row[0]!=='crypto'));
 assert(SOURCE_CATALOG.every(source=>source.markets.every(market=>market==='tw')));
 assert(!Object.hasOwn(MARKET_CATEGORIES,'crypto'));
 for(const section of ['news','pendingNews','events'])assert(news[section].every(item=>item.markets.every(market=>market==='tw')));
});
