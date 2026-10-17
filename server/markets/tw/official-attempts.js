// Bounded requests to the official daily reports. The daily snapshot keeps
// its retries; the history back-fill makes one attempt per report whose
// timeout is the time left before its deadline, so a stalled source cannot
// hold the job past its budget (the next scheduled run continues the work).
export const MIN_ATTEMPT_MS = 2000, CURL_MAX_SECONDS = 35;

// curl arguments for one report: `--max-time` never exceeds the time left;
// `--retry` only without a deadline. execTimeoutMs also kills a stuck process.
export function curlRequest(url, { timeoutMs = CURL_MAX_SECONDS * 1000, retry = true } = {}) {
  const seconds = Math.max(1, Math.min(CURL_MAX_SECONDS, Math.floor(timeoutMs / 1000)));
  return { args: ['--http1.1', '-fsSL', ...(retry ? ['--retry', '2'] : []), '--max-time', String(seconds), url],
    execTimeoutMs: (retry ? 3 : 1) * seconds * 1000 + 5000 };
}

// attempt(index, {timeoutMs, retry}) is called at most `attempts` times. With
// a deadline, no attempt starts with less than MIN_ATTEMPT_MS left and each
// receives the remaining time; there is no back-off after the last attempt.
export async function boundedAttempts(attempt, { attempts = 6, deadline = null, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), backoffMs = index => 500 * (index + 1) } = {}) {
  let error;
  for (let index = 0; index < attempts; index++) {
    const left = deadline === null ? null : deadline - now();
    if (left !== null && left < MIN_ATTEMPT_MS) { error ??= Error('back-fill time budget reached'); break; }
    try { return await attempt(index, left === null ? {} : { timeoutMs: left, retry: false }); }
    catch (cause) { error = cause; if (index + 1 < attempts) await sleep(backoffMs(index)); }
  }
  throw error;
}
