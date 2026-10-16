import {
  getOfficialTWRadar
} from "./radar.js";


/*
 * OX v4.0 Modular
 * Taiwan Quote / Quotes Provider
 *
 * Data source:
 *
 * Official TW Radar universe
 *
 * Radar universe itself is built from:
 *
 * TWSE
 * - STOCK_DAY_ALL
 * - official industry data
 *
 * TPEx
 * - tpex_mainboard_daily_close_quotes
 * - official industry data
 *
 *
 * Why reuse Radar:
 *
 * - Avoid downloading the whole Taiwan market again.
 * - Share the same normalized stock universe.
 * - Keep Quote / Radar market identity consistent.
 * - Reuse Radar's server-side cache.
 *
 *
 * Current quote type:
 *
 * Latest official daily snapshot.
 *
 * NOT licensed streaming real-time data.
 *
 *
 * Never manufacture unavailable values.
 */


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWQuoteProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_QUOTE_ERROR",

      symbol =
        "",

      details =
        null,

      cause =
        null
    } = {}
  ) {

    super(
      message
    );


    this.name =
      "TWQuoteProviderError";


    this.code =
      code;


    this.symbol =
      symbol;


    this.details =
      details;


    if (
      cause
    ) {

      this.cause =
        cause;
    }
  }
}


/* ========================================================================== */
/* Symbol                                                                     */
/* ========================================================================== */

function normalizeSymbol(
  value
) {

  const symbol =
    String(
      value ??
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !symbol
  ) {

    throw new TWQuoteProviderError(
      "Taiwan stock symbol is required.",
      {
        code:
          "TW_QUOTE_SYMBOL_REQUIRED"
      }
    );
  }


  /*
   * Taiwan listed / OTC company symbols
   * are normally numeric, but keeping
   * a small safe character set makes
   * the provider future compatible.
   */
  if (
    !/^[0-9A-Z.-]{1,16}$/
      .test(
        symbol
      )
  ) {

    throw new TWQuoteProviderError(
      "Invalid Taiwan stock symbol.",
      {
        code:
          "TW_QUOTE_INVALID_SYMBOL",

        symbol
      }
    );
  }


  return symbol;
}


function normalizeSymbols(
  values
) {

  let source =
    values;


  if (
    typeof source ===
      "string"
  ) {

    source =
      source
        .split(
          ","
        );
  }


  if (
    !Array.isArray(
      source
    )
  ) {

    source =
      [
        source
      ];
  }


  const symbols =
    [
      ...new Set(
        source
          .map(
            value =>
              String(
                value ??
                ""
              )
                .trim()
          )
          .filter(
            Boolean
          )
          .map(
            normalizeSymbol
          )
      )
    ];


  if (
    !symbols.length
  ) {

    throw new TWQuoteProviderError(
      "At least one Taiwan stock symbol is required.",
      {
        code:
          "TW_QUOTES_SYMBOLS_REQUIRED"
      }
    );
  }


  if (
    symbols.length >
      100
  ) {

    throw new TWQuoteProviderError(
      "A maximum of 100 Taiwan stock symbols can be requested at once.",
      {
        code:
          "TW_QUOTES_TOO_MANY_SYMBOLS"
      }
    );
  }


  return symbols;
}


/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function finiteNumber(
  value
) {

  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


/* ========================================================================== */
/* Radar universe                                                             */
/* ========================================================================== */

// Quotes and candles only need market membership and the latest verified daily
// close. The independently published data/tw-radar.json already holds both, so
// the six-source live rebuild runs only when that snapshot is missing or
// incomplete. The Worker provides the reader (GitHub first, bundled copy second).
const SNAPSHOT_PATH = "data/tw-radar.json";
const SNAPSHOT_MAX_AGE_MS = 7 * 86400000;
const snapshotUniverses = new WeakMap();

export function quoteUniverseFromSnapshot(saved, now = Date.now()) {
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

async function loadSnapshotUniverse(read) {
  try {
    // The reader memoizes bytes for a minute; parse each published copy once.
    const bytes = await read(SNAPSHOT_PATH);
    if (!snapshotUniverses.has(bytes)) snapshotUniverses.set(bytes, quoteUniverseFromSnapshot(JSON.parse(new TextDecoder().decode(bytes))));
    return snapshotUniverses.get(bytes);
  } catch {
    return null;
  }
}

async function loadQuoteUniverse(progress = {}) {

  if (typeof globalThis.__twReadAsset === "function") {
    progress.source = "GitHub data/tw-radar.json";
    const snapshot = await loadSnapshotUniverse(globalThis.__twReadAsset);
    if (snapshot) return snapshot;
  }

  progress.source = "official-tw universe (TWSE MI_INDEX / STOCK_DAY_ALL, TPEx daily close / openapi)";

  try {

    /*
     * Radar already owns the normalized
     * TWSE + TPEx official stock universe.
     *
     * Request enough rows to cover
     * essentially the whole current
     * common-stock universe.
     */
    const source =
      await getOfficialTWRadar(
        {
          market:
            "ALL",

          tier:
            "ALL",

          sort:
            "symbol",

          limit:
            2000
        }
      );


    const rows =
      Array.isArray(
        source?.radar
      )
        ? source.radar
        : [];


    if (
      !rows.length
    ) {

      throw new TWQuoteProviderError(
        "Taiwan quote universe is empty.",
        {
          code:
            "TW_QUOTE_UNIVERSE_EMPTY"
        }
      );
    }


    // A one-exchange list cannot prove that a stock does not exist. Report the
    // incomplete source instead of answering "not found" for the other market.
    if (source?.meta?.partial !== false) {
      throw new TWQuoteProviderError(
        "Taiwan quote universe is incomplete.",
        {
          code: "TW_QUOTE_UNIVERSE_INCOMPLETE",
          details: { dataDate: source?.dataDate || null, sources: source?.meta?.sources || null }
        }
      );
    }


    return {

      rows,

      dataDate:
        source
          ?.dataDate ||
        null,

      updatedAt:
        source
          ?.updatedAt ||
        null,

      meta:
        source
          ?.meta ||
        {}

    };

  } catch (
    error
  ) {

    if (
      error instanceof
      TWQuoteProviderError
    ) {

      throw error;
    }


    throw new TWQuoteProviderError(
      "Unable to load Taiwan quote universe.",
      {
        code:
          "TW_QUOTE_UNIVERSE_ERROR",

        cause:
          error
      }
    );
  }
}


/* ========================================================================== */
/* Normalize quote                                                            */
/* ========================================================================== */

function normalizeQuote(
  row,
  source
) {

  if (
    !row ||
    typeof row !==
      "object"
  ) {

    return null;
  }


  const symbol =
    String(
      row.symbol ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !symbol
  ) {

    return null;
  }


  return Object.freeze({

    symbol,

    name:
      String(
        row.name ||
        ""
      ).trim(),

    market:
      String(
        row.market ||
        ""
      )
        .trim()
        .toUpperCase(),

    industry:
      String(
        row.industry ||
        ""
      ).trim(),

    theme:
      String(
        row.theme ||
        ""
      ).trim(),


    /*
     * Latest official daily snapshot.
     */
    price:
      finiteNumber(
        row.price
      ),

    close:
      finiteNumber(
        row.price
      ),

    changePct:
      finiteNumber(
        row.changePct
      ),

    volume:
      finiteNumber(
        row.volume
      ),

    turnoverTwd:
      finiteNumber(
        row.turnoverTwd
      ),


    /*
     * Current Radar intelligence.
     *
     * These are OX-derived fields,
     * not raw exchange fields.
     */
    oxScore:
      finiteNumber(
        row.oxScore
      ),

    tier:
      String(
        row.tier ||
        ""
      )
        .trim()
        .toUpperCase(),

    setup:
      String(
        row.setup ||
        ""
      ).trim(),


    /*
     * Historical / intraday OHLC fields
     * have not been connected here yet.
     *
     * Do not manufacture values.
     */
    open:
      null,

    high:
      null,

    low:
      null,

    previousClose:
      null,


    /*
     * Quote freshness.
     */
    dataDate:
      source
        ?.dataDate ||
      row.updatedAt ||
      null,

    updatedAt:
      source
        ?.updatedAt ||
      null,

    realtime:
      false,

    source:
      "official-tw-daily-snapshot",

    universeSource:
      source
        ?.meta
        ?.universeSource ||
      "official-tw-live"

  });
}


/* ========================================================================== */
/* Index                                                                      */
/* ========================================================================== */

function buildQuoteIndex(
  rows,
  source
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const quote =
      normalizeQuote(
        row,
        source
      );


    if (
      !quote
    ) {

      continue;
    }


    map.set(
      quote.symbol,
      quote
    );
  }


  return map;
}


/* ========================================================================== */
/* Single quote                                                               */
/* ========================================================================== */

export async function getOfficialTWQuote(
  symbol,
  { progress = {} } = {}
) {

  const requestedSymbol =
    normalizeSymbol(
      symbol
    );


  const source =
    await loadQuoteUniverse(progress);


  // A parsed snapshot universe is reused for a minute; index it once.
  const index =
    source.index ||= buildQuoteIndex(
      source.rows,
      source
    );


  const quote =
    index.get(
      requestedSymbol
    );


  if (
    !quote
  ) {

    throw new TWQuoteProviderError(
      `Taiwan stock ${requestedSymbol} was not found.`,
      {
        code:
          "TW_QUOTE_NOT_FOUND",

        symbol:
          requestedSymbol
      }
    );
  }


  return quote;
}


/* ========================================================================== */
/* Multiple quotes                                                            */
/* ========================================================================== */

export async function getOfficialTWQuotes(
  symbols
) {

  const requestedSymbols =
    normalizeSymbols(
      symbols
    );


  const source =
    await loadQuoteUniverse();


  const index =
    source.index ||= buildQuoteIndex(
      source.rows,
      source
    );


  const quotes =
    [];


  const missing =
    [];


  /*
   * Preserve request order.
   */
  for (
    const symbol
    of requestedSymbols
  ) {

    const quote =
      index.get(
        symbol
      );


    if (
      quote
    ) {

      quotes.push(
        quote
      );

    } else {

      missing.push(
        symbol
      );
    }
  }


  return Object.freeze({

    quotes:
      Object.freeze(
        quotes
      ),

    missing:
      Object.freeze(
        missing
      ),

    requested:
      requestedSymbols.length,

    returned:
      quotes.length,

    dataDate:
      source.dataDate,

    updatedAt:
      source.updatedAt,

    meta:
      Object.freeze({

        provider:
          "official-tw",

        source:
          "radar-universe",

        realtime:
          false,

        snapshot:
          "daily",

        requested:
          requestedSymbols.length,

        returned:
          quotes.length,

        missing:
          missing.length

      })

  });
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWQuoteProvider =
  Object.freeze({

    id:
      "official-tw-quotes",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getQuote:
      getOfficialTWQuote,

    getQuotes:
      getOfficialTWQuotes

  });
