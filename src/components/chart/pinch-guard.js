// Two fingers on a chart zoom the chart, never the page. Where a chart still
// lets one finger scroll the page (touch-action: pan-y at 100 %), the browser
// would otherwise take a two-finger pinch for page zoom; iOS Safari also zooms
// through its own gesture events. Touch events are cancelled only for a pinch,
// or for a single finger the chart claims (`claims`), so pointer events still
// reach the chart and an ordinary vertical swipe still scrolls the page.
export function keepPinchInChart(element, { signal, inChart = () => true, claims = () => false } = {}) {
  let owned = false;
  const touch = event => {
    if (event.type === 'touchstart') owned = event.touches.length > 1 ? inChart(event.target) : event.touches.length === 1 && inChart(event.target) && claims(event.touches[0], event);
    if ((owned || event.touches.length > 1 && inChart(event.target)) && event.cancelable) event.preventDefault();
  };
  const release = event => { if (!event.touches.length) owned = false; };
  const gesture = event => { if (inChart(event.target) && event.cancelable !== false) event.preventDefault(); };
  element.addEventListener('touchstart', touch, { passive: false, signal });
  element.addEventListener('touchmove', touch, { passive: false, signal });
  element.addEventListener('touchend', release, { passive: true, signal });
  element.addEventListener('touchcancel', release, { passive: true, signal });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) element.addEventListener(type, gesture, { passive: false, signal });
}
