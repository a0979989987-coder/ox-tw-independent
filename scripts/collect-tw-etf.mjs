import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {collectCatalog,getHistory,getOfferings} from '../server/markets/tw/etf.js';
import {collectAnnualFees} from '../server/markets/tw/etf-fees.js';
const folder=new URL('../data/tw-etf/',import.meta.url);await mkdir(folder,{recursive:true});
try{await writeFile(new URL('fees.json',folder),JSON.stringify(await collectAnnualFees()));}catch(e){console.warn('Annual fees: preserving previous valid data:',e.message);}
const catalog=await collectCatalog();await writeFile(new URL('catalog.json',folder),JSON.stringify(catalog));
let history={rows:{}};try{history=JSON.parse(await readFile(new URL('history.json',folder),'utf8'));}catch{}
let done=0,failed=0;
for(let i=0;i<catalog.rows.length;i+=6){await Promise.all(catalog.rows.slice(i,i+6).map(async r=>{try{history.rows[r.symbol]=await getHistory(r.symbol,{refresh:true});}catch{failed++;}done++;}));if(done%30===0)console.log(`ETF history ${done}/${catalog.rows.length}`);}
history.acquiredAt=new Date().toISOString();await writeFile(new URL('history.json',folder),JSON.stringify(history));
try{await writeFile(new URL('offerings.json',folder),JSON.stringify(await getOfferings({refresh:true})));}catch{}
console.log(`ETF collected: ${catalog.rows.length}, history ${done-failed}, unavailable ${failed}`);
