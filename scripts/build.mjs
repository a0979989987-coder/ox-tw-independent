import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {TOOL_STYLES,newsAssets} from './client-assets.mjs';
const root=resolve(import.meta.dirname,'..');
const basePath=process.env.SITE_BASE_PATH||'';
if(basePath&&!/^\/[a-zA-Z0-9_.-]+$/.test(basePath))throw Error('Invalid site base path');
const apiBase=process.env.TW_API_BASE||'';
if(apiBase){const url=new URL(apiBase);if(url.protocol!=='https:'&&!['localhost','127.0.0.1','terminal.local'].includes(url.hostname))throw Error('Taiwan API must use HTTPS');}
const resolveVersion={name:'versioned-imports',setup(b){b.onResolve({filter:/^\./},args=>({path:resolve(args.resolveDir,args.path.split('?')[0])}));}};
const browserURLs={name:'original-browser-urls',setup(b){b.onLoad({filter:/\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('import.meta.url',`new URL(${JSON.stringify(basePath+'/'+relative(root,args.path))},location.href).href`),loader:'js',resolveDir:dirname(args.path)}));}};
await mkdir(resolve(root,'src/generated'),{recursive:true});
const entries=['/src/components/patterns/view.js','/src/markets/tw/patterns/source.js','/src/markets/tw/patterns/index-cache.js','/src/markets/tw/bubbles/view.js','/src/markets/tw/etf/view.js','/src/markets/tw/etf/savings.js'];
const contents="import './src/app/app.js';\n"+entries.map((p,i)=>`import * as m${i} from '.${p}';`).join('\n')+`\nexport const tools={${entries.map((p,i)=>JSON.stringify(p)+`:m${i}`).join(',')}};`;
const styles=Object.fromEntries(await Promise.all(TOOL_STYLES.map(async path=>['/'+path,(await readFile(resolve(root,path),'utf8')).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(all,quote,url)=>/^(?:[a-z]+:|\/|#)/i.test(url)?all:`url("${basePath+'/'+relative(root,resolve(root,dirname(path),url))}")`)])));
await build({stdin:{contents,resolveDir:root,loader:'js'},bundle:true,format:'iife',globalName:'OXTWBundle',platform:'browser',minify:true,outfile:resolve(root,'src/generated/runtime.js'),banner:{js:`if(!globalThis.__OXTWRuntimeStarted){globalThis.__OXTWRuntimeStarted=true;globalThis.OXStyleTexts=${JSON.stringify(styles)};`},footer:{js:'globalThis.OXToolModules=OXTWBundle.tools;}'},plugins:[resolveVersion,browserURLs]});
const runtime=await readFile(resolve(root,'src/generated/runtime.js'),'utf8');
const runtimeVersion=createHash('sha256').update(runtime).digest('hex').slice(0,12);
await build({entryPoints:[resolve(root,'src/components/patterns/worker.js')],bundle:true,format:'esm',platform:'browser',minify:true,outfile:resolve(root,'src/generated/pattern-worker.js'),plugins:[resolveVersion]});
await rm(resolve(root,'dist'),{recursive:true,force:true});
await mkdir(resolve(root,'dist/client'),{recursive:true});
for(const name of ['index.html','favicon.svg','src','data'])await cp(resolve(root,name),resolve(root,'dist/client',name),{recursive:true});
const news=newsAssets(JSON.parse(await readFile(resolve(root,'data/news.json'),'utf8')));
for(const [name,data]of Object.entries(news))await writeFile(resolve(root,`dist/client/data/news-${name}.json`),JSON.stringify(data));
const bootPath=resolve(root,'dist/client/src/app/module-boot.js');
await writeFile(bootPath,(await readFile(bootPath,'utf8')).replaceAll('20261012-startup1',runtimeVersion));
let html=await readFile(resolve(root,'dist/client/index.html'),'utf8');
html=html.replaceAll('20261012-startup1',runtimeVersion);
// Small boot scripts travel with HTML. A stalled deferred helper download can
// otherwise prevent the recovery timer itself from ever starting.
for(const path of ['src/components/control-panel/resource-guard.js','src/app/preferences.js','src/components/loading-state.js','src/app/module-boot.js']){
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
 const version=createHash('sha256').update(css).digest('hex').slice(0,12);
 const file=`src/generated/site-theme-${index}-${version}.css`;
 await writeFile(resolve(root,'dist/client',file),css);
 html=html.replace(match[0],`<link rel="stylesheet" href="${file}">`);
}
html=html.replace('<head>',`<head><meta name="ox-site-base-path" content="${basePath}">${apiBase?`<meta name="ox-tw-data-api-base" content="${apiBase}">`:''}`).replace('href="/favicon.svg"',`href="${basePath}/favicon.svg"`);
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
