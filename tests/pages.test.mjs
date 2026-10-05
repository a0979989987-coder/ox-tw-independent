import test from 'node:test';
import assert from 'node:assert/strict';
import {loadToolModule} from '../src/components/load-tool-module.js';
test('GitHub project path resolves an existing bundled Taiwan tool',async()=>{
 const previous=globalThis.OXToolModules;
 const tool={ready:true};globalThis.OXToolModules={'/src/markets/tw/etf/view.js':tool};
 try{assert.equal(await loadToolModule('https://a0979989987-coder.github.io/ox-tw-independent/src/markets/tw/etf/view.js'),tool);}
 finally{if(previous===undefined)delete globalThis.OXToolModules;else globalThis.OXToolModules=previous;}
});
