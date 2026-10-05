import {readFile,writeFile,rename} from 'node:fs/promises';
import {refreshHomeSection} from '../server/markets/tw/home-provider.js';
const now=new Date();
const path=new URL('../data/tw-home.json',import.meta.url);let previous={};try{previous=JSON.parse(await readFile(path,'utf8'));}catch{}
const results=await Promise.all(['core','briefing','night'].map(section=>refreshHomeSection(section,previous[section],now)));
const snapshot={sourceProject:previous.sourceProject,collectedAt:new Date().toISOString()};
for(const result of results){snapshot[result.section]=result.data;snapshot[result.section+'Status']={...result,data:undefined};console.log(result.section,result.status,result.data?.date||result.data?.tradeDate||'—',result.error||result.message||'');}
const temp=new URL('../data/tw-home.tmp',import.meta.url);await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n');await rename(temp,path);
