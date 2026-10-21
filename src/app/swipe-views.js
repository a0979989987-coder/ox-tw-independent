// Swipe left or right to move between tabs. A swipe that starts in the top 35%
// of the screen moves the page's top tab rail; one that starts in the lower
// 65% moves the dock views (首頁, 指標, 雷達, 資訊). A swipe counts when it is
// a quick flick or a long drag and clearly horizontal, and never when it
// starts on content that handles its own horizontal gestures.
const ORDER = ['home', 'strength', 'radar', 'data'];
const TOP_ZONE = 0.35, EDGE = 20, DIRECTION_RATIO = 1.6;
const FLICK_DISTANCE = 60, FLICK_SPEED = 0.3, DRAG_DISTANCE = 120, MAX_TIME = 900;
const OWN_GESTURES = 'input,textarea,select,[contenteditable],canvas,.chart-container,dialog,[role="dialog"],.oxn-modal-backdrop,.oxn-popover,.oxc-sheet,.ox-control-overlay';
// Layers drawn over the page (news day list, filters) keep every swipe to themselves.
const OVERLAYS = 'dialog[open],.oxn-modal-backdrop,.oxn-popover.is-open,.oxc-sheet-backdrop';

function handlesOwnGesture(path) {
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.matches(OWN_GESTURES)) return true;
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
    if (node === document.body) break;
  }
  return false;
}

// The visible top tab rail of the current page (tools, news and radar rails share .twr-mode-rail).
function topRail() {
  const roots = [document, ...[...document.querySelectorAll('*')].filter(el => el.shadowRoot).map(el => el.shadowRoot)];
  let best = null;
  for (const root of roots) for (const rail of root.querySelectorAll('.twr-mode-rail')) {
    const rect = rail.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
    if (!best || rect.top < best.rect.top) best = { rail, rect };
  }
  return best?.rail || null;
}
function moveTopRail(direction) {
  const rail = topRail(); if (!rail) return false;
  const buttons = [...rail.querySelectorAll('button')].filter(b => !b.hidden && !b.disabled && b.getClientRects().length);
  const index = buttons.findIndex(b => b.classList.contains('active') || b.getAttribute('aria-selected') === 'true');
  const next = buttons[index + direction];
  if (index < 0 || !next) return false;
  next.click(); return true;
}

function playIn(direction) {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const main = document.querySelector('main.app-main') || document.querySelector('main');
  if (!main) return;
  main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev');
  void main.offsetWidth;
  main.classList.add(direction > 0 ? 'ox-swipe-in-next' : 'ox-swipe-in-prev');
  main.addEventListener('animationend', () => main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev'), { once: true });
}
function moveDock(direction) {
  const index = ORDER.indexOf(document.body.dataset.view), next = ORDER[index + direction];
  if (index < 0 || !next || typeof window.switchAppView !== 'function') return false;
  if (window.switchAppView(next) === false) return false;
  playIn(direction); return true;
}

export function isSwipe(dx, dy, elapsed) {
  const distance = Math.abs(dx);
  if (distance < Math.abs(dy) * DIRECTION_RATIO || elapsed > MAX_TIME) return false;
  return distance >= DRAG_DISTANCE || distance >= FLICK_DISTANCE && distance / Math.max(elapsed, 1) >= FLICK_SPEED;
}

let start = null;
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', event => {
    start = null;
    if (event.touches.length !== 1 || document.body.classList.contains('ox-control-open') || document.querySelector(OVERLAYS)) return;
    const touch = event.touches[0];
    // Screen edges belong to the browser's back and forward gestures.
    if (touch.clientX < EDGE || touch.clientX > innerWidth - EDGE) return;
    if (handlesOwnGesture(event.composedPath())) return;
    start = { x: touch.clientX, y: touch.clientY, time: performance.now(), top: touch.clientY < innerHeight * TOP_ZONE };
  }, { passive: true });

  document.addEventListener('touchend', event => {
    if (!start) return;
    const touch = event.changedTouches[0], dx = touch.clientX - start.x, dy = touch.clientY - start.y, elapsed = performance.now() - start.time, top = start.top;
    start = null;
    if (!isSwipe(dx, dy, elapsed)) return;
    const direction = dx < 0 ? 1 : -1;
    if (top) moveTopRail(direction); else moveDock(direction);
  }, { passive: true });

  document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}
