/*
 * OX v4.0 Modular
 * Taiwan Theme / Industry Provider
 *
 * Official sources:
 *
 * TWSE
 * - STOCK_DAY_ALL
 * - t187ap05_L
 *
 * TPEx
 * - tpex_mainboard_daily_close_quotes
 * - mopsfin_t187ap05_O
 *
 *
 * Responsibility:
 *
 * Official stock quotes
 *        +
 * Official industry mapping
 *        ↓
 * OX Taiwan industry rotation
 *
 *
 * Provides:
 *
 * - Industry average change %
 * - Advance count
 * - Decline count
 * - Leader stock
 *
 *
 * IMPORTANT:
 *
 * - flowTwd stays null.
 * - volumeRatio stays null.
 * - Do not call turnover "money flow".
 * - Do not mix TWSE / TPEx trading dates.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const TWSE_QUOTES_URL =
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";


const TPEX_QUOTES_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";


const TWSE_INDUSTRY_URL =
  "https://openapi.twse.com.tw/v1/opendata/t187ap05_L";


const TPEX_INDUSTRY_URL =
  "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O";


const DEFAULT_TIMEOUT_MS =
  15000;


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWThemeProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_THEME_ERROR",

      source =
        "",

      status =
        0,

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
      "TWThemeProviderError";


    this.code =
      code;


    this.source =
      source;


    this.status =
      status;


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
/* Basic helpers                                                              */
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


function numberValue(
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


  if (
    typeof value ===
      "number"
  ) {

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  const cleaned =
    String(
      value
    )
      .trim()
      .replace(
        /,/g,
        ""
      )
      .replace(
        /%/g,
        ""
      )
      .replace(
        /\+/g,
        ""
      );


  if (
    !cleaned ||
    cleaned ===
      "-" ||
    cleaned ===
      "--" ||
    cleaned ===
      "---" ||
    cleaned ===
      "N/A"
  ) {

    return null;
  }


  const parsed =
    Number(
      cleaned
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function pick(
  object,
  keys
) {

  if (
    !object ||
    typeof object !==
      "object"
  ) {

    return undefined;
  }


  for (
    const key
    of keys
  ) {

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          object,
          key
        )
    ) {

      const value =
        object[key];


      if (
        value !==
          undefined &&
        value !==
          null &&
        value !==
          ""
      ) {

        return value;
      }
    }
  }


  return undefined;
}


function clampLimit(
  value,
  fallback =
    30
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
/* Date                                                                       */
/* ========================================================================== */

function normalizeDate(
  value
) {

  const raw =
    textValue(
      value
    );


  if (
    !raw
  ) {

    return null;
  }


  const digits =
    raw.replace(
      /\D/g,
      ""
    );


  /*
   * Gregorian YYYYMMDD
   */
  if (
    digits.length ===
      8
  ) {

    return `${
      digits.slice(
        0,
        4
      )
    }-${
      digits.slice(
        4,
        6
      )
    }-${
      digits.slice(
        6,
        8
      )
    }`;
  }


  /*
   * ROC YYYMMDD
   */
  if (
    digits.length ===
      7
  ) {

    const year =
      Number(
        digits.slice(
          0,
          3
        )
      ) +
      1911;


    return `${
      year
    }-${
      digits.slice(
        3,
        5
      )
    }-${
      digits.slice(
        5,
        7
      )
    }`;
  }


  return null;
}


/* ========================================================================== */
/* HTTP                                                                       */
/* ========================================================================== */

async function requestJSON(
  url,
  {
    source =
      "official",

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {

        controller.abort();

      },
      Math.max(
        1000,
        timeoutMs
      )
    );


  try {

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "Mozilla/5.0 OX-Market-Command-Center"

          },

          cache:
            "no-store",

          signal:
            controller.signal
        }
      );


    const text =
      await response.text();


    if (
      !response.ok
    ) {

      throw new TWThemeProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_THEME_HTTP_ERROR",

          source,

          status:
            response.status
        }
      );
    }


    if (
      !text
    ) {

      throw new TWThemeProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_THEME_EMPTY_RESPONSE",

          source
        }
      );
    }


    try {

      return JSON.parse(
        text
      );

    } catch (
      error
    ) {

      throw new TWThemeProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_THEME_INVALID_JSON",

          source,

          cause:
            error
        }
      );
    }

  } catch (
    error
  ) {

    if (
      error instanceof
      TWThemeProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWThemeProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_THEME_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWThemeProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_THEME_NETWORK_ERROR",

        source,

        cause:
          error
      }
    );

  } finally {

    clearTimeout(
      timer
    );
  }
}


/* ========================================================================== */
/* Industry mapping                                                           */
/* ========================================================================== */

function normalizeIndustry(
  value
) {

  const industry =
    textValue(
      value
    );


  if (
    !industry
  ) {

    return "";
  }


  /*
   * Reject pure numeric industry codes.
   *
   * OX wants readable user-facing
   * industry names.
   */
  if (
    /^\d+$/
      .test(
        industry
      )
  ) {

    return "";
  }


  return industry;
}


function buildIndustryMap(
  payload,
  market
) {

  if (
    !Array.isArray(
      payload
    )
  ) {

    return new Map();
  }


  const result =
    new Map();


  for (
    const row
    of payload
  ) {

    if (
      !row ||
      typeof row !==
        "object"
    ) {

      continue;
    }


    const symbol =
      textValue(
        pick(
          row,
          [
            "公司代號",
            "SecuritiesCompanyCode",
            "CompanyCode",
            "Code"
          ]
        )
      );


    const industry =
      normalizeIndustry(
        pick(
          row,
          [
            "產業別",
            "Industry",
            "IndustryCategory",
            "產業類別"
          ]
        )
      );


    const companyName =
      textValue(
        pick(
          row,
          [
            "公司名稱",
            "CompanyName",
            "公司簡稱",
            "CompanyAbbreviation"
          ]
        )
      );


    if (
      !symbol ||
      !industry
    ) {

      continue;
    }


    result.set(
      symbol,
      Object.freeze({

        symbol,

        companyName,

        industry,

        market

      })
    );
  }


  return result;
}


/* ========================================================================== */
/* Quote normalize                                                            */
/* ========================================================================== */

function calculateChangePct(
  close,
  change
) {

  if (
    close ===
      null ||
    change ===
      null
  ) {

    return null;
  }


  const previousClose =
    close -
    change;


  if (
    !Number.isFinite(
      previousClose
    ) ||
    previousClose <=
      0
  ) {

    return null;
  }


  return (
    change /
    previousClose
  ) *
    100;
}


function normalizeTwseQuote(
  row,
  industryMap
) {

  const symbol =
    textValue(
      pick(
        row,
        [
          "Code",
          "證券代號"
        ]
      )
    );


  const industryInfo =
    industryMap.get(
      symbol
    );


  if (
    !industryInfo
  ) {

    return null;
  }


  const close =
    numberValue(
      pick(
        row,
        [
          "ClosingPrice",
          "收盤價"
        ]
      )
    );


  const change =
    numberValue(
      pick(
        row,
        [
          "Change",
          "漲跌價差"
        ]
      )
    );


  if (
    close ===
      null ||
    close <=
      0
  ) {

    return null;
  }


  const name =
    textValue(
      pick(
        row,
        [
          "Name",
          "證券名稱"
        ]
      )
    ) ||
    industryInfo
      .companyName;


  return Object.freeze({

    symbol,

    name,

    market:
      "TWSE",

    industry:
      industryInfo
        .industry,

    close,

    change,

    changePct:
      calculateChangePct(
        close,
        change
      ),

    turnoverTwd:
      numberValue(
        pick(
          row,
          [
            "TradeValue",
            "成交金額"
          ]
        )
      ),

    dataDate:
      normalizeDate(
        pick(
          row,
          [
            "Date",
            "日期"
          ]
        )
      )

  });
}


function normalizeTpexQuote(
  row,
  industryMap
) {

  const symbol =
    textValue(
      pick(
        row,
        [
          "SecuritiesCompanyCode",
          "Code",
          "證券代號"
        ]
      )
    );


  const industryInfo =
    industryMap.get(
      symbol
    );


  if (
    !industryInfo
  ) {

    return null;
  }


  const close =
    numberValue(
      pick(
        row,
        [
          "Close",
          "收盤價"
        ]
      )
    );


  const change =
    numberValue(
      pick(
        row,
        [
          "Change",
          "漲跌"
        ]
      )
    );


  if (
    close ===
      null ||
    close <=
      0
  ) {

    return null;
  }


  const name =
    textValue(
      pick(
        row,
        [
          "CompanyName",
          "Name",
          "公司名稱"
        ]
      )
    ) ||
    industryInfo
      .companyName;


  return Object.freeze({

    symbol,

    name,

    market:
      "TPEX",

    industry:
      industryInfo
        .industry,

    close,

    change,

    changePct:
      calculateChangePct(
        close,
        change
      ),

    turnoverTwd:
      numberValue(
        pick(
          row,
          [
            "TransactionAmount",
            "TradingValue",
            "TradeValue",
            "成交金額",
            "成交值"
          ]
        )
      ),

    dataDate:
      normalizeDate(
        pick(
          row,
          [
            "Date",
            "日期"
          ]
        )
      )

  });
}


/* ========================================================================== */
/* Latest trading day                                                         */
/* ========================================================================== */

function latestDate(
  rows
) {

  const dates =
    rows
      .map(
        row =>
          row?.dataDate ||
          null
      )
      .filter(
        Boolean
      )
      .sort();


  if (
    !dates.length
  ) {

    return null;
  }


  return dates[
    dates.length -
    1
  ];
}


function keepLatestDate(
  rows
) {

  const date =
    latestDate(
      rows
    );


  if (
    !date
  ) {

    return {

      dataDate:
        null,

      rows

    };
  }


  return {

    dataDate:
      date,

    rows:
      rows.filter(
        row =>
          row.dataDate ===
          date
      )

  };
}


/* ========================================================================== */
/* Market loaders                                                             */
/* ========================================================================== */

async function loadTwseThemeRows() {

  const [
    quotePayload,
    industryPayload
  ] =
    await Promise.all([

      requestJSON(
        TWSE_QUOTES_URL,
        {
          source:
            "TWSE-STOCK-DAY-ALL"
        }
      ),

      requestJSON(
        TWSE_INDUSTRY_URL,
        {
          source:
            "TWSE-INDUSTRY"
        }
      )

    ]);


  if (
    !Array.isArray(
      quotePayload
    )
  ) {

    throw new TWThemeProviderError(
      "TWSE quote payload is not an array.",
      {
        code:
          "TWSE_THEME_QUOTES_INVALID",

        source:
          "TWSE"
      }
    );
  }


  const industryMap =
    buildIndustryMap(
      industryPayload,
      "TWSE"
    );


  const rows =
    quotePayload
      .map(
        row =>
          normalizeTwseQuote(
            row,
            industryMap
          )
      )
      .filter(
        Boolean
      );


  const latest =
    keepLatestDate(
      rows
    );


  if (
    !latest.rows.length
  ) {

    throw new TWThemeProviderError(
      "TWSE returned no usable industry quote rows.",
      {
        code:
          "TWSE_THEME_EMPTY",

        source:
          "TWSE"
      }
    );
  }


  return Object.freeze({

    market:
      "TWSE",

    dataDate:
      latest.dataDate,

    rows:
      Object.freeze(
        latest.rows
      )

  });
}


async function loadTpexThemeRows() {

  const [
    quotePayload,
    industryPayload
  ] =
    await Promise.all([

      requestJSON(
        TPEX_QUOTES_URL,
        {
          source:
            "TPEX-DAILY-QUOTES"
        }
      ),

      requestJSON(
        TPEX_INDUSTRY_URL,
        {
          source:
            "TPEX-INDUSTRY"
        }
      )

    ]);


  if (
    !Array.isArray(
      quotePayload
    )
  ) {

    throw new TWThemeProviderError(
      "TPEx quote payload is not an array.",
      {
        code:
          "TPEX_THEME_QUOTES_INVALID",

        source:
          "TPEX"
      }
    );
  }


  const industryMap =
    buildIndustryMap(
      industryPayload,
      "TPEX"
    );


  const rows =
    quotePayload
      .map(
        row =>
          normalizeTpexQuote(
            row,
            industryMap
          )
      )
      .filter(
        Boolean
      );


  const latest =
    keepLatestDate(
      rows
    );


  if (
    !latest.rows.length
  ) {

    throw new TWThemeProviderError(
      "TPEx returned no usable industry quote rows.",
      {
        code:
          "TPEX_THEME_EMPTY",

        source:
          "TPEX"
      }
    );
  }


  return Object.freeze({

    market:
      "TPEX",

    dataDate:
      latest.dataDate,

    rows:
      Object.freeze(
        latest.rows
      )

  });
}


/* ========================================================================== */
/* Aggregation                                                                */
/* ========================================================================== */

function createBucket(
  name
) {

  return {

    name,

    stocks:
      0,

    changeSum:
      0,

    changeCount:
      0,

    advanceCount:
      0,

    declineCount:
      0,

    unchangedCount:
      0,

    turnoverTwd:
      0,

    hasTurnover:
      false,

    leader:
      null

  };
}


function betterLeader(
  current,
  candidate
) {

  if (
    !candidate ||
    candidate.changePct ===
      null
  ) {

    return current;
  }


  if (
    !current
  ) {

    return candidate;
  }


  if (
    candidate.changePct >
    current.changePct
  ) {

    return candidate;
  }


  if (
    candidate.changePct <
    current.changePct
  ) {

    return current;
  }


  const candidateTurnover =
    candidate.turnoverTwd ??
    0;


  const currentTurnover =
    current.turnoverTwd ??
    0;


  return candidateTurnover >
    currentTurnover
      ? candidate
      : current;
}


function aggregateThemes(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !row?.industry
    ) {

      continue;
    }


    if (
      !map.has(
        row.industry
      )
    ) {

      map.set(
        row.industry,
        createBucket(
          row.industry
        )
      );
    }


    const bucket =
      map.get(
        row.industry
      );


    bucket.stocks +=
      1;


    if (
      row.changePct !==
      null
    ) {

      bucket.changeSum +=
        row.changePct;


      bucket.changeCount +=
        1;


      if (
        row.changePct >
        0
      ) {

        bucket.advanceCount +=
          1;

      } else if (
        row.changePct <
        0
      ) {

        bucket.declineCount +=
          1;

      } else {

        bucket.unchangedCount +=
          1;
      }
    }


    if (
      row.turnoverTwd !==
      null
    ) {

      bucket.turnoverTwd +=
        row.turnoverTwd;


      bucket.hasTurnover =
        true;
    }


    bucket.leader =
      betterLeader(
        bucket.leader,
        row
      );
  }


  return [
    ...map.values()
  ]
    .filter(
      bucket =>
        bucket.changeCount >=
        2
    )
    .map(
      bucket => {

        const averageChangePct =
          bucket.changeCount
            ? bucket.changeSum /
              bucket.changeCount
            : null;


        return Object.freeze({

          name:
            bucket.name,

          changePct:
            averageChangePct,

          /*
           * Real institutional / cash
           * flow by industry is not
           * connected yet.
           */
          flowTwd:
            null,

          /*
           * Requires historical turnover.
           */
          volumeRatio:
            null,

          advanceCount:
            bucket.advanceCount,

          declineCount:
            bucket.declineCount,

          unchangedCount:
            bucket.unchangedCount,

          leaderSymbol:
            bucket.leader
              ?.symbol ||
            "",

          leaderName:
            bucket.leader
              ?.name ||
            "",

          /*
           * Internal diagnostic /
           * future ranking field.
           *
           * Frontend does not treat this
           * as net money flow.
           */
          turnoverTwd:
            bucket.hasTurnover
              ? bucket.turnoverTwd
              : null,

          stockCount:
            bucket.stocks

        });

      }
    )
    .sort(
      (
        a,
        b
      ) => {

        const changeA =
          a.changePct ??
          -Infinity;


        const changeB =
          b.changePct ??
          -Infinity;


        if (
          changeB !==
          changeA
        ) {

          return changeB -
            changeA;
        }


        return (
          b.turnoverTwd ??
          0
        ) -
        (
          a.turnoverTwd ??
          0
        );
      }
    );
}


/* ========================================================================== */
/* Error summary                                                              */
/* ========================================================================== */

function errorSummary(
  result
) {

  if (
    result.status ===
      "fulfilled"
  ) {

    return null;
  }


  return Object.freeze({

    code:
      result.reason
        ?.code ||
      "UNKNOWN",

    source:
      result.reason
        ?.source ||
      "",

    message:
      result.reason
        ?.message ||
      "Unknown provider error"

  });
}


/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

export async function getOfficialTWThemes(
  {
    limit =
      30
  } = {}
) {

  const normalizedLimit =
    clampLimit(
      limit,
      30
    );


  const [
    twseResult,
    tpexResult
  ] =
    await Promise
      .allSettled([

        loadTwseThemeRows(),

        loadTpexThemeRows()

      ]);


  const twse =
    twseResult.status ===
      "fulfilled"
      ? twseResult.value
      : null;


  const tpex =
    tpexResult.status ===
      "fulfilled"
      ? tpexResult.value
      : null;


  if (
    !twse &&
    !tpex
  ) {

    throw new TWThemeProviderError(
      "All Taiwan theme sources failed.",
      {
        code:
          "TW_THEME_ALL_FAILED",

        source:
          "official-tw",

        details: {

          TWSE:
            errorSummary(
              twseResult
            ),

          TPEX:
            errorSummary(
              tpexResult
            )

        }
      }
    );
  }


  /*
   * If both exchanges are available,
   * their latest trading date MUST match.
   *
   * Never build a fake mixed-day
   * Taiwan industry ranking.
   */
  if (
    twse &&
    tpex &&
    twse.dataDate &&
    tpex.dataDate &&
    twse.dataDate !==
      tpex.dataDate
  ) {

    throw new TWThemeProviderError(
      "TWSE and TPEx theme data dates do not match.",
      {
        code:
          "TW_THEME_DATE_MISMATCH",

        source:
          "official-tw",

        details: {

          TWSE:
            twse.dataDate,

          TPEX:
            tpex.dataDate

        }
      }
    );
  }


  const rows =
    [

      ...(
        twse
          ? twse.rows
          : []
      ),

      ...(
        tpex
          ? tpex.rows
          : []
      )

    ];


  const themes =
    aggregateThemes(
      rows
    )
      .slice(
        0,
        normalizedLimit
      );


  if (
    !themes.length
  ) {

    throw new TWThemeProviderError(
      "No Taiwan industry groups could be calculated.",
      {
        code:
          "TW_THEME_NO_GROUPS",

        source:
          "official-tw"
      }
    );
  }


  return Object.freeze({

    themes:
      Object.freeze(
        themes
      ),


    dataDate:
      twse
        ?.dataDate ||
      tpex
        ?.dataDate ||
      null,


    updatedAt:
      new Date()
        .toISOString(),


    meta:
      Object.freeze({

        provider:
          "official-tw",

        methodology:
          "official-industry-constituent-average",

        partial:
          !twse ||
          !tpex,

        flowConnected:
          false,

        historicalVolumeConnected:
          false,

        sources:
          Object.freeze({

            TWSE:
              twse
                ? "ready"
                : "error",

            TPEX:
              tpex
                ? "ready"
                : "error"

          }),

        rows:
          Object.freeze({

            TWSE:
              twse
                ?.rows
                ?.length ||
              0,

            TPEX:
              tpex
                ?.rows
                ?.length ||
              0

          }),

        errors:
          Object.freeze({

            TWSE:
              errorSummary(
                twseResult
              ),

            TPEX:
              errorSummary(
                tpexResult
              )

          })

      })

  });
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWThemeProvider =
  Object.freeze({

    id:
      "official-tw-themes",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getThemes:
      getOfficialTWThemes

  });
