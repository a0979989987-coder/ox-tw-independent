import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {splitThemeCSS,lightOnlySelector,specificity} from '../scripts/css-theme-split.mjs';

test('only rules that can match nothing but the light theme move to the light sheet',()=>{
  assert(lightOnlySelector('body.theme-light .card, .theme-light .x'));
  assert(lightOnlySelector('[data-ox-theme="light"] main'));
  assert(!lightOnlySelector('body:not(.theme-light) .card'));
  assert(!lightOnlySelector(':is(.theme-light,.print) .card'));
  assert(!lightOnlySelector('body.theme-light .a, .b'));
  assert(!lightOnlySelector('.theme-lighter .a'));
});

test('light rules leave the base sheet, including inside media queries, keeping everything else in order',()=>{
  const css='@keyframes s{to{opacity:1}}.a{color:red}body.theme-light .a{color:blue}@media (max-width:700px){.b{margin:0}body.theme-light .b{background:#fff}}';
  const {base,light}=splitThemeCSS(css);
  assert.equal(base,'@keyframes s{to{opacity:1}}.a{color:red}@media (max-width:700px){.b{margin:0}}');
  assert.match(light,/body\.theme-light \.a\{color:blue\}/);
  assert.match(light,/@media \(max-width:700px\)\{body\.theme-light \.b\{background:#fff\}/);
});

test('a light rule that a later equal-specificity base rule overrides stays in place',()=>{
  // Originally "main.shell .z" wins over "body.theme-light .q" only by coming later
  // (same specificity, same property family); moving the light rule after it
  // would flip the result, so it is kept.
  const css='body.theme-light .q{border-color:#ddd}main.shell .z{border:1px solid red}.theme-light .w{color:#000}';
  assert.deepEqual(specificity('body.theme-light .q'),specificity('main.shell .z'));
  const {base,light,stats}=splitThemeCSS(css);
  assert.equal(stats.kept,1);assert.equal(stats.moved,1);
  assert(base.includes('body.theme-light .q{border-color:#ddd}'));
  assert(light.includes('.theme-light .w{color:#000}'));
  assert.deepEqual(specificity(':where(.a) .b:not(#c)'),[1,1,0]);
});

test('published dark pages load no light-only CSS; the light sheets follow their base sheet',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const links=[...html.matchAll(/<link rel="stylesheet"([^>]*)>/g)].map(m=>m[1]);
  const light=links.filter(attrs=>attrs.includes('data-ox-light-href'));
  assert(light.length>=1);
  for(const attrs of light)assert(!/\shref=/.test(attrs),'light placeholders have no href until the light theme is used');
  links.forEach((attrs,index)=>{if(attrs.includes('data-ox-light-href'))assert(links[index-1].includes('data-ox-sheet'),'light sheet directly follows its base sheet');});
  assert(html.includes('src/styles/mobile/no-backdrop.css')===false,'mobile override is bundled into the site theme');
});
