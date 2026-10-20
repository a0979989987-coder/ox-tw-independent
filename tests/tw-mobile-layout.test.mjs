import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('only the body reserves space for the bottom dock (no extra 100px in radar or indicators)',async()=>{
  assert.match(await css('src/markets/tw/radar-ui.css'),/\.tw-radar-root \.twr-shell \{[^}]*padding-bottom: 0;/);
  assert.match(await css('src/markets/tw/research-ui.css'),/(^|\n)\.twx\{padding:0;/);
  assert.doesNotMatch(await css('src/markets/tw/radar-ui.css'),/twr-shell[^}]*calc\(100px/);
});

test('phone radar cards size to their content instead of a fixed 144px',async()=>{
  const polish=await css('src/styles/components/radar-polish.css');
  assert.match(polish,/\.tw-stock-card \{min-height:0!important;padding:7px 8px!important\}/);
  assert.match(polish,/\.tw-stock-stats \{margin-top:auto/,'stats stay aligned across a row');
});
