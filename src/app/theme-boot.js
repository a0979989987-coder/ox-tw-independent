// Inlined directly after the Midnight Ink <link> placeholder, the last
// stylesheet in <head>. preferences.js already marked <html> from the saved
// choice; activating the parser-created link here keeps it render-blocking, so
// the first paint is already in Midnight Ink (no dark-to-midnight flash).
(() => {
  try {
    if (document.documentElement.dataset.oxPalette !== 'midnight') return;
    const link = document.querySelector('link[data-ox-midnight-href]');
    if (!link || link.getAttribute('href')) return;
    link.setAttribute('blocking', 'render');
    link.dataset.oxMidnightState = 'loading';
    link.addEventListener('load', () => { link.dataset.oxMidnightState = 'loaded'; }, { once: true });
    link.addEventListener('error', () => { link.dataset.oxMidnightState = 'error'; window.OXAssetReload?.('css'); }, { once: true });
    link.setAttribute('href', link.dataset.oxMidnightHref);
  } catch {}
})();
