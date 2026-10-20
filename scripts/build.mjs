import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,rm,rename,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {TOOL_STYLES,newsAssets,programVersion} from './client-assets.mjs';
import {splitThemeCSS} from './css-theme-split.mjs';
const root=resolve(import.meta.dirname,'..');
const basePath=process.env.SITE_BASE_PATH||'';
if(basePath&&!/^\/[a-zA-Z0-9_.-]+$/.test(basePath))throw Error('Invalid site base path');
const apiBase=process.env.TW_API_BASE||'';
// Absolute site URL for link previews (Open Graph needs absolute image URLs).
const siteUrl=(process.env.SITE_URL||'').replace(/\/+$/,'');
if(siteUrl&&!/^https:\/\/[\w.-]+(?:\/[\w.-]+)*$/.test(siteUrl))throw Error('Invalid site URL');
if(apiBase){const url=new URL(apiBase);if(url.protocol!=='https:'&&!['localhost','127.0.0.1','terminal.local'].includes(url.hostname))throw Error('Taiwan API must use HTTPS');}
const resolveVersion={name:'versioned-imports',setup(b){b.onResolve({filter:/^\./},args=>({path:resolve(args.resolveDir,args.path.split('?')[0])}));}};
await mkdir(resolve(root,'src/generated'),{recursive:true});
await build({entryPoints:[resolve(root,'src/markets/tw/patterns/bundle-worker.js')],bundle:true,format:'iife',platform:'browser',minify:true,outfile:resolve(root,'src/generated/tw-bundle-worker.js'),plugins:[resolveVersion]});
const bundleWorkerVersion=createHash('sha256').update(await readFile(resolve(root,'src/generated/tw-bundle-worker.js'))).digest('hex').slice(0,12);
const browserURLs={name:'original-browser-urls',setup(b){b.onLoad({filter:/\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('tw-bundle-worker.js?v=20261012-startup2','tw-bundle-worker.js?v='+bundleWorkerVersion).replaceAll('import.meta.url',`new URL(${JSON.stringify(basePath+'/'+relative(root,args.path))},location.href).href`),loader:'js',resolveDir:dirname(args.path)}));}};
const entries=['/src/components/patterns/view.js','/src/markets/tw/patterns/source.js','/src/markets/tw/patterns/index-cache.js','/src/markets/tw/bubbles/view.js','/src/markets/tw/etf/view.js','/src/markets/tw/etf/savings.js'];
// ES modules with code splitting. The entry only starts the app (radar and
// shell); tools are separate chunks fetched by import() when opened. app.js is
// its own entry so its code lives in a shared chunk: a retried import of
// runtime.js never evaluates the application twice.
// Tool stylesheet texts (applied atomically inside shadow roots) are one lazy
// chunk fetched with the first tool, not part of the first-screen runtime.
// OXChunkURLs (filled in after the build) names the chunk of every import():
// a browser never refetches a module URL that failed, so retries import the
// chunk under a fresh query (src/components/load-tool-module.js).
const styles=Object.fromEntries(await Promise.all(TOOL_STYLES.map(async path=>['/'+path,(await readFile(resolve(root,path),'utf8')).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,quote,url)=>/^(?:[a-z]+:|\/|#)/i.test(url)?all:`url("${basePath+'/'+relative(root,resolve(root,dirname(path),url))}")`)])));
const CHUNK_URLS='__OX_CHUNK_URLS__';
const runtimeEntry=`import './src/app/app.js';\nglobalThis.OXToolStylePaths=${JSON.stringify(Object.keys(styles))};\nglobalThis.OXLoadToolStyles=()=>import('ox-tool-styles');\nglobalThis.OXToolLoaders={${entries.map(p=>`${JSON.stringify(p)}:()=>import('.${p}')`).join(',')}};\nglobalThis.OXChunkBase=import.meta.url;\nglobalThis.OXChunkURLs=${JSON.stringify(CHUNK_URLS)};\nexport const ready=true;`;
const virtualEntry={name:'runtime-entry',setup(b){
 b.onResolve({filter:/^ox-runtime$/},()=>({path:'runtime',namespace:'ox-entry'}));
 b.onResolve({filter:/^ox-tool-styles$/},()=>({path:'tool-styles',namespace:'ox-entry'}));
 b.onLoad({filter:/^runtime$/,namespace:'ox-entry'},()=>({contents:runtimeEntry,resolveDir:root,loader:'js'}));
 b.onLoad({filter:/^tool-styles$/,namespace:'ox-entry'},()=>({contents:`Object.assign(globalThis.OXStyleTexts||(globalThis.OXStyleTexts={}),${JSON.stringify(styles)});`,loader:'js'}));
}};
const generatedApp=resolve(root,'src/generated/app');
await rm(generatedApp,{recursive:true,force:true});await rm(resolve(root,'src/generated/runtime.js'),{force:true});
const appBuild=await build({entryPoints:{runtime:'ox-runtime',app:resolve(root,'src/app/app.js')},bundle:true,splitting:true,format:'esm',platform:'browser',target:['es2020','safari15','chrome90','firefox90'],minify:true,metafile:true,outdir:generatedApp,entryNames:'[name]',chunkNames:'chunks/[name]-[hash]',plugins:[virtualEntry,resolveVersion,browserURLs]});
const chunkURLs={};
for(const [output,info]of Object.entries(appBuild.metafile.outputs)){
 const file=resolve(root,output);
 if(!info.entryPoint||dirname(file)!==resolve(generatedApp,'chunks'))continue;
 chunkURLs[info.entryPoint==='ox-entry:tool-styles'?'ox-tool-styles':'/'+relative(root,resolve(root,info.entryPoint))]=relative(generatedApp,file);
}
for(const path of ['ox-tool-styles',...entries])if(!chunkURLs[path])throw Error('No chunk for '+path);
const runtimeCode=await readFile(resolve(generatedApp,'runtime.js'),'utf8');
if(runtimeCode.split(JSON.stringify(CHUNK_URLS)).length!==2)throw Error('Chunk map placeholder missing from the runtime');
await writeFile(resolve(generatedApp,'runtime.js'),runtimeCode.replace(JSON.stringify(CHUNK_URLS),()=>JSON.stringify(chunkURLs)));
const runtimeVersion=createHash('sha256').update(await readFile(resolve(generatedApp,'runtime.js'))).update(JSON.stringify(Object.keys(appBuild.metafile.outputs).sort())).digest('hex').slice(0,12);
await build({entryPoints:[resolve(root,'src/components/patterns/worker.js')],bundle:true,format:'esm',platform:'browser',minify:true,outfile:resolve(root,'src/generated/pattern-worker.js'),plugins:[resolveVersion]});
await rm(resolve(root,'dist'),{recursive:true,force:true});
await mkdir(resolve(root,'dist/client'),{recursive:true});
for(const name of ['index.html','favicon.svg','manifest.webmanifest','icons','src','data'])await cp(resolve(root,name),resolve(root,'dist/client',name),{recursive:true});
const news=newsAssets(JSON.parse(await readFile(resolve(root,'data/news.json'),'utf8')));
for(const [name,data]of Object.entries(news))await writeFile(resolve(root,`dist/client/data/news-${name}.json`),JSON.stringify(data));
// The published runtime entry carries its content hash in the file name, so a
// cached older HTML keeps loading its own (retained) runtime after a deploy.
const runtimeFile=`runtime-${runtimeVersion}.js`;
await rename(resolve(root,'dist/client/src/generated/app/runtime.js'),resolve(root,'dist/client/src/generated/app',runtimeFile));
await rm(resolve(root,'dist/client/src/generated/app/app.js'),{force:true});
const bootPath=resolve(root,'dist/client/src/app/module-boot.js');
await writeFile(bootPath,(await readFile(bootPath,'utf8')).replaceAll('20261012-startup1',runtimeVersion).replaceAll('generated/app/runtime.js',`generated/app/${runtimeFile}`));
let html=await readFile(resolve(root,'dist/client/index.html'),'utf8');
// The first-screen snapshot is preloaded by the HTML. Version its URL with its
// content so the preload and the runtime fetch share one cacheable request.
const radarVersion=createHash('sha256').update(await readFile(resolve(root,'data/tw-radar.json'))).digest('hex').slice(0,12);
html=html.replace('href="data/tw-radar.json"',`href="data/tw-radar.json?v=${radarVersion}"`);
html=html.replaceAll('20261012-startup1',runtimeVersion).replaceAll('src/generated/app/runtime.js',`src/generated/app/${runtimeFile}`);
// Fetch the runtime's static chunks in parallel with it instead of after it
// is parsed. Tool stylesheets are no longer embedded in JavaScript: each tool
// fetches its own CSS files when it opens.
const staticChunks=new Set(),visit=output=>{for(const dep of appBuild.metafile.outputs[output]?.imports||[])if(dep.kind==='import-statement'&&!staticChunks.has(dep.path)){staticChunks.add(dep.path);visit(dep.path);}};
const runtimeOutput=Object.keys(appBuild.metafile.outputs).find(path=>path.endsWith('src/generated/app/runtime.js'));visit(runtimeOutput);
const chunkLinks=[...staticChunks].map(path=>`<link rel="modulepreload" href="${relative(root,resolve(root,path))}">`).join('');
html=html.replace(/(<link rel="modulepreload" href="src\/generated\/app\/runtime-[a-f0-9]{12}\.js[^"]*">)/,`$1${chunkLinks}`);
// Small boot scripts travel with HTML. A stalled deferred helper download can
// otherwise prevent the recovery timer itself from ever starting.
for(const path of ['src/app/asset-guard.js','src/components/control-panel/resource-guard.js','src/app/preferences.js','src/components/loading-state.js','src/app/theme-boot.js','src/app/module-boot.js']){
 const code=await readFile(resolve(root,'dist/client',path),'utf8');
 html=html.replace(new RegExp(`<script(?: defer)? src="${path.replaceAll('.','\\.')}[^\"]*"><\\/script>`),()=>`<script data-ox-bootstrap="${path}">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
}
// Preserve the cascade and marked lazy-style links, while collapsing the
// dozens of shared stylesheets into two cacheable requests before first paint.
const groups=[...html.matchAll(/(?:<link rel="stylesheet" href="[^"]+">)+/g)];
for(const [index,match]of groups.entries()){
 const paths=[...match[0].matchAll(/href="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
 if(paths.length<2)continue;
 const css=(await Promise.all(paths.map(async path=>{
  const text=await readFile(resolve(root,path),'utf8');
  return text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,quote,url)=>/^(?:[a-z]+:|\/|#)/i.test(url)?all:`url("${basePath+'/'+relative(root,resolve(root,dirname(path),url))}")`);
 }))).join('\n');
 // Rules that can only match the light theme move to a companion sheet placed
 // right after this one (same cascade position relative to every other sheet).
 // It has no href until the light theme is in use (see theme-sheets.js).
 const split=splitThemeCSS(css);
 const baseCSS=split.base+`\n:root{--ox-theme-${index}-ready:1}\n`;
 const version=createHash('sha256').update(baseCSS).digest('hex').slice(0,12);
 const file=`src/generated/site-theme-${index}-${version}.css`;
 await writeFile(resolve(root,'dist/client',file),baseCSS);
 let lightLink='';
 if(split.light.trim()){
  const lightFile=`src/generated/site-theme-${index}-light-${createHash('sha256').update(split.light).digest('hex').slice(0,12)}.css`;
  await writeFile(resolve(root,'dist/client',lightFile),split.light);
  lightLink=`<link rel="stylesheet" data-ox-light-href="${lightFile}">`;
 }
 // asset-guard.js reloads once if this sheet fails or its sentinel is missing.
 html=html.replace(match[0],`<link rel="stylesheet" href="${file}" data-ox-sheet="${index}" onerror="window.OXAssetReload&&OXAssetReload('css')">${lightLink}`);
}
// Midnight Ink: one override sheet for the page and one for tool shadow roots,
// both content-hashed. The page sheet stays without href until the theme is
// chosen; its sentinel (in the source) lets asset-guard.js detect a missing file.
const midnightLink=/<link rel="stylesheet" data-ox-midnight-href="([^"]+)" data-ox-midnight-tools="([^"]+)">/;
const midnightMatch=html.match(midnightLink);
if(!midnightMatch)throw Error('Midnight Ink stylesheet placeholder missing');
const rebase=(path,text)=>text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,quote,url)=>/^(?:[a-z]+:|\/|#)/i.test(url)?all:`url("${basePath+'/'+relative(root,resolve(root,dirname(path),url))}")`);
const midnightFiles=[];
for(const [source,suffix]of [[midnightMatch[1],'midnight'],[midnightMatch[2],'midnight-tools']]){
 const path=source.split('?')[0];
 const css=rebase(path,await readFile(resolve(root,path),'utf8'));
 if(suffix==='midnight'&&!css.includes('--ox-theme-midnight-ready:1'))throw Error('Midnight Ink sheet lacks its asset-guard sentinel');
 const file=`src/generated/site-theme-${suffix}-${createHash('sha256').update(css).digest('hex').slice(0,12)}.css`;
 await writeFile(resolve(root,'dist/client',file),css);midnightFiles.push(file);
}
html=html.replace(midnightMatch[0],()=>`<link rel="stylesheet" data-ox-midnight-href="${midnightFiles[0]}" data-ox-midnight-tools="${midnightFiles[1]}">`);
html=html.replace('<head>',`<head><meta name="ox-site-base-path" content="${basePath}">${apiBase?`<meta name="ox-tw-data-api-base" content="${apiBase}">`:''}`).replace('href="/favicon.svg"',`href="${basePath}/favicon.svg"`);
if(siteUrl)html=html.replaceAll('content="icons/og-image.png"',`content="${siteUrl}/icons/og-image.png"`).replace('<meta property="og:type"',`<meta property="og:url" content="${siteUrl}/"><meta property="og:type"`);
// Every hashed asset of this version. The deploy workflow carries the assets
// of the previous versions forward, and pages compare their build version to
// detect that a newer HTML exists. The version depends on code and styles
// only (programVersion): a data-only deploy keeps it.
async function listFiles(dir,prefix){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+entry.name;if(entry.isDirectory())out.push(...await listFiles(resolve(dir,entry.name),rel));else out.push(rel);}return out;}
const assets=(await listFiles(resolve(root,'dist/client/src/generated'),'src/generated')).sort();
const digests=Object.fromEntries(await Promise.all(assets.map(async path=>[path,createHash('sha256').update(await readFile(resolve(root,'dist/client',path))).digest('hex')])));
const buildVersion=programVersion(html,digests);
html=html.replace('<head>',`<head><meta name="ox-build" content="${buildVersion}">`);
await writeFile(resolve(root,'dist/client/data/build-manifest.json'),JSON.stringify({schemaVersion:1,version:buildVersion,builtAt:new Date().toISOString(),assets,previous:[]}));
await writeFile(resolve(root,'dist/client/index.html'),html);
await writeFile(resolve(root,'dist/client/.nojekyll'),'');
const fsShim={name:'worker-assets',setup(b){
 b.onResolve({filter:/^node:fs\/promises$/},()=>({path:'asset-fs',namespace:'asset-fs'}));
 b.onLoad({filter:/.*/,namespace:'asset-fs'},()=>({contents:`import {Buffer} from 'node:buffer';export async function readFile(url,encoding){const path=new URL(url).pathname.slice(1);const b=Buffer.from(await globalThis.__twReadAsset(path));return encoding?b.toString(encoding):b;}`,loader:'js'}));
 b.onLoad({filter:/\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('import.meta.url',JSON.stringify('https://assets.local/'+relative(root,args.path))),loader:'js',resolveDir:dirname(args.path)}));
}};
await build({entryPoints:[resolve(root,'worker/index.js')],bundle:true,format:'esm',platform:'node',target:'es2022',minify:true,external:['node:*'],define:{'process.env':'globalThis.__twEnv'},outfile:resolve(root,'dist/server/index.js'),plugins:[resolveVersion,fsShim]});
await mkdir(resolve(root,'dist/.openai'),{recursive:true});await cp(resolve(root,'.openai/hosting.json'),resolve(root,'dist/.openai/hosting.json'));
console.log('Built independent Taiwan client and Worker');
