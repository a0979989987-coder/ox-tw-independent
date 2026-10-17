import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const dist=path=>new URL('../dist/client/'+path,import.meta.url);
const pngSize=buffer=>[buffer.readUInt32BE(16),buffer.readUInt32BE(20)];

test('the web app manifest works under the GitHub Pages sub-path',async()=>{
  const manifest=JSON.parse(await readFile(dist('manifest.webmanifest'),'utf8'));
  assert.equal(manifest.name,'OX 篩選器｜台股');assert.equal(manifest.short_name,'OX 台股');
  for(const key of ['start_url','scope'])assert.equal(manifest[key],'./','relative, so it resolves inside /ox-tw-independent/');
  const sizes=new Set();
  for(const icon of manifest.icons){
    assert(!/^\/|^[a-z]+:/i.test(icon.src),'icon paths are relative');
    const [w,h]=pngSize(await readFile(dist(icon.src)));
    assert.equal(`${w}x${h}`,icon.sizes);sizes.add(icon.sizes);
  }
  assert(sizes.has('192x192')&&sizes.has('512x512'));
  assert(manifest.icons.some(icon=>icon.purpose==='maskable'));
});

test('the page links the manifest, touch icon and link-preview tags',async()=>{
  const html=await readFile(dist('index.html'),'utf8');
  assert(html.includes('<link rel="manifest" href="manifest.webmanifest">'));
  assert.deepEqual(pngSize(await readFile(dist('icons/apple-touch-icon.png'))),[180,180]);
  assert.deepEqual(pngSize(await readFile(dist('icons/og-image.png'))),[1200,630]);
  for(const tag of ['og:title','og:description','og:image','twitter:card','twitter:image'])assert(html.includes(tag),tag);
  assert.match(html,/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
  assert(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b/.test(html),'pinch zoom stays available');
});
