// Inlined at the top of <head>. After a deploy, a cached older HTML can point
// at a stylesheet or runtime that no longer loads. Reload once (guarded by a
// sessionStorage flag, so never in a loop) to fetch the current HTML.
(() => {
  const KEY = 'ox-tw-asset-reload';
  function reload(reason) {
    try { if (sessionStorage.getItem(KEY)) return false; sessionStorage.setItem(KEY, String(reason || '1')); }
    catch { return false; }
    location.reload();
    return true;
  }
  window.OXAssetReload = reload;
  addEventListener('load', () => {
    const root = getComputedStyle(document.documentElement);
    const midnight = document.querySelector('link[data-ox-midnight-href][href]');
    const missing = [...document.querySelectorAll('link[data-ox-sheet]')]
      .some(link => root.getPropertyValue(`--ox-theme-${link.dataset.oxSheet}-ready`).trim() !== '1')
      // The Midnight Ink sheet, when active, carries its own sentinel.
      || Boolean(midnight && midnight.dataset.oxMidnightState !== 'loading' && root.getPropertyValue('--ox-theme-midnight-ready').trim() !== '1');
    if (missing) { reload('css'); return; }
    // Styles are complete; allow a future recovery in this tab.
    setTimeout(() => { try { if (globalThis.OXAppReady) sessionStorage.removeItem(KEY); } catch {} }, 10000);
  });
})();
