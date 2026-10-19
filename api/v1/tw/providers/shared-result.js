/*
 * OX v4.0 Modular
 * Taiwan official feed sharing
 *
 * The home page asks for breadth, market pulse and money flow directly and
 * again through indicators, all at once. Within one isolate, callers share the
 * request in flight and its successful result for a minute, the same window
 * the endpoints already advertise (s-maxage=60). Failures are not kept, so the
 * next caller asks again.
 */

export const SHARED_RESULT_TTL_MS = 60000;

export function shareRecentResult(load, ttlMs = SHARED_RESULT_TTL_MS) {
  let saved = null, pending = null;
  return function sharedResult() {
    if (saved && Date.now() - saved.time < ttlMs) return Promise.resolve(saved.value);
    if (!pending) {
      pending = load()
        .then(value => { saved = { time: Date.now(), value }; return value; })
        .finally(() => { pending = null; });
    }
    return pending;
  };
}
