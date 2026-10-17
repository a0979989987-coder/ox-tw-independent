// GitHub Pages "actions" deployments replace the whole site. HTML is cached for
// ten minutes and a tab (or installed app) can stay open for days, holding an
// older index.html whose hashed CSS and chunks — tools load theirs on demand —
// the new deployment no longer contains. Before uploading, copy the hashed
// assets of earlier builds from the live site into dist/client and record them
// in data/build-manifest.json.
//
// A build version changes with code and styles only (scripts/build.mjs), so
// the many data deploys of a trading day keep the version and its history.
// Kept: every earlier version that was live within RETAIN_DAYS, and at least
// the KEEP most recent ones, at most MAX_PREVIOUS versions.
//
// Usage: PAGES_BASE_URL=https://user.github.io/repo node scripts/retain-previous-assets.mjs
import {readFile,writeFile,mkdir,access,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const KEEP=Number(process.env.KEEP_PREVIOUS_BUILDS||2);
const RETAIN_DAYS=Number(process.env.RETAIN_ASSET_DAYS||7);
const MAX_PREVIOUS=Number(process.env.MAX_PREVIOUS_BUILDS||30);
const SAFE=/^src\/generated\/[\w.\-/]+\.(?:js|css)$/;

export function legacyAssets(html){
  // Builds before the manifest existed: everything under src/generated that the
  // HTML references (theme CSS, runtime) is self-contained.
  return [...new Set([...html.matchAll(/["'(](src\/generated\/[\w.\-/]+\.(?:css|js))/g)].map(m=>m[1]))].filter(isSafe);
}
export function isSafe(path){return SAFE.test(path)&&!path.split('/').includes('..');}
// `retiredAt`: when a version stopped being the live one. The live build
// retires now unless this deployment has the same version (data only).
// Entries written before dates were recorded count from now.
export function planRetention(current,live,{keep=KEEP,days=RETAIN_DAYS,max=MAX_PREVIOUS,now=Date.now()}={}){
  const history=live?.version?[{version:live.version,assets:live.assets||[],retiredAt:now},...(live.previous||[])]:live?.legacy?[{...live.legacy,retiredAt:now}]:[];
  const seen=new Set([current.version]),previous=[];
  for(const build of history){
    if(!build?.version||seen.has(build.version))continue;
    seen.add(build.version);
    const retiredAt=Math.min(now,new Date(build.retiredAt??now).getTime()||now);
    if(previous.length>=max||previous.length>=keep&&now-retiredAt>days*86400000)continue;
    previous.push({version:build.version,retiredAt:new Date(retiredAt).toISOString(),assets:(build.assets||[]).filter(isSafe)});
  }
  const own=new Set(current.assets);
  const missing=[...new Set(previous.flatMap(build=>build.assets))].filter(path=>!own.has(path));
  return {previous,missing};
}

async function fetchWithRetry(url,attempts=3){
  let error;
  for(let i=0;i<attempts;i++){
    try{const response=await fetch(url,{headers:{'cache-control':'no-cache'}});if(response.ok)return response;error=Error(`HTTP ${response.status} ${url}`);if(response.status===404)break;}
    catch(cause){error=cause;}
    await new Promise(r=>setTimeout(r,1000*(i+1)));
  }
  throw error;
}

async function bytes(path){const info=await stat(path);if(!info.isDirectory())return info.size;let total=0;for(const name of await readdir(path))total+=await bytes(join(path,name));return total;}
const mb=value=>(value/1048576).toFixed(1)+' MB';

async function main(){
  const base=(process.env.PAGES_BASE_URL||'').replace(/\/+$/,'');
  const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist/client');
  const manifestPath=resolve(dist,'data/build-manifest.json');
  const current=JSON.parse(await readFile(manifestPath,'utf8'));
  if(!base){console.log('PAGES_BASE_URL not set; skipping asset retention');return;}
  let live=null;
  try{live=await (await fetchWithRetry(`${base}/data/build-manifest.json`)).json();}
  catch{
    try{const html=await (await fetchWithRetry(`${base}/`)).text();live={legacy:{version:'legacy-'+createHash('sha256').update(html).digest('hex').slice(0,12),assets:legacyAssets(html)}};}
    catch(error){console.warn('Live site unavailable; publishing without previous assets:',error.message);}
  }
  const {previous,missing}=planRetention(current,live);
  let copied=0,copiedBytes=0;const unavailable=[];
  for(const path of missing){
    const target=resolve(dist,path);
    try{await access(target);continue;}catch{}
    try{const body=Buffer.from(await (await fetchWithRetry(`${base}/${path}`)).arrayBuffer());await mkdir(dirname(target),{recursive:true});await writeFile(target,body);copied++;copiedBytes+=body.length;}
    catch(error){unavailable.push(path);console.warn('Could not retain',path,error.message);}
  }
  current.previous=previous.map(build=>({version:build.version,retiredAt:build.retiredAt,assets:build.assets.filter(path=>!unavailable.includes(path))}));
  await writeFile(manifestPath,JSON.stringify(current));
  console.log(`Retained ${copied} assets (${mb(copiedBytes)}) from ${previous.length} previous build(s): ${previous.map(b=>`${b.version} (retired ${b.retiredAt})`).join(', ')||'none'}`);
  console.log(`Pages artifact: ${mb(await bytes(dist))}, of which generated assets ${mb(await bytes(resolve(dist,'src/generated')))}`);
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)await main();
