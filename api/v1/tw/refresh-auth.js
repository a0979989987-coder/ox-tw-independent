// refresh=1 skips caches and forces new requests to the official sources.
// Only an operator presenting OX_REFRESH_TOKEN in this header may do that;
// any other refresh parameter is ignored and the request is served normally.
export const REFRESH_HEADER = 'x-ox-refresh-token';
const MIN_TOKEN_LENGTH = 16;

// Constant-time for equal lengths: every byte is compared, no early exit.
export function constantTimeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0, n = Math.max(x.length, y.length); i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function refreshAuthorized(headers, env) {
  const token = typeof env?.OX_REFRESH_TOKEN === 'string' ? env.OX_REFRESH_TOKEN : '';
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const raw = typeof headers?.get === 'function' ? headers.get(REFRESH_HEADER) : headers?.[REFRESH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 && constantTimeEqual(value, token);
}
