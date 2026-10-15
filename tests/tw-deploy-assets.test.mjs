import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {planRetention,legacyAssets,isSafe} from '../scripts/retain-previous-assets.mjs';
import {expectedOutputs,rebuildEnv} from '../scripts/ensure-build.mjs';
import {programVersion} from '../scripts/client-assets.mjs';
import {checkBuildVersion} from '../src/app/version-check.js';

const day=86400000,now=Date.parse('2026-10-15T05:40:00Z'),at=ms=>new Date(ms).toISOString();
test('deployments carry the hashed assets of earlier builds forward',()=>{
  const current={version:'c',assets:['src/generated/app/runtime-c.js','src/generated/site-theme-0-c.css']};
  const live={version:'b',assets:['src/generated/app/runtime-b.js','src/generated/site-theme-0-c.css'],previous:[{version:'a',retiredAt:at(now-10*day),assets:['src/generated/app/runtime-a.js']},{version:'z',retiredAt:at(now-20*day),assets:['src/generated/app/runtime-z.js']}]};
  const {previous,missing}=planRetention(current,live,{keep:2,days:7,now});
  assert.deepEqual(previous.map(b=>b.version),['b','a'],'at least the two most recent, however old');
  assert.equal(previous[0].retiredAt,at(now),'the live build retires with this deployment');
  assert.deepEqual(missing.sort(),['src/generated/app/runtime-a.js','src/generated/app/runtime-b.js']);
  assert.deepEqual(planRetention(current,null).missing,[]);
});

test('every version live within seven days is kept, and data-only deploys keep the history',()=>{
  // Builds a, b, d were each replaced by a code deploy during the last week.
  const live={version:'e',assets:['src/generated/app/runtime-e.js'],previous:[
    {version:'d',retiredAt:at(now-5*60000),assets:['src/generated/app/runtime-d.js']},
    {version:'b',retiredAt:at(now-3*day),assets:['src/generated/app/runtime-b.js']},
    {version:'a',retiredAt:at(now-6.9*day),assets:['src/generated/app/runtime-a.js']},
    {version:'y',retiredAt:at(now-8*day),assets:['src/generated/app/runtime-y.js']},
    {version:'x',assets:['src/generated/app/runtime-x.js']}]};
  // Many data deploys a day: same program version, nothing retires.
  const same=planRetention({version:'e',assets:live.assets},live,{keep:2,days:7,now});
  assert.deepEqual(same.previous.map(b=>b.version),['d','b','a','x'],'x has no date yet: counted from now');
  assert.deepEqual(same.previous.map(b=>b.retiredAt).slice(0,3),live.previous.slice(0,3).map(b=>b.retiredAt));
  // A code deploy retires e and keeps all that stayed within the window.
  const next=planRetention({version:'f',assets:['src/generated/app/runtime-f.js']},{...live,previous:same.previous},{keep:2,days:7,now:now+60000});
  assert.deepEqual(next.previous.map(b=>b.version),['e','d','b','a','x']);
  assert.deepEqual(planRetention({version:'f',assets:[]},{...live,previous:same.previous},{keep:2,days:7,max:3,now}).previous.map(b=>b.version),['e','d','b'],'bounded artifact size');
  // A rollback to an older version does not list it as its own predecessor.
  assert.deepEqual(planRetention({version:'b',assets:[]},live,{keep:2,days:7,now}).previous.map(b=>b.version),['e','d','a','x']);
});

test('the build version follows code and styles, not data snapshots',()=>{
  const html=v=>`<link rel="preload" as="fetch" href="data/tw-radar.json?v=${v}"><script>boot()</script>`;
  const assets={'src/generated/app/runtime-a.js':'1','src/generated/site-theme-0-a.css':'2'};
  assert.equal(programVersion(html('aaaaaaaaaaaa'),assets),programVersion(html('bbbbbbbbbbbb'),assets),'new radar data, same build');
  assert.notEqual(programVersion(html('a'),assets),programVersion(html('a'),{...assets,'src/generated/pattern-worker.js':'3'}));
  assert.notEqual(programVersion(html('a'),assets),programVersion(html('a'),{...assets,'src/generated/app/runtime-a.js':'9'}));
  assert.notEqual(programVersion(html('a'),assets),programVersion(html('a').replace('boot()','boot(1)'),assets),'HTML shell changes count');
});

test('the first deployment retains what the legacy HTML references, and only safe asset paths',()=>{
  const html='<link rel="modulepreload" href="src/generated/runtime.js?v=b0c8"><link rel="stylesheet" href="src/generated/site-theme-0-27766f8bf7e5.css"><img src="favicon.svg">';
  assert.deepEqual(legacyAssets(html),['src/generated/runtime.js','src/generated/site-theme-0-27766f8bf7e5.css']);
  assert(!isSafe('src/generated/../../.git/config'));assert(!isSafe('data/tw-radar.json'));
});

test('published HTML names its build, hashes its runtime and lists every asset in the manifest',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const manifest=JSON.parse(await readFile(new URL('../dist/client/data/build-manifest.json',import.meta.url),'utf8'));
  assert.equal(html.match(/<meta name="ox-build" content="([a-f0-9]{12})">/)?.[1],manifest.version);
  const runtime=html.match(/src\/generated\/app\/runtime-[a-f0-9]{12}\.js/)?.[0];assert(runtime);
  assert(manifest.assets.includes(runtime));
  for(const [,href] of html.matchAll(/(?:href|src)="(src\/generated\/[^"?]+)/g))assert(manifest.assets.includes(href),href);
  assert(/<link rel="stylesheet" href="src\/generated\/site-theme-0-[a-f0-9]{12}\.css" data-ox-sheet="0" onerror=/.test(html));
  assert(html.indexOf('data-ox-bootstrap="src/app/asset-guard.js"')<html.indexOf('rel="stylesheet"'),'reload guard precedes the stylesheets');
});

test('a newer published build is detected without caching the manifest',async()=>{
  let options;
  const result=await checkBuildVersion({current:'aaa',fetcher:async(url,init)=>{options=init;return new Response(JSON.stringify({version:'bbb'}));}});
  assert.equal(options.cache,'no-store');assert(result.stale);
  assert(!(await checkBuildVersion({current:'bbb',fetcher:async()=>new Response(JSON.stringify({version:'bbb'}))})).stale);
});

test('pretest recognises the current build, and a rebuild keeps its Pages settings',async()=>{
  // A check of an output the build no longer writes made every `npm test`
  // rebuild, replacing the Pages artifact with one built without SITE_URL.
  const outputs=await expectedOutputs();
  assert(outputs,'the build manifest names the hashed runtime');
  for(const path of outputs)await access(new URL('../'+path,import.meta.url));
  const html='<head><meta name="ox-site-base-path" content="/ox-tw-independent"><meta name="ox-tw-data-api-base" content="https://api.example.test/api"><meta property="og:url" content="https://a0979989987-coder.github.io/ox-tw-independent/">';
  assert.deepEqual(rebuildEnv(html,{}),{SITE_BASE_PATH:'/ox-tw-independent',TW_API_BASE:'https://api.example.test/api',SITE_URL:'https://a0979989987-coder.github.io/ox-tw-independent'});
  assert.equal(rebuildEnv(html,{SITE_URL:'https://example.github.io/repo'}).SITE_URL,'https://example.github.io/repo','the workflow value wins');
  assert.deepEqual(rebuildEnv('<head>',{}),{},'a local build stays local');
});

test('the Pages artifact gives link previews absolute URLs',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const meta=(attr,name)=>html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
  const base=meta('name','ox-site-base-path'),site=meta('property','og:url');
  if(!base&&!site){
    // `npm run build` (local preview at /): relative, no canonical URL.
    assert.equal(meta('property','og:image'),'icons/og-image.png');return;
  }
  // Built for Pages (npm run build:pages, deploy): crawlers need absolute URLs.
  assert.match(site||'',/^https:\/\/[\w.-]+(?:\/[\w.-]+)*\/$/,'og:url is the absolute Pages URL');
  if(base)assert(site.endsWith(base+'/'),'og:url matches the base path');
  if(process.env.SITE_URL)assert.equal(site,process.env.SITE_URL.replace(/\/+$/,'')+'/','og:url is the deployed site URL');
  for(const [attr,name]of [['property','og:image'],['name','twitter:image']])assert.equal(meta(attr,name),site+'icons/og-image.png',name);
});
