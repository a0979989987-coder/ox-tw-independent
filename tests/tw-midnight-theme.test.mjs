import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

const dist=path=>new URL('../dist/client/'+path,import.meta.url);
const html=await readFile(dist('index.html'),'utf8');
const link=html.match(/<link rel="stylesheet" data-ox-midnight-href="([^"]+)" data-ox-midnight-tools="([^"]+)">/);

test('Midnight Ink ships as hashed sheets that stay inert until the theme is chosen',async()=>{
  assert(link,'midnight placeholder present');
  const [,page,tools]=link;
  assert.match(page,/^src\/generated\/site-theme-midnight-[a-f0-9]{12}\.css$/);
  assert.match(tools,/^src\/generated\/site-theme-midnight-tools-[a-f0-9]{12}\.css$/);
  assert(!/\shref=/.test(link[0]),'no href, so dark and light pages never download it');
  await access(dist(page));await access(dist(tools));
  const manifest=JSON.parse(await readFile(dist('data/build-manifest.json'),'utf8'));
  for(const file of [page,tools])assert(manifest.assets.includes(file),`${file} is retained across deploys`);
  const css=await readFile(dist(page),'utf8');
  assert(css.includes('--ox-theme-midnight-ready:1'),'asset-guard sentinel');
});

test('Midnight Ink comes after every other stylesheet and is activated during parsing',()=>{
  const sheets=[...html.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m=>m.index);
  assert.equal(Math.max(...sheets),link.index,'last stylesheet in the cascade');
  const boot=html.indexOf('data-ox-bootstrap="src/app/theme-boot.js"');
  assert(boot>link.index&&boot<html.indexOf('</head>'),'activation script follows the placeholder in <head>');
  assert(html.indexOf('data-ox-bootstrap="src/app/preferences.js"')<link.index,'saved choice is read before');
});

test('every Midnight Ink rule is scoped to the theme, and the palette matches the shared tokens',async()=>{
  const strip=css=>css.replace(/\/\*[\s\S]*?\*\//g,'');
  const page=strip(await readFile(new URL('../src/styles/themes/midnight-ink.css',import.meta.url),'utf8'));
  const tools=strip(await readFile(new URL('../src/styles/themes/midnight-ink-tools.css',import.meta.url),'utf8'));
  const preludes=css=>[...css.matchAll(/([^{}]+)\{/g)].map(m=>m[1].trim()).filter(p=>p&&!p.startsWith('@'));
  const selectors=prelude=>{const out=[];let depth=0,last=0;for(let i=0;i<prelude.length;i++){const c=prelude[i];if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&!depth){out.push(prelude.slice(last,i));last=i+1;}}out.push(prelude.slice(last));return out.map(s=>s.trim());};
  for(const prelude of preludes(page))for(const part of selectors(prelude))assert(part.startsWith(':root[data-ox-palette="midnight"]'),part);
  for(const prelude of preludes(tools))for(const part of selectors(prelude))assert(part.startsWith(':host([data-ox-midnight])'),part);
  for(const token of ['#0A0E16','#0F1520','#151C29','#1B2433','rgba(226,232,240,.08)','rgba(226,232,240,.16)','#ECE7DE','#A9B0BC','#6E7685','#D9C79A','rgba(217,199,154,.14)'])
    for(const css of [page,tools])assert(css.includes(token),token);
  const {MIDNIGHT_INK}=await import('../src/components/theme-palette.js');
  assert.equal(MIDNIGHT_INK.page,'#0A0E16');assert.equal(MIDNIGHT_INK.accent,'#D9C79A');assert.equal(MIDNIGHT_INK.text,'#ECE7DE');
});

test('the theme control offers dark, platinum, Midnight Ink and automatic, in the crypto order',()=>{
  const choices=[...html.matchAll(/data-control-theme="([a-z]+)"[^>]*>([^<]+)</g)].map(m=>m[1]+':'+m[2]);
  assert.deepEqual(choices,['dark:深色','light:白金','midnight:午夜墨','system:自動']);
  assert(html.includes('<meta name="theme-color" content="#080b0f">'));
});

test('a saved automatic choice stays automatic and follows the OS before paint',async()=>{
  const {runInNewContext}=await import('node:vm');
  const code=await readFile(new URL('../src/app/preferences.js',import.meta.url),'utf8');
  for(const [osLight,scheme,meta] of [[true,'light','#f4f4f5'],[false,'dark','#080b0f']]){
    const writes=[],metaTag={content:''},root={style:{},dataset:{}};
    const document={documentElement:root,head:{append(){}},createElement:()=>({}),querySelector:()=>metaTag};
    const localStorage={getItem:key=>key==='ox-tw-independent-theme'?'system':'1',setItem:(...args)=>writes.push(args)};
    runInNewContext(code,{document,localStorage,matchMedia:()=>({matches:osLight})});
    assert.equal(root.style.colorScheme,scheme);assert.equal(metaTag.content,meta);
    assert.equal(root.dataset.oxPalette,undefined,'automatic never resolves to Midnight Ink');
    assert.deepEqual(writes,[],'the saved choice is not rewritten');
  }
});
