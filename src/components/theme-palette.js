// Canvas and chart colours follow the active theme. Midnight Ink shares this
// palette with the crypto site; the CSS twin is src/styles/themes/midnight-ink.css.
export const MIDNIGHT_INK = Object.freeze({
  page: '#0A0E16', surface: '#0F1520', surface2: '#151C29', raised: '#1B2433',
  line: 'rgba(226,232,240,0.08)', lineStrong: 'rgba(226,232,240,0.16)', grid: 'rgba(226,232,240,0.06)',
  text: '#ECE7DE', sub: '#A9B0BC', weak: '#6E7685',
  accent: '#D9C79A', accentWash: 'rgba(217,199,154,0.14)'
});
// 'light' | 'midnight' | 'dark' (Midnight Ink is a dark theme: it never has theme-light).
export function activeTheme(doc = globalThis.document) {
  const body = doc?.body;
  return body?.classList.contains('theme-light') ? 'light' : body?.classList.contains('theme-midnight') ? 'midnight' : 'dark';
}
