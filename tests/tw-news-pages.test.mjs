import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newsAssets,newsFeedPages} from '../scripts/client-assets.mjs';
import {mergeFeedPage,feedNeedsMore} from '../src/components/news/feed-pages.js';
import {newsBase,newsRangeStart,defaultState} from '../src/components/news/model.js';

const original=JSON.parse(await readFile(new URL('../data/news.json',import.meta.url)));

test('paged key-news feed keeps every article, newest first, with a small index',()=>{
  const {index,pages}=newsFeedPages(original);
  assert.deepEqual(pages.flatMap(page=>page.news),original.news);
  assert(pages.every(page=>page.news.length<=200));
  assert.equal(index.total,original.news.length);assert.deepEqual(index.pendingNews,original.pendingNews);
  assert.equal(index.pages.length,pages.length);
  for(const [i,meta] of index.pages.entries()){assert.equal(meta.oldest,pages[i].news.at(-1).publishedAt);if(i)assert(meta.newest<=index.pages[i-1].oldest);}
  assert(JSON.stringify(index).length<20000);
  const assets=newsAssets(original);
  assert.deepEqual(assets.feed.news,original.news,'complete feed stays published for older clients');
  assert.equal(assets['feed-index'].pages[0].file,'news-feed-p0.json');assert(assets['feed-p0']);
});

test('pages load until the selected dates are covered and give the same articles as the complete feed',()=>{
  const {index,pages}=newsFeedPages(original);
  const now=Date.parse(original.news[0].publishedAt)+3600000;
  const state={...defaultState(),times:['72']};
  const from=newsRangeStart(state,now);
  let snapshot={...original,news:[],feedPaging:{index,loaded:0}};
  snapshot=mergeFeedPage(snapshot,pages[0].news);
  while(feedNeedsMore(snapshot.feedPaging,from))snapshot=mergeFeedPage(snapshot,pages[snapshot.feedPaging.loaded].news);
  assert(snapshot.feedPaging.loaded<pages.length,'a 72-hour range does not need every page');
  assert.deepEqual(newsBase(snapshot,'tw',state,{},now).map(item=>item.id),newsBase(original,'tw',state,{},now).map(item=>item.id));
  assert(!feedNeedsMore({...snapshot.feedPaging,complete:true},0));
  assert.equal(newsRangeStart({...state,times:[]},now),Infinity);
});
