import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {keepPinchInChart} from '../src/components/chart/pinch-guard.js';
import {attachBubbleGestures} from '../src/markets/tw/research-gestures.js';

function element(){
 const handlers=new Map();
 return {handlers,addEventListener(type,fn,options){(handlers.get(type)||handlers.set(type,[]).get(type)).push({fn,options});},
  fire(type,{touches=0,target={closest:()=>({})},cancelable=true}={}){let prevented=false;const event={type,target,cancelable,touches:Array.from({length:touches},(_,i)=>({clientX:10*i,clientY:10})),preventDefault(){prevented=true;}};for(const {fn}of handlers.get(type)||[])fn(event);return prevented;}};
}

test('two fingers on a chart never zoom the page; one finger still scrolls it',()=>{
 const chart=element();keepPinchInChart(chart);
 assert(chart.handlers.get('touchstart').every(h=>h.options.passive===false),'touch listeners can cancel the browser pinch');
 assert.equal(chart.fire('touchstart',{touches:1}),false,'a single finger keeps the page scroll (touch-action decides)');
 assert.equal(chart.fire('touchmove',{touches:1}),false);
 assert.equal(chart.fire('touchstart',{touches:2}),true,'the second finger turns it into a chart pinch');
 assert.equal(chart.fire('touchmove',{touches:2}),true);
 assert.equal(chart.fire('touchmove',{touches:1}),true,'lifting one finger does not hand the rest of the gesture to the page');
 chart.fire('touchend',{touches:0});
 assert.equal(chart.fire('touchstart',{touches:1}),false);
 assert.equal(chart.fire('touchmove',{touches:2,cancelable:false}),false,'an event the browser no longer allows cancelling is left alone');
 for(const type of ['gesturestart','gesturechange','gestureend'])assert.equal(chart.fire(type),true,`iOS ${type} cannot zoom the page`);
});

test('a chart can claim a single finger (bubble drag, zoomed pan) and ignores touches outside it',()=>{
 let zoom=1;const chart=element(),outside={closest:()=>null};
 keepPinchInChart(chart,{inChart:target=>!!target.closest('.chart'),claims:()=>zoom>1});
 assert.equal(chart.fire('touchstart',{touches:1}),false);
 zoom=2;chart.fire('touchend');
 assert.equal(chart.fire('touchstart',{touches:1}),true);assert.equal(chart.fire('touchmove',{touches:1}),true);
 chart.fire('touchend');
 assert.equal(chart.fire('touchstart',{touches:2,target:outside}),false);
 assert.equal(chart.fire('gesturestart',{target:outside}),false);
});

test('the sector bubbles (replay) take a pinch at 100 % while one finger scrolls the page',async()=>{
 const root=element();root.querySelector=()=>null;root.hasPointerCapture=()=>false;root.setPointerCapture=()=>{};root.releasePointerCapture=()=>{};
 attachBubbleGestures(root,{session:{},prefs:{zoom:1,panX:0,panY:0,replayIndex:null},minZoom:()=>1,draw(){},settle(){},repaint(){}});
 const inChart={closest:selector=>selector==='.twx-bubbles'?{}:null};
 assert.equal(root.fire('touchstart',{touches:1,target:inChart}),false);
 assert.equal(root.fire('touchstart',{touches:2,target:inChart}),true);
 assert.equal(root.fire('gesturestart',{target:inChart}),true);
 assert.equal(root.fire('touchstart',{touches:2,target:{closest:()=>null}}),false,'other parts of the page keep native zoom');
 const css=await readFile(new URL('../src/markets/tw/research-ui.css',import.meta.url),'utf8');
 assert.match(css,/\.twx-bubbles\{touch-action:pan-y\}/);assert.match(css,/\.twx-bubbles\.is-zoomed\{touch-action:none\}/);
});

test('every chart region declares how one finger behaves',async()=>{
 const bubbles=await readFile(new URL('../src/components/bubbles/bubbles.css',import.meta.url),'utf8');
 assert.match(bubbles,/\.oxb canvas\{[^}]*touch-action:pan-y/,'empty bubble space scrolls the page; a bubble or a zoomed view is claimed in script');
 const field=await readFile(new URL('../src/components/bubbles/field.js',import.meta.url),'utf8');
 assert.match(field,/keepPinchInChart\(canvas,\{[^}]*claims:touch=>this\.zoom>1\|\|!!this\.hit\(this\.point\(touch\)\)/);
 const patterns=await readFile(new URL('../src/components/patterns/patterns.css',import.meta.url),'utf8');
 assert.match(patterns,/\.px-board canvas\{[^}]*touch-action:none/,'one finger draws on the board');
 const charts=await readFile(new URL('../src/components/patterns/charts.js',import.meta.url),'utf8');
 assert.match(charts,/touchAction='none';keepPinchInChart\(canvas/);
 const radar=await readFile(new URL('../src/components/chart/gestures.js',import.meta.url),'utf8');
 assert.match(radar,/'gesturestart','gesturechange','gestureend'/);
});
