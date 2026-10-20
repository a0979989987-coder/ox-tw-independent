// GitHub Pages caches HTML for ten minutes and its headers cannot be changed.
// Compare this page's build with the published manifest (never cached); when
// a newer build exists, offer a one-tap refresh instead of reloading under the
// user. Hashed assets of earlier builds stay published, so nothing breaks.
export async function checkBuildVersion({ current = globalThis.document?.querySelector('meta[name="ox-build"]')?.content,
  fetcher = fetch, url = 'data/build-manifest.json' } = {}) {
  if (!current) return { stale: false };
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) return { stale: false };
  const manifest = await response.json();
  return { stale: typeof manifest.version === 'string' && manifest.version !== current, version: manifest.version };
}

export function startVersionCheck({ interval = 15 * 60000, check = checkBuildVersion } = {}) {
  if (typeof document === 'undefined' || !document.querySelector('meta[name="ox-build"]')) return;
  let last = 0, offered = false;
  const run = async () => {
    if (offered || document.hidden || Date.now() - last < interval) return;
    last = Date.now();
    try { const { stale } = await check(); if (stale) { offered = true; offerRefresh(); } } catch {}
  };
  const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 4000));
  addEventListener('load', () => idle(run, { timeout: 15000 }), { once: true });
  if (document.readyState === 'complete') idle(run, { timeout: 15000 });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
}

function offerRefresh() {
  const toast = document.getElementById('toast'); if (!toast) return;
  toast.replaceChildren();
  const text = document.createElement('span'); text.textContent = 'OX 已更新新版本。';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '重新整理';
  button.style.cssText = 'margin-left:10px;min-height:32px;padding:4px 12px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:8px;cursor:pointer';
  button.addEventListener('click', () => location.reload());
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', '稍後再說'); close.textContent = '×';
  close.style.cssText = 'margin-left:6px;min-width:32px;min-height:32px;font:inherit;color:inherit;background:transparent;border:0;cursor:pointer';
  close.addEventListener('click', () => toast.classList.remove('show'));
  toast.append(text, button, close);
  toast.style.pointerEvents = 'auto';
  if (matchMedia('(max-width: 767px)').matches) toast.style.cssText += ';left:12px;right:12px;bottom:calc(96px + env(safe-area-inset-bottom))';
  toast.classList.add('show');
}
