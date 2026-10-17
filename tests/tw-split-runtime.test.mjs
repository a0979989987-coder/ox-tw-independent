import test from 'node:test';
import assert from 'node:assert/strict';
import {loadToolModule} from '../src/components/load-tool-module.js?split-runtime';
import {createStyleLoader} from '../src/components/style-resource.js?split-runtime';

test('a published tool is imported from its own chunk on first use and reused afterwards',async t=>{
  let calls=0;const tool={mountETF(){}};
  globalThis.OXToolLoaders={'/src/markets/tw/etf/view.js':async()=>{calls++;return tool;}};
  t.after(()=>{delete globalThis.OXToolLoaders;});
  const url='https://a0979989987-coder.github.io/ox-tw-independent/src/markets/tw/etf/view.js?v=20261005-stable18';
  assert.equal(await loadToolModule(url),tool);
  assert.equal(await loadToolModule(url),tool);
  assert.equal(calls,1);
});

test('tool styles come from the lazy style chunk without a second network download',async t=>{
  const previous={location:globalThis.location};
  globalThis.location={origin:'https://example.test',href:'https://example.test/ox-tw-independent/'};
  let chunkLoads=0;
  globalThis.OXToolStylePaths=['/src/components/patterns/patterns.css'];
  globalThis.OXLoadToolStyles=async()=>{chunkLoads++;globalThis.OXStyleTexts={'/src/components/patterns/patterns.css':'main{color:red}'};};
  t.after(()=>{delete globalThis.OXToolStylePaths;delete globalThis.OXLoadToolStyles;delete globalThis.OXStyleTexts;globalThis.location=previous.location;});
  const load=createStyleLoader(()=>assert.fail('must not fetch a stylesheet shipped in the style chunk'));
  assert.equal(await load('https://example.test/ox-tw-independent/src/components/patterns/patterns.css?v=1'),'main{color:red}');
  assert.equal(chunkLoads,1);
  const fetched=createStyleLoader(async()=>new Response('p{margin:0}'));
  assert.equal(await fetched('https://example.test/ox-tw-independent/src/other.css'),'p{margin:0}','unlisted styles still download');
});
