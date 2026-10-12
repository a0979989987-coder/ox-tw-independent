import test from 'node:test';
import assert from 'node:assert/strict';
import {canStartStockShortcut} from '../src/app/stock-shortcut.js';
import {bubbleLayout, meetsBubbleFlow, wheelChartViewport, MIN_BUBBLE_FLOW} from '../src/markets/tw/research-bubbles.js';
import {replayFrames, replayFrameAt, createReplayPlayer} from '../src/markets/tw/research-replay.js';
const context={desktop:true,modalOpen:false};
const event={key:'2',target:{matches:()=>false}};
test('desktop digits start lookup without stealing edits, IME, modifiers, or modals',()=>{
 assert.equal(canStartStockShortcut(event,context),true);
 for(const patch of [{key:'a'},{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{repeat:true}])assert.equal(canStartStockShortcut({...event,...patch},context),false);
 for(const patch of [{desktop:false},{modalOpen:true}])assert.equal(canStartStockShortcut(event,{...context,...patch}),false);
 assert.equal(canStartStockShortcut({...event,composedPath:()=>[{matches:()=>true}]},context),false);
 assert.equal(canStartStockShortcut({...event,composedPath:()=>[{isContentEditable:true}]},context),false);
});
const sector=(name,flow)=>({name,flow,flow5:flow*5,changePct:1,turnoverTwd:9e9});
test('ten hundred million threshold is inclusive, symmetric and uses current money mode',()=>{
 const sectors=[sector('小買',MIN_BUBBLE_FLOW-1),sector('小賣',-MIN_BUBBLE_FLOW+1),sector('買',MIN_BUBBLE_FLOW),sector('賣',-MIN_BUBBLE_FLOW)];
 assert.deepEqual(bubbleLayout(sectors,'day',{minFlow:MIN_BUBBLE_FLOW}).points.map(p=>p.name).sort(),['買','賣'].sort());
 assert.equal(meetsBubbleFlow(sector('五日',3e8),'day'),false);
 assert.equal(meetsBubbleFlow(sector('五日',3e8),'momentum'),true);
 const frames=replayFrames([{date:'2026-10-01',sectors},{date:'2026-10-02',sectors}], 'day',{minFlow:MIN_BUBBLE_FLOW});
 assert.ok(frames.every(f=>f.points.length===2));
});
test('wheel zoom keeps the pointer anchored and clamps the supported range',()=>{
 const v={zoom:1,panX:0,panY:0}, at={x:300,y:200,width:900,height:650,delta:-100};
 const zoomed=wheelChartViewport(v,at);
 assert.ok(zoomed.zoom>1);
 assert.ok(Math.abs((at.x-450-zoomed.panX)/zoomed.zoom-(at.x-450))<1e-8);
 assert.ok(Math.abs((at.y-322-zoomed.panY)/zoomed.zoom-(at.y-322))<1e-8);
 assert.equal(wheelChartViewport({...v,zoom:8},at).zoom,8);
 assert.equal(wheelChartViewport(v,{...at,delta:100}).zoom,1);
});
test('old tails retreat continuously across date boundaries instead of dropping a whole turn',()=>{
 const frames=replayFrames(Array.from({length:9},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,sectors:[sector('A',(i%2?1:-1)*(i+1)*1e9)]})),'day');
 const before=replayFrameAt(frames,6.9999)[0], after=replayFrameAt(frames,7.0001)[0];
 for(const edge of ['from','to']) for(let i=0;i<before.trail.length;i++){
  assert.ok(Math.abs(before.trail[i][edge].px-after.trail[i][edge].px)<.2);
  assert.ok(Math.abs(before.trail[i].opacity-after.trail[i].opacity)<.001);
 }
 const point=replayFrameAt(frames,7.5)[0];
 assert.ok(point.trail[0].opacity<point.trail.at(-1).opacity);
 assert.equal(point.trail.at(-1).to.px,point.px);
});
test('animation clock crosses turning points without a hold or restart',()=>{
 let callback;const seen=[];
 const player=createReplayPlayer({length:5,position:.95,render:p=>seen.push(p),requestFrame:fn=>(callback=fn,1),cancelFrame:()=>{}});
 player.play();callback(0);for(let t=16;t<=160;t+=16)callback(t);
 const steps=seen.slice(2).map((v,i)=>v-seen[i+1]);
 assert.ok(seen.at(-1)>1);assert.ok(steps.every(n=>Math.abs(n-16/1200)<1e-10));
 player.destroy();
});

test('turnover top fifty filters both directions before limiting and sorts by amount',async()=>{
 const {rankChartRows}=await import('../src/markets/tw/chart-radar-model.js');
 const rows=Array.from({length:130},(_,i)=>({symbol:String(1000+i),price:10,changePct:i%2?2:-2,turnoverTwd:1e9+i}));
 rows.push({symbol:'9999',price:10,changePct:0,turnoverTwd:1e12});
 for(const side of ['long','short']){
  const ranked=rankChartRows(rows,{tab:'surge',side});assert.equal(ranked.length,50);
  assert.ok(ranked.every(row=>side==='long'?row.changePct>0:row.changePct<0));
  assert.ok(ranked.every((row,i)=>!i||row.turnoverTwd<=ranked[i-1].turnoverTwd));
 }
 assert.notEqual(rankChartRows(rows,{tab:'surge',side:'long'})[0].symbol,rankChartRows(rows,{tab:'surge',side:'short'})[0].symbol);
});
