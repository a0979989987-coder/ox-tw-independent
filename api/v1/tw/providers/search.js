import {
  getOfficialTWRadar
} from "./radar.js";


/*
 * OX v4.0 Modular
 * Taiwan Symbol Search Provider
 *
 * Search source:
 *
 * Official TW Radar universe
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


  const rows =
    Array.isArray(
      source?.radar
    )
      ? source.radar
      : [];


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
