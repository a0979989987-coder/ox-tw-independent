import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {homeHighlights,highlightsContent} from '../src/markets/tw/home-highlights.js';
const home=JSON.parse(await readFile(new URL('../data/tw-home.json',import.meta.url),'utf8'));
test('highlights follow the selected session and use its actual data without blending research dates',()=>{
 const after=homeHighlights(home,'after',{date:'1900-01-01',sectors:[{name:'Outdated sector',flow:1e9}]});
 const before=homeHighlights(home,'before');
 assert.equal(after.title,'盤後重點');assert.equal(after.date,home.core.date);assert(after.entries.some(e=>e.title==='權值股貢獻'&&e.text.includes('估算')));assert(!after.entries.some(e=>e.title==='台指期夜盤'||e.text.includes('Outdated')));
 assert.equal(before.title,'盤前重點');assert.equal(before.date,home.briefing.date);assert(before.entries.some(e=>e.title==='台指期夜盤'&&e.date===home.night.tradeDate));assert(!before.entries.some(e=>e.title==='台股收盤'));
 assert(before.entries.some(e=>e.title==='美股收盤'&&e.text.includes(home.briefing.rows.find(r=>r.group==='us').name)));
});
test('missing, stale and unsafe summary data remain visible and escaped',()=>{
 assert.equal(homeHighlights({},'before').entries.length,0);assert.match(highlightsContent({},'after'),/資料尚未取得/);
 const stale={...home,nightStatus:{error:'offline'},night:{...home.night,sourceUrl:'javascript:alert(1)',source:'<img>'}};
 const html=highlightsContent(stale,'before');assert.match(html,/上次有效資料/);assert(!html.includes('href="javascript:'));assert(!html.includes('<img>'));
});
