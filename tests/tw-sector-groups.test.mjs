import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_GROUPS, SECTOR_DEFINITIONS, SECTOR_TAXONOMY_VERSION } from '../src/markets/tw/sector-taxonomy.js';
import { aggregateThemes, themeGroups, enrichThemeSnapshot } from '../src/markets/tw/sector-groups.js';
import { mergeResearchHistory, selectSectors } from '../src/markets/tw/research-data.js';

test('the ten reference groups contain 110 distinct selectable themes with valid memberships', () => {
  assert.deepEqual(SECTOR_GROUPS.map(group => group.count), [24,37,5,12,2,4,16,8,1,1]);
  assert.equal(new Set(SECTOR_DEFINITIONS.map(theme => theme.name)).size, 110);
  for (const group of SECTOR_GROUPS) assert.equal(SECTOR_DEFINITIONS.filter(theme => theme.group === group.name).length, group.count);
  for (const theme of SECTOR_DEFINITIONS) {
    assert.ok(theme.symbols.length > 0);
    assert.equal(new Set(theme.symbols).size, theme.symbols.length);
    assert.ok(theme.symbols.every(symbol => /^\d{4}$/.test(symbol)));
  }
});
test('overlapping memberships use each constituent once per theme and preserve unknown versus zero', () => {
  const symbol = SECTOR_DEFINITIONS[0].symbols[0];
  const stock = { symbol, market: 'TWSE', netTwd: 100, changePct: 1, turnoverTwd: 200 };
  const expected = SECTOR_DEFINITIONS.filter(theme => theme.symbols.includes(symbol));
  const themes = aggregateThemes([stock,stock]);
  assert.equal(themes.filter(theme => theme.count).length, expected.length);
  for (const definition of expected) {
    const theme = themes.find(theme => theme.name === definition.name);
    assert.equal(theme.count,1); assert.equal(theme.flow,100);
  }
  assert.ok(aggregateThemes([{...stock,netTwd:null}]).filter(theme => theme.count).every(theme => theme.flow === null && theme.covered === 0));
  assert.ok(aggregateThemes([{...stock,netTwd:0}]).filter(theme => theme.count).every(theme => theme.flow === 0 && theme.covered === 1));
  assert.equal(themeGroups([{symbol:'0000',market:'TWSE',industry:'半導體業'}]).find(theme => theme.name === '半導體・其他').rows.length,1);
  assert.equal(themeGroups([{symbol:'0000',market:'TWSE',industry:'未知'}]).find(theme => theme.name === '其他產業').rows.length,1);
});
test('theme momentum rejects incomplete or incompatible history and watchlists retain whole thematic totals', () => {
  const definition = SECTOR_DEFINITIONS.find(theme => theme.symbols.length >= 2);
  const stocks = definition.symbols.slice(0,2).map(symbol => ({symbol,market:'TWSE',netTwd:50,changePct:1}));
  const themes=aggregateThemes(stocks);
  const history=Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,themes,themeVersion:SECTOR_TAXONOMY_VERSION}));
  const snapshot={date:'2026-09-20',stocks,history};
  const get = input => enrichThemeSnapshot(snapshot,input).themes.find(theme => theme.name===definition.name);
  assert.equal(get(history).flow20,2000);
  assert.equal(get(history.map((day,i)=>i===1?{...day,themeVersion:'old'}:day)).momentum,null);
  const prior=globalThis.localStorage;globalThis.localStorage={getItem:()=>JSON.stringify([stocks[0].symbol])};
  try {
    const selected=selectSectors(snapshot,{classification:'theme',scope:'watch'}).find(theme=>theme.name===definition.name);
    assert.equal(selected.rows.length,2);assert.equal(selected.flow,100);assert.equal(selected.flow20,2000);
  } finally { if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior; }
});
test('a shorter legacy API cannot erase the longer thematic replay history or change its dates', () => {
  const old=Array.from({length:25},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,sectors:[{flow:1}],themes:[{name:'A',flow:i}],themeVersion:SECTOR_TAXONOMY_VERSION}));
  const recent=old.slice(-10).map(({date})=>({date,sectors:[{flow:2}]}));
  const merged=mergeResearchHistory(old,recent,'2026-09-25');
  assert.equal(merged.length,25);assert.deepEqual(merged.map(day=>day.themes),old.map(day=>day.themes));
  assert.equal(merged.at(-1).sectors[0].flow,2);
  assert.equal(mergeResearchHistory(old,recent,'2026-09-20').at(-1).date,'2026-09-20');
});
