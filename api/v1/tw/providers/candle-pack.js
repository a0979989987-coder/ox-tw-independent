/*
 * Published daily K-line pack (data/tw-patterns), rebuilt in the repository
 * from official TWSE／TPEx daily reports. Candles read it first so a chart
 * does not depend on the per-month official history endpoints when the pack
 * already holds the requested range.
 */
const PACK_DIR = 'data/tw-patterns/';
const parsedChunks = new WeakMap();

async function gunzipText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function readChunk(bytes) {
  if (!parsedChunks.has(bytes)) parsedChunks.set(bytes, gunzipText(bytes).then(JSON.parse));
  return parsedChunks.get(bytes);
}

function packCandle(row) {
  return Object.freeze({
    datetime: row.date, date: row.date,
    open: row.open, high: row.high, low: row.low, close: row.close,
    volume: row.volume,
    turnoverTwd: Number.isFinite(row.quoteVolume) ? row.quoteVolume : null,
    // The pack does not carry these official columns; never derive them.
    change: null, transactions: null
  });
}

// Returns null when the pack cannot be read or does not hold the symbol, so
// the caller falls back to the official monthly history.
export async function readPackCandles(symbol, { read = globalThis.__twReadAsset } = {}) {
  if (typeof read !== 'function') return null;
  const manifest = JSON.parse(new TextDecoder().decode(await read(PACK_DIR + 'manifest.json')));
  const dates = manifest?.dates;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest?.date || '') || !Array.isArray(dates) || !dates.length || dates.at(-1) !== manifest.date || !Array.isArray(manifest.chunks)) return null;
  const chunk = manifest.chunks.find(row => Array.isArray(row?.symbols) && row.symbols.includes(symbol));
  if (!chunk || !/^daily-\d+\.json\.gz$/.test(chunk.file || '')) return null;
  const payload = await readChunk(await read(PACK_DIR + chunk.file));
  // A chunk from another build day would mix two pack revisions.
  if (payload?.date !== manifest.date || !Array.isArray(payload.entries)) return null;
  const data = payload.entries.find(entry => entry?.data?.symbol === symbol)?.data;
  const market = String(data?.board || '').toUpperCase();
  if (!data || !['TWSE', 'TPEX'].includes(market) || data.dataDate !== manifest.date || !Array.isArray(data.candles)) return null;
  const candles = data.candles.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '')).map(packCandle);
  if (!candles.length) return null;
  return { date: manifest.date, firstDate: dates[0], market, name: String(data.name || ''), candles };
}
