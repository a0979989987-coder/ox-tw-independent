// Light-theme rules ship as separate stylesheets (see scripts/css-theme-split.mjs)
// whose <link> placeholders stay inert until the light theme is used. They sit
// right after their base sheet, so activating them keeps the original cascade.
export function lightSheetLinks(doc = globalThis.document) {
  return [...(doc?.querySelectorAll?.('link[data-ox-light-href]') || [])];
}
export function lightSheetsReady(doc) {
  return lightSheetLinks(doc).every(link => link.dataset.oxLightState === 'loaded' || link.dataset.oxLightState === 'error');
}
// Resolves once every light sheet loaded (or failed / timed out), so the theme
// switch happens in one step instead of flashing half-styled.
export function ensureLightSheets({ doc, timeoutMs = 5000 } = {}) {
  return Promise.all(lightSheetLinks(doc).map(link => {
    if (link.dataset.oxLightState === 'loaded' || link.dataset.oxLightState === 'error') return null;
    return link.oxLightJob ??= new Promise(resolve => {
      const done = state => { clearTimeout(timer); if (!link.dataset.oxLightState || link.dataset.oxLightState === 'loading') link.dataset.oxLightState = state; resolve(); };
      const timer = setTimeout(() => done('error'), timeoutMs);
      link.addEventListener('load', () => done('loaded'), { once: true });
      link.addEventListener('error', () => done('error'), { once: true });
      link.dataset.oxLightState = 'loading';
      if (!link.getAttribute('href')) link.setAttribute('href', link.dataset.oxLightHref);
      else if (link.sheet) done('loaded');
    });
  }));
}

// Midnight Ink is one override sheet placed after every other stylesheet. Its
// <link> has no href until the theme is chosen (theme-boot.js activates it
// during parsing when the saved choice is midnight). Shadow-root tools receive
// a companion sheet (data-ox-midnight-tools) as text.
export function midnightSheetLink(doc = globalThis.document) {
  return doc?.querySelector?.('link[data-ox-midnight-href]') || null;
}
export function midnightSheetReady(doc) {
  const link = midnightSheetLink(doc);
  return !link || link.dataset.oxMidnightState === 'loaded' || link.dataset.oxMidnightState === 'error';
}
export function ensureMidnightSheet({ doc, timeoutMs = 5000 } = {}) {
  const link = midnightSheetLink(doc);
  if (!link || midnightSheetReady(doc)) return Promise.resolve();
  return link.oxMidnightJob ??= new Promise(resolve => {
    const done = state => { clearTimeout(timer); if (!link.dataset.oxMidnightState || link.dataset.oxMidnightState === 'loading') link.dataset.oxMidnightState = state; resolve(); };
    const timer = setTimeout(() => done('error'), timeoutMs);
    link.addEventListener('load', () => done('loaded'), { once: true });
    link.addEventListener('error', () => done('error'), { once: true });
    if (link.getAttribute('href') && link.sheet) { done('loaded'); return; }
    link.dataset.oxMidnightState = 'loading';
    if (!link.getAttribute('href')) link.setAttribute('href', link.dataset.oxMidnightHref);
  });
}
export function midnightToolsHref(doc = globalThis.document) {
  const link = midnightSheetLink(doc);
  return link?.dataset.oxMidnightTools ? new URL(link.dataset.oxMidnightTools, doc.baseURI).href : '';
}
