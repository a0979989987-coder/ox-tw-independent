import {
  getOfficialTWRadar
} from "./radar.js";

import {
  loadPublishedUniverse
} from "./universe-snapshot.js";


/*
 * OX v4.0 Modular
 * Taiwan Symbol Search Provider
 *
 * Search source:
 *
 * Published list first: data/tw-radar.json holds both exchanges' symbols,
 * names and industries for one trading day (see universe-snapshot.js).
 *
 * Live fallback: Official TW Radar universe
 *
 * Supports:
 *
 * - Stock code search
 * - Company name search
 * - Industry search
 * - TWSE / TPEx filter
 *
 *
 * Examples:
 *
 * 2330
 * 台積電
 * 半導體
 *
 *
 * IMPORTANT:
 *
 * - No fake symbols.
 * - No external search service.
 * - Reuse Radar normalized universe.
 */


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWSearchProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_SEARCH_ERROR",

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
      "TWSearchProviderError";


    this.code =
      code;


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
/* Helpers                                                                    */
/* ========================================================================== */

function textValue(
  value
) {

  if (
    value ===
      null ||
    value ===
      undefined
  ) {

    return "";
  }


  return String(
    value
  ).trim();
}


function normalizeMarket(
  value
) {

  const market =
    textValue(
      value
    )
      .toUpperCase();


  if (
    [
      "TWSE",
      "TSE",
      "上市"
    ].includes(
      market
    )
  ) {

    return "TWSE";
  }


  if (
    [
      "TPEX",
      "OTC",
      "上櫃"
    ].includes(
      market
    )
  ) {

    return "TPEX";
  }


  return "ALL";
}


function normalizeLimit(
  value,
  fallback =
    20
) {

  const parsed =
    Number(
      value
    );


  if (
    !Number.isFinite(
      parsed
    )
  ) {

    return fallback;
  }


  return Math.max(
    1,
    Math.min(
      100,
      Math.floor(
        parsed
      )
    )
  );
}


/* ========================================================================== */
/* Query normalization                                                        */
/* ========================================================================== */

function normalizeSearchText(
  value
) {

  return textValue(
    value
  )
    .toLowerCase()
    .replace(
      /\s+/g,
      ""
    );
}


/* ========================================================================== */
/* Ranking                                                                    */
/* ========================================================================== */

function getSearchRank(
  row,
  query
) {

  const symbol =
    normalizeSearchText(
      row.symbol
    );


  const name =
    normalizeSearchText(
      row.name
    );


  const industry =
    normalizeSearchText(
      row.industry
    );


  const theme =
    normalizeSearchText(
      row.theme
    );


  /*
   * Exact stock code.
   */
  if (
    symbol ===
      query
  ) {

    return 0;
  }


  /*
   * Code starts with query.
   */
  if (
    symbol.startsWith(
      query
    )
  ) {

    return 1;
  }


  /*
   * Exact company name.
   */
  if (
    name ===
      query
  ) {

    return 2;
  }


  /*
   * Company name starts with query.
   */
  if (
    name.startsWith(
      query
    )
  ) {

    return 3;
  }


  /*
   * Code contains query.
   */
  if (
    symbol.includes(
      query
    )
  ) {

    return 4;
  }


  /*
   * Company name contains query.
   */
  if (
    name.includes(
      query
    )
  ) {

    return 5;
  }


  /*
   * Industry / theme search.
   */
  if (
    industry.includes(
      query
    ) ||
    theme.includes(
      query
    )
  ) {

    return 6;
  }


  return null;
}


/* ========================================================================== */
/* Normalize output                                                           */
/* ========================================================================== */

function normalizeSearchResult(
  row
) {

  return Object.freeze({

    symbol:
      textValue(
        row.symbol
      ),

    name:
      textValue(
        row.name
      ),

    market:
      textValue(
        row.market
      )
        .toUpperCase(),

    industry:
      textValue(
        row.industry
      ),

    theme:
      textValue(
        row.theme
      ),

    price:
      row.price ??
      null,

    changePct:
      row.changePct ??
      null,

    turnoverTwd:
      row.turnoverTwd ??
      null,

    oxScore:
      row.oxScore ??
      null,

    tier:
      textValue(
        row.tier
      )
        .toUpperCase(),

    type:
      "stock",

    updatedAt:
      row.updatedAt ??
      null

  });
}


/* ========================================================================== */
/* Universe                                                                   */
/* ========================================================================== */

// With a valid published list a search makes no official market-list request
// and, in the Worker, loads no K-line pack. The live rebuild runs only when
// that copy is missing, stale, partial or one-market.
async function loadSearchRows(
  requestedMarket
) {

  const published =
    await loadPublishedUniverse();

  if (published) {
    return requestedMarket === "ALL"
      ? published.rows
      : published.rows.filter(row => row?.market === requestedMarket);
  }


  let source;


  try {

    source =
      await getOfficialTWRadar(
        {
          market:
            requestedMarket,

          tier:
            "ALL",

          sort:
            "symbol",

          limit:
            2000
        }
      );

  } catch (
    error
  ) {

    throw new TWSearchProviderError(
      "Unable to load Taiwan symbol search universe.",
      {
        code:
          "TW_SEARCH_UNIVERSE_ERROR",

        cause:
          error
      }
    );
  }


  /*
   * A list without one exchange would silently leave its stocks out of the
   * results. Report the missing source for every market the query covers.
   */
  const sources =
    source?.meta?.sources || {};

  const covered =
    requestedMarket === "ALL"
      ? ["TWSE", "TPEX"]
      : [requestedMarket];

  if (
    covered.some(market => sources[market] !== "ready")
  ) {

    throw new TWSearchProviderError(
      "Taiwan symbol search universe is incomplete.",
      {
        code:
          "TW_SEARCH_UNIVERSE_INCOMPLETE",

        details: {
          dataDate: source?.dataDate || null,
          sources: source?.meta?.sources || null
        }
      }
    );
  }


  return Array.isArray(
    source?.radar
  )
    ? source.radar
    : [];
}


/* ========================================================================== */
/* Search                                                                     */
/* ========================================================================== */

export async function searchOfficialTWSymbols(
  query,
  {
    market =
      "ALL",

    limit =
      20
  } = {}
) {

  const normalizedQuery =
    normalizeSearchText(
      query
    );


  if (
    !normalizedQuery
  ) {

    return Object.freeze([]);
  }


  const requestedMarket =
    normalizeMarket(
      market
    );


  const requestedLimit =
    normalizeLimit(
      limit,
      20
    );


  const rows =
    await loadSearchRows(
      requestedMarket
    );


  if (
    !rows.length
  ) {

    return Object.freeze([]);
  }


  const matched =
    rows
      .map(
        row => {

          const rank =
            getSearchRank(
              row,
              normalizedQuery
            );


          if (
            rank ===
              null
          ) {

            return null;
          }


          return {

            rank,

            row

          };

        }
      )
      .filter(
        Boolean
      );


  matched.sort(
    (
      a,
      b
    ) => {

      if (
        a.rank !==
          b.rank
      ) {

        return a.rank -
          b.rank;
      }


      const scoreA =
        Number(
          a.row
            ?.oxScore
        );


      const scoreB =
        Number(
          b.row
            ?.oxScore
        );


      const validA =
        Number.isFinite(
          scoreA
        );


      const validB =
        Number.isFinite(
          scoreB
        );


      if (
        validA &&
        validB &&
        scoreA !==
          scoreB
      ) {

        return scoreB -
          scoreA;
      }


      return textValue(
        a.row.symbol
      ).localeCompare(
        textValue(
          b.row.symbol
        ),
        "zh-TW"
      );
    }
  );


  return Object.freeze(
    matched
      .slice(
        0,
        requestedLimit
      )
      .map(
        item =>
          normalizeSearchResult(
            item.row
          )
      )
  );
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWSearchProvider =
  Object.freeze({

    id:
      "official-tw-search",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    search:
      searchOfficialTWSymbols

  });
