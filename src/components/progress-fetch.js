// A slow but advancing download must not be cancelled by a fixed deadline.
// Abort only when no bytes arrive for `idleMs`, or after the hard `totalMs`.
export async function fetchWithProgress(url, { idleMs = 8000, totalMs = 60000, signal, init = {}, onProgress, fetcher = fetch } = {}) {
  const controller = new AbortController();
  let idleTimer, reason = null;
  const fail = (message, name = 'TimeoutError') => { if (reason) return; reason = new DOMException(message, name); controller.abort(reason); };
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => fail('下載停滯逾時'), idleMs); };
  const totalTimer = setTimeout(() => fail('下載逾時'), totalMs);
  const cancel = () => fail('下載已取消', 'AbortError');
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(reason || controller.signal.reason), { once: true }));
  aborted.catch(() => {});
  try {
    touch();
    const response = await Promise.race([fetcher(url, { ...init, signal: controller.signal }), aborted]);
    touch();
    if (!response.body?.getReader) {
      const text = await Promise.race([response.text(), aborted]);
      return { response, text };
    }
    const reader = response.body.getReader(), decoder = new TextDecoder(), parts = [];
    let received = 0;
    const total = Number(response.headers?.get?.('content-length')) || 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      received += value.byteLength; touch();
      parts.push(decoder.decode(value, { stream: true }));
      onProgress?.({ received, total });
    }
    parts.push(decoder.decode());
    return { response, text: parts.join('') };
  } catch (error) {
    throw reason || error;
  } finally {
    clearTimeout(idleTimer); clearTimeout(totalTimer);
    signal?.removeEventListener('abort', cancel);
  }
}
