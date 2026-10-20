// `npm test` runs this first (pretest). Several tests exercise the built
// client/Worker in dist/, so a missing or outdated build is rebuilt here.
// A fresh build is left untouched: in deploy, `npm run build:pages` runs just
// before `npm test`, and rebuilding without its settings would replace the
// Pages artifact. When an outdated build is replaced, the base path, API base
// and absolute site URL (link previews) it was built with are kept.
import {stat,readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
// Fixed outputs of scripts/build.mjs. The hashed runtime and chunks are listed
// in the build manifest and checked from there.
export const OUTPUTS=['dist/client/index.html','dist/client/data/build-manifest.json','dist/client/src/generated/tw-bundle-worker.js','dist/client/src/app/module-boot.js','dist/server/index.js'];
const sources=['index.html','favicon.svg','package.json','src','api','server','worker','scripts/build.mjs','scripts/build-pages.mjs','scripts/client-assets.mjs'];
const mtime=async path=>{try{return (await stat(resolve(root,path))).mtimeMs;}catch{return null;}};
async function newest(path){
 const full=resolve(root,path);let info;try{info=await stat(full);}catch{return 0;}
 if(!info.isDirectory())return info.mtimeMs;
 let latest=0;
 for(const entry of await readdir(full,{withFileTypes:true})){
  // Build outputs written into src/generated are not inputs.
  if(entry.name==='generated'&&path==='src')continue;
  latest=Math.max(latest,await newest(join(path,entry.name)));
 }
 return latest;
}
// Paths of every output this build must have, including the hashed runtime
// and chunks the manifest names. Missing or unreadable manifest: incomplete.
export async function expectedOutputs(base=root){
 let manifest;
 try{manifest=JSON.parse(await readFile(resolve(base,'dist/client/data/build-manifest.json'),'utf8'));}catch{return null;}
 if(!Array.isArray(manifest?.assets)||!manifest.assets.some(path=>/^src\/generated\/app\/runtime-[a-f0-9]{12}\.js$/.test(path)))return null;
 return [...OUTPUTS,...manifest.assets.map(path=>'dist/client/'+path)];
}
// Settings an outdated build was made with, so a rebuild reproduces it.
// Explicit environment values win.
export function rebuildEnv(html,env={}){
 const out={...env},meta=name=>html.match(new RegExp(`<meta name="${name}" content="([^"]*)">`))?.[1];
 const base=meta('ox-site-base-path'),api=meta('ox-tw-data-api-base');
 const site=html.match(/<meta property="og:url" content="(https:\/\/[^"]+)">/)?.[1];
 if(base&&out.SITE_BASE_PATH===undefined)out.SITE_BASE_PATH=base;
 if(api&&out.TW_API_BASE===undefined)out.TW_API_BASE=api;
 if(site&&out.SITE_URL===undefined)out.SITE_URL=site.replace(/\/+$/,'');
 return out;
}
async function main(){
 const expected=await expectedOutputs();
 const built=expected&&await Promise.all(expected.map(mtime));
 const oldest=!built||built.includes(null)?null:Math.min(...built);
 let reason=oldest===null?'missing build output':null;
 if(!reason){const changed=Math.max(...await Promise.all(sources.map(newest)));if(changed>oldest)reason='sources changed after the last build';}
 if(!reason){console.log('Build is current; skipping rebuild');return 0;}
 let env={...process.env};
 try{env=rebuildEnv(await readFile(resolve(root,'dist/client/index.html'),'utf8'),env);}catch{}
 console.log(`Building before tests (${reason})${env.SITE_BASE_PATH?' with base path '+env.SITE_BASE_PATH:''}${env.SITE_URL?' and site URL '+env.SITE_URL:''}`);
 const result=spawnSync(process.execPath,[resolve(root,'scripts/build.mjs')],{cwd:root,env,stdio:'inherit'});
 return result.status??1;
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
