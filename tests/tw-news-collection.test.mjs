import test from 'node:test';
import assert from 'node:assert/strict';
import {FEEDS,normalizeFeed,cryptoRelevant,parseBlsCalendar} from '../scripts/collect-news.mjs';
import {identifyAssets,dividends,tpexDividends} from '../scripts/news-providers.mjs';
import {sourcesFor} from '../src/components/news/model.js';
import {readFile} from 'node:fs/promises';
test('independent news collector retains Taiwan and macro sources, excludes dedicated crypto headlines and accepts stock ETFs',()=>{
 assert(FEEDS.every(feed=>feed.markets.length===1&&feed.markets[0]==='tw'));
 assert(FEEDS.some(feed=>feed.id==='fed'));assert(FEEDS.some(feed=>feed.id==='technews'));
 assert(cryptoRelevant('比特幣突破新高'));assert(cryptoRelevant('Bitcoin ETF flows'));
 assert(!cryptoRelevant('台股 ETF 0050 配息公告'));assert(!cryptoRelevant('證券交易所公布台股交易資訊'));
 const feed=FEEDS.find(f=>f.id==='technews');
 const xml='<rss><channel><item><title>台積電 2330 擴大先進製程產能</title><link>https://technews.tw/2026/10/06/tsmc/</link><pubDate>Tue, 06 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>';
 const rows=normalizeFeed(xml,feed);assert.equal(rows.length,1);assert.deepEqual(rows[0].markets,['tw']);
 assert.deepEqual(identifyAssets(rows[0].title,['tw'],[{symbol:'2330',name:'台積電',market:'tw'}]).map(a=>a.symbol),['2330']);
});
test('all retained news sources and dates remain accessible and failed sources never become ready merely by retaining articles',async()=>{
 const snapshot=JSON.parse(await readFile(new URL('../data/news.json',import.meta.url)));
 const sources=sourcesFor(snapshot,'tw');
 for(const row of snapshot.news)assert(sources.some(source=>source.id===row.sourceId),row.sourceId);
 const failed=sourcesFor({...snapshot,sources:[{id:'technews',status:'error',lastSuccessAt:'2026-10-01T00:00:00Z'}]},'tw').find(s=>s.id==='technews');assert.equal(failed.status,'error');
 assert(snapshot.events.every(event=>event.markets.length===1&&event.markets[0]==='tw'));
 assert(snapshot.eventCoverage.every(span=>span.markets.includes('tw')));
});
