// Swipe left or right on the page to move between the dock views, in dock
// order. Only a clear horizontal swipe counts, and never one that starts on
// content that handles its own horizontal gestures.
const ORDER = ['home', 'strength', 'radar', 'data'];
const MIN_DISTANCE = 70, MAX_TIME = 700, DIRECTION_RATIO = 1.8, EDGE = 20;
const OWN_GESTURES = 'input,textarea,select,[contenteditable],canvas,.chart-container,dialog,.oxc-sheet,.ox-control-overlay';

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

function playIn(direction) {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const main = document.querySelector('main.app-main') || document.querySelector('main');
  if (!main) return;
  main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev');
  void main.offsetWidth;
  main.classList.add(direction > 0 ? 'ox-swipe-in-next' : 'ox-swipe-in-prev');
  main.addEventListener('animationend', () => main.classList.remove('ox-swipe-in-next', 'ox-swipe-in-prev'), { once: true });
}

let start = null;
document.addEventListener('touchstart', event => {
  start = null;
  if (event.touches.length !== 1 || document.body.classList.contains('ox-control-open') || document.querySelector('dialog[open]')) return;
  const touch = event.touches[0];
  // Screen edges belong to the browser's back and forward gestures.
  if (touch.clientX < EDGE || touch.clientX > innerWidth - EDGE) return;
  if (handlesOwnGesture(event.composedPath())) return;
  start = { x: touch.clientX, y: touch.clientY, time: performance.now() };
}, { passive: true });

document.addEventListener('touchend', event => {
  if (!start) return;
  const touch = event.changedTouches[0], dx = touch.clientX - start.x, dy = touch.clientY - start.y, elapsed = performance.now() - start.time;
  start = null;
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO || elapsed > MAX_TIME) return;
  const index = ORDER.indexOf(document.body.dataset.view);
  if (index < 0) return;
  const direction = dx < 0 ? 1 : -1, next = ORDER[index + direction];
  if (!next || typeof window.switchAppView !== 'function') return;
  if (window.switchAppView(next) !== false) playIn(direction);
}, { passive: true });

document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
