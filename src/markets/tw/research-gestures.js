import { wheelChartViewport } from './research-bubbles.js?v=20261006-compact-zoom';
import { replaySectorAt } from './research-replay.js?v=20261006-replay';
import { keepPinchInChart } from '../../components/chart/pinch-guard.js';

// Wheel, pinch and drag on the sector bubble chart. Moves only update the
// shared view (prefs) and request one coalesced animation frame; the frame
// re-zooms just the replay frames on screen (`partial`). When the gesture
// settles, `settle` re-zooms every frame. Gestures never pause the replay.
export function attachBubbleGestures(root, { session: s, prefs, minZoom, draw, settle, repaint, signal,
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  let drag = null, pinch = null, wheelTimer = null;
  const touches = new Map();
  s.wheeling = false;
  // At 100 % one finger still scrolls the page (touch-action: pan-y); two
  // fingers zoom the chart right away instead of the whole page.
  keepPinchInChart(root, { signal, inChart: target => !!target?.closest?.('.twx-bubbles') });
  root.addEventListener('wheel', event => {
    const chart = event.target.closest('.twx-bubbles');
    if (!chart || event.deltaY === 0) return;
    const rect = chart.getBoundingClientRect(), box = chart.viewBox.baseVal;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    Object.assign(prefs, wheelChartViewport(prefs, {
      x: (event.clientX - rect.left) * box.width / rect.width,
      y: (event.clientY - rect.top) * box.height / rect.height,
      width: box.width, height: box.height, delta: pixels, minimum: minZoom()
    }));
    event.preventDefault();
    s.wheeling = true; draw({ partial: true });
    clearTimer(wheelTimer);
    wheelTimer = setTimer(() => { wheelTimer = null; s.wheeling = false; if (!s.interacting) settle(); }, 180);
  }, { passive: false, signal });
  const beginPinch = () => {
    const [a, b] = [...touches.values()];
    const chart = root.querySelector('.twx-bubbles'); if (!a || !b || !chart) return;
    const rect = chart.getBoundingClientRect();
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const point = { x: (center.x - rect.left) * chart.viewBox.baseVal.width / rect.width, y: (center.y - rect.top) * chart.viewBox.baseVal.height / rect.height };
    // The chart does not move during a pinch (touch-action:none while zoomed):
    // measure it once instead of forcing a layout on every pointermove.
    pinch = { rect, width: chart.viewBox.baseVal.width, height: chart.viewBox.baseVal.height,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: prefs.zoom,
      x: (point.x - chart.viewBox.baseVal.width / 2 - prefs.panX) / prefs.zoom, y: (point.y - (chart.viewBox.baseVal.height - 6) / 2 - prefs.panY) / prefs.zoom };
    drag = null;
    s.interacting = true;
    for (const id of touches.keys()) if (!root.hasPointerCapture(id)) root.setPointerCapture(id);
  };
  root.addEventListener('pointerdown', event => {
    const chart = event.target.closest('.twx-bubbles'); if (!chart || (event.pointerType !== 'touch' && event.button !== 0)) return;
    // Snapshot a moving bubble for detail taps without stopping the clock.
    const bubble = event.target.closest('.twx-bubble[data-sector]');
    s.pressedSector = bubble && prefs.replayIndex !== null
      ? replaySectorAt(s.replayFrames, prefs.replayIndex, bubble.dataset.sector) : null;
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) { beginPinch(); return; }
    }
    if (prefs.zoom <= 1) return;
    const rect = chart.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: prefs.panX, panY: prefs.panY, scale: chart.viewBox.baseVal.width / rect.width, moved: false };
  }, { signal });
  root.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const { rect, width, height } = pinch;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const x = ((a.x + b.x) / 2 - rect.left) * width / rect.width;
      const y = ((a.y + b.y) / 2 - rect.top) * height / rect.height;
      prefs.zoom = Math.max(minZoom(), Math.min(8, pinch.zoom * distance / pinch.distance));
      const bound = prefs.zoom * 170;
      prefs.panX = Math.max(-bound, Math.min(bound, x - width / 2 - pinch.x * prefs.zoom));
      prefs.panY = Math.max(-bound, Math.min(bound, y - (height - 6) / 2 - pinch.y * prefs.zoom));
      event.preventDefault(); draw({ partial: true }); return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !drag.moved) return;
    if (!drag.moved) { s.interacting = true; }
    drag.moved = true; event.preventDefault();
    if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId);
    const bound = prefs.zoom * 170;
    prefs.panX = Math.max(-bound, Math.min(bound, drag.panX + dx * drag.scale));
    prefs.panY = Math.max(-bound, Math.min(bound, drag.panY + dy * drag.scale));
    draw({ partial: true });
  }, { signal });
  const finishDrag = event => {
    if (touches.has(event.pointerId)) touches.delete(event.pointerId);
    if (pinch || s.interacting) { s.suppressClickUntil = now() + 600; if (touches.size < 2) { pinch = null; drag = null; } }
    if (drag?.id === event.pointerId) { if (drag.moved) s.suppressClickUntil = now() + 600; drag = null; }
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (!touches.size && !drag && !pinch) {
      const moved = s.interacting;
      s.interacting = false;
      if (moved && !s.wheeling) settle();
      if (s.pendingPaint) { s.pendingPaint = false; repaint(); }
    }
  };
  root.addEventListener('pointerup', finishDrag, { signal });
  root.addEventListener('pointercancel', finishDrag, { signal });
  signal?.addEventListener('abort', () => clearTimer(wheelTimer), { once: true });
}
