// A market switch must not restart a background refresh already in progress.
export function createPreloader(load, { ttl = 300000, now = Date.now, usable = value => !!value?.data } = {}) {
  let pending = null, value = null, completedAt = -Infinity;
  return function preload({ force = false, ...options } = {}) {
    if (pending) return pending;
    if (!force && usable(value) && now() - completedAt < ttl) return Promise.resolve(value);
    pending = Promise.resolve().then(() => load({force,...options})).then(result => {
      value = result;
      if (usable(result)) completedAt = now();
      return result;
    }).finally(() => { pending = null; });
    return pending;
  };
}
