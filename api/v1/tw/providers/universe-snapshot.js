/*
 * OX v4.0 Modular
 * Taiwan published market list
 *
 * Quote, candles, themes and indicators only need market membership and the
 * latest verified daily close. The independently published data/tw-radar.json
 * already holds both, so the six-source live rebuild runs only when that
 * snapshot is missing or incomplete. The Worker provides the reader
 * (GitHub first, bundled copy second); elsewhere there is no reader and the
 * callers rebuild the list live.
 */

export const UNIVERSE_SNAPSHOT_PATH = "data/tw-radar.json";
export const UNIVERSE_SNAPSHOT_SOURCE = "GitHub " + UNIVERSE_SNAPSHOT_PATH;
const SNAPSHOT_MAX_AGE_MS = 7 * 86400000;
const parsedUniverses = new WeakMap();

export function universeFromSnapshot(saved, now = Date.now()) {
  const data = saved?.data, rows = Array.isArray(data?.radar) ? data.radar : [];
  const sources = data?.meta?.sources || {};
  if (!Number.isFinite(saved?.savedAt) || saved.savedAt > now + 60000 || now - saved.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data?.dataDate || "") || data.meta?.partial !== false) return null;
  if (sources.TWSE !== "ready" || sources.TPEX !== "ready") return null;
  if (!rows.some(row => row?.market === "TWSE") || !rows.some(row => row?.market === "TPEX")) return null;
  return {
    rows, dataDate: data.dataDate, updatedAt: data.updatedAt || null,
    meta: { ...data.meta, universeSource: "independent-verified-snapshot", snapshotUpdatedAt: new Date(saved.savedAt).toISOString() }
  };
}

// Returns the published list, or null when there is no reader or the copy is
// missing, stale, one-market or partial. Callers then rebuild the list live.
export async function loadPublishedUniverse(read = globalThis.__twReadAsset) {
  if (typeof read !== "function") return null;
  try {
    // The reader memoizes bytes for a minute; parse each published copy once
    // for every endpoint that reads it.
    const bytes = await read(UNIVERSE_SNAPSHOT_PATH);
    if (!parsedUniverses.has(bytes)) parsedUniverses.set(bytes, universeFromSnapshot(JSON.parse(new TextDecoder().decode(bytes))));
    return parsedUniverses.get(bytes);
  } catch {
    return null;
  }
}
