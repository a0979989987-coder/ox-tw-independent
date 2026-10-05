/*
 * OX v4.0 Modular
 * Taiwan Market Breadth Provider
 *
 * Official sources:
 *
 * TWSE
 * - MI_INDEX
 * - twtazu_od fallback
 *
 * TPEx
 * - tpex_mainborad_highlight
 *
 *
 * Provides:
 *
 * - Advancers
 * - Decliners
 * - Unchanged
 * - Limit up
 * - Limit down
 *
 *
 * IMPORTANT:
 *
 * - Backend only.
 * - No API secret.
 * - Never manufacture market data.
 * - Missing values stay null.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const TWSE_MI_INDEX =
  "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";


const TWSE_BREADTH_OPENAPI =
  "https://openapi.twse.com.tw/v1/opendata/twtazu_od";


const TPEX_HIGHLIGHT =
  "https://www.tpex.org.tw/openapi/v1/tpex_mainborad_highlight";


const DEFAULT_TIMEOUT_MS =
  12000;


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWBreadthProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_BREADTH_ERROR",

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
      "TWBreadthProviderError";


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
/* Helpers                                                                    */
/* ========================================================================== */

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
      );


  if (
    !cleaned ||
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


function clampNonNegative(
  value
) {

  const number =
    numberValue(
      value
    );


  if (
    number ===
    null
  ) {

    return null;
  }


  return Math.max(
    0,
    number
  );
}


/* ========================================================================== */
/* Taiwan date                                                                */
/* ========================================================================== */

function taipeiToday() {

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Taipei",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    );


  const parts =
    formatter.formatToParts(
      new Date()
    );


  const map =
    {};


  parts.forEach(
    part => {

      map[
        part.type
      ] =
        part.value;

    }
  );


  return `${
    map.year
  }-${
    map.month
  }-${
    map.day
  }`;
}


function compactDate(
  isoDate
) {

  return String(
    isoDate ||
    ""
  ).replace(
    /-/g,
    ""
  );
}


function previousDate(
  isoDate,
  days
) {

  const [
    year,
    month,
    day
  ] =
    isoDate
      .split(
        "-"
      )
      .map(
        Number
      );


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  date.setUTCDate(
    date.getUTCDate() -
    days
  );


  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function rocDateToISO(
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


  const compact =
    raw.match(
      /^(\d{3})(\d{2})(\d{2})$/
    );


  if (
    compact
  ) {

    return `${
      Number(
        compact[1]
      ) +
      1911
    }-${compact[2]}-${compact[3]}`;
  }


  const slash =
    raw.match(
      /^(\d{2,3})\/(\d{2})\/(\d{2})$/
    );


  if (
    slash
  ) {

    return `${
      Number(
        slash[1]
      ) +
      1911
    }-${slash[2]}-${slash[3]}`;
  }


  if (
    /^\d{4}-\d{2}-\d{2}$/
      .test(
        raw
      )
  ) {

    return raw;
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
      DEFAULT_TIMEOUT_MS,

    noCache =
      false
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

    const headers =
      {

        Accept:
          "application/json",

        "User-Agent":
          "Mozilla/5.0 OX-Market-Command-Center"

      };


    if (
      noCache
    ) {

      headers[
        "Cache-Control"
      ] =
        "no-cache";


      headers.Pragma =
        "no-cache";


      headers[
        "If-Modified-Since"
      ] =
        "Mon, 26 Jul 1997 05:00:00 GMT";
    }


    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers,

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

      throw new TWBreadthProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_BREADTH_HTTP_ERROR",

          source,

          status:
            response.status
        }
      );
    }


    if (
      !text
    ) {

      throw new TWBreadthProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_BREADTH_EMPTY",

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

      throw new TWBreadthProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_BREADTH_INVALID_JSON",

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
      TWBreadthProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWBreadthProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_BREADTH_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWBreadthProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_BREADTH_NETWORK_ERROR",

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
/* TWSE MI_INDEX parser                                                       */
/* ========================================================================== */

function parseCountPair(
  value
) {

  const text =
    textValue(
      value
    );


  const match =
    text.match(
      /([\d,]+)\s*\(\s*([\d,]+)\s*\)/
    );


  if (
    !match
  ) {

    return {

      count:
        numberValue(
          text
        ),

      limit:
        null

    };
  }


  return {

    count:
      numberValue(
        match[1]
      ),

    limit:
      numberValue(
        match[2]
      )

  };
}


function findBreadthRow(
  rows,
  prefix
) {

  return rows.find(
    row =>
      Array.isArray(
        row
      ) &&
      textValue(
        row[0]
      ).startsWith(
        prefix
      )
  );
}


function normalizeTwseMiIndex(
  payload,
  requestedDate
) {

  if (
    !payload ||
    !Array.isArray(
      payload.tables
    )
  ) {

    return null;
  }


  const table =
    payload.tables.find(
      item =>
        textValue(
          item?.title
        ).includes(
          "漲跌證券數合計"
        )
    );


  if (
    !table ||
    !Array.isArray(
      table.data
    )
  ) {

    return null;
  }


  const fields =
    Array.isArray(
      table.fields
    )
      ? table.fields
      : [];


  let stockIndex =
    fields.findIndex(
      field =>
        textValue(
          field
        ) ===
        "股票"
    );


  if (
    stockIndex <
    0
  ) {

    stockIndex =
      2;
  }


  const upRow =
    findBreadthRow(
      table.data,
      "上漲"
    );


  const downRow =
    findBreadthRow(
      table.data,
      "下跌"
    );


  const flatRow =
    findBreadthRow(
      table.data,
      "持平"
    );


  const untradedRow =
    findBreadthRow(
      table.data,
      "未成交"
    );


  const noComparisonRow =
    findBreadthRow(
      table.data,
      "無比價"
    );


  if (
    !upRow ||
    !downRow
  ) {

    return null;
  }


  const up =
    parseCountPair(
      upRow[
        stockIndex
      ]
    );


  const down =
    parseCountPair(
      downRow[
        stockIndex
      ]
    );


  const unchanged =
    flatRow
      ? numberValue(
          flatRow[
            stockIndex
          ]
        )
      : null;


  const untraded =
    untradedRow
      ? numberValue(
          untradedRow[
            stockIndex
          ]
        )
      : null;


  const noComparison =
    noComparisonRow
      ? numberValue(
          noComparisonRow[
            stockIndex
          ]
        )
      : null;


  const total =
    [
      up.count,
      down.count,
      unchanged,
      untraded,
      noComparison
    ]
      .filter(
        value =>
          value !==
          null
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      );


  return Object.freeze({

    market:
      "TWSE",

    advancers:
      up.count,

    decliners:
      down.count,

    unchanged,

    limitUp:
      up.limit,

    limitDown:
      down.limit,

    untraded,

    noComparison,

    total:
      total ||
      null,

    dataDate:
      requestedDate,

    source:
      "TWSE-MI_INDEX"

  });
}


/* ========================================================================== */
/* TWSE primary                                                               */
/* ========================================================================== */

async function getTwseBreadthFromMiIndex() {

  const today =
    taipeiToday();


  /*
   * Search current day and previous
   * calendar days.
   *
   * This handles:
   * - weekends
   * - holidays
   * - after-midnight edge cases
   */
  for (
    let offset =
      0;

    offset <=
      10;

    offset +=
      1
  ) {

    const isoDate =
      previousDate(
        today,
        offset
      );


    const date =
      compactDate(
        isoDate
      );


    const url =
      `${
        TWSE_MI_INDEX
      }?date=${
        date
      }&type=MS&response=json`;


    try {

      const payload =
        await requestJSON(
          url,
          {
            source:
              "TWSE-MI_INDEX"
          }
        );


      const normalized =
        normalizeTwseMiIndex(
          payload,
          isoDate
        );


      if (
        normalized
      ) {

        return normalized;
      }

    } catch (
      error
    ) {

      /*
       * Continue to prior trading day.
       */
    }
  }


  throw new TWBreadthProviderError(
    "Unable to find a recent TWSE breadth trading day.",
    {
      code:
        "TWSE_BREADTH_NO_RECENT_DATA",

      source:
        "TWSE"
    }
  );
}


/* ========================================================================== */
/* TWSE fallback OpenAPI                                                      */
/* ========================================================================== */

function normalizeTwseOpenApi(
  payload
) {

  if (
    !Array.isArray(
      payload
    )
  ) {

    return null;
  }


  const row =
    payload.find(
      item =>
        textValue(
          item?.類型
        ) ===
        "股票"
    );


  if (
    !row
  ) {

    return null;
  }


  const advancers =
    numberValue(
      row.上漲
    );


  const decliners =
    numberValue(
      row.下跌
    );


  const unchanged =
    numberValue(
      row.持平
    );


  const untraded =
    numberValue(
      row.未成交
    );


  const noComparison =
    numberValue(
      row.無比價
    );


  const total =
    [
      advancers,
      decliners,
      unchanged,
      untraded,
      noComparison
    ]
      .filter(
        value =>
          value !==
          null
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      );


  return Object.freeze({

    market:
      "TWSE",

    advancers,

    decliners,

    unchanged,

    limitUp:
      numberValue(
        row.漲停
      ),

    limitDown:
      numberValue(
        row.跌停
      ),

    untraded,

    noComparison,

    total:
      total ||
      null,

    dataDate:
      rocDateToISO(
        row.出表日期
      ),

    source:
      "TWSE-OPENAPI"

  });
}


async function getTwseBreadth() {

  try {

    return await getTwseBreadthFromMiIndex();

  } catch (
    primaryError
  ) {

    const payload =
      await requestJSON(
        TWSE_BREADTH_OPENAPI,
        {
          source:
            "TWSE-OPENAPI"
        }
      );


    const normalized =
      normalizeTwseOpenApi(
        payload
      );


    if (
      normalized
    ) {

      return normalized;
    }


    throw new TWBreadthProviderError(
      "TWSE breadth could not be normalized.",
      {
        code:
          "TWSE_BREADTH_PARSE_ERROR",

        source:
          "TWSE",

        cause:
          primaryError
      }
    );
  }
}


/* ========================================================================== */
/* TPEx                                                                       */
/* ========================================================================== */

function firstNumber(
  object,
  keys
) {

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
        numberValue(
          object[key]
        );


      if (
        value !==
        null
      ) {

        return value;
      }
    }
  }


  return null;
}


function normalizeTpexHighlight(
  payload
) {

  const rows =
    Array.isArray(
      payload
    )
      ? payload
      : [];


  if (
    !rows.length
  ) {

    return null;
  }


  const row =
    rows[0];


  const advancers =
    firstNumber(
      row,
      [
        "PriceRiseCompanyNumbers",
        "上漲家數"
      ]
    );


  const decliners =
    firstNumber(
      row,
      [
        "PriceDeclineCompanyNumbers",
        "下跌家數"
      ]
    );


  const unchanged =
    firstNumber(
      row,
      [
        "PriceFlatCompanyNumbers",
        "平盤家數"
      ]
    );


  const limitUp =
    firstNumber(
      row,
      [
        "LimitUpCompanyNumbers",
        "漲停家數"
      ]
    );


  const limitDown =
    firstNumber(
      row,
      [
        "LimitDownCompanyNumbers",
        "跌停家數"
      ]
    );


  const total =
    firstNumber(
      row,
      [
        "ListedCompanyNumbers",
        "上櫃家數"
      ]
    );


  let untraded =
    firstNumber(
      row,
      [
        "NoTransactionCompanyNumbers",
        "NoTradingCompanyNumbers",
        "SuspendedCompanyNumbers",
        "未成交含暫停交易家數",
        "未成交家數"
      ]
    );


  if (
    untraded ===
      null &&
    total !==
      null &&
    advancers !==
      null &&
    decliners !==
      null &&
    unchanged !==
      null
  ) {

    untraded =
      clampNonNegative(
        total -
        advancers -
        decliners -
        unchanged
      );
  }


  if (
    advancers ===
      null &&
    decliners ===
      null
  ) {

    return null;
  }


  return Object.freeze({

    market:
      "TPEX",

    advancers,

    decliners,

    unchanged,

    limitUp,

    limitDown,

    untraded,

    noComparison:
      null,

    total,

    dataDate:
      rocDateToISO(
        row.Date ??
        row.資料日期
      ),

    source:
      "TPEX-OPENAPI"

  });
}


async function getTpexBreadth() {

  const payload =
    await requestJSON(
      TPEX_HIGHLIGHT,
      {
        source:
          "TPEX",

        noCache:
          true
      }
    );


  const normalized =
    normalizeTpexHighlight(
      payload
    );


  if (
    !normalized
  ) {

    throw new TWBreadthProviderError(
      "TPEx breadth could not be normalized.",
      {
        code:
          "TPEX_BREADTH_PARSE_ERROR",

        source:
          "TPEX"
      }
    );
  }


  return normalized;
}


/* ========================================================================== */
/* Combine                                                                    */
/* ========================================================================== */

function addNullable(
  values
) {

  const available =
    values.filter(
      value =>
        value !==
        null &&
      value !==
        undefined
    );


  if (
    !available.length
  ) {

    return null;
  }


  return available.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  );
}


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
/* Public API                                                                 */
/* ========================================================================== */

export async function getOfficialTWBreadth() {

  const [
    twseResult,
    tpexResult
  ] =
    await Promise
      .allSettled([

        getTwseBreadth(),

        getTpexBreadth()

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

    throw new TWBreadthProviderError(
      "All Taiwan market breadth sources failed.",
      {
        code:
          "TW_BREADTH_ALL_FAILED",

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


  const breadth =
    Object.freeze({

      advancers:
        addNullable([
          twse?.advancers,
          tpex?.advancers
        ]),

      decliners:
        addNullable([
          twse?.decliners,
          tpex?.decliners
        ]),

      unchanged:
        addNullable([
          twse?.unchanged,
          tpex?.unchanged
        ]),

      limitUp:
        addNullable([
          twse?.limitUp,
          tpex?.limitUp
        ]),

      limitDown:
        addNullable([
          twse?.limitDown,
          tpex?.limitDown
        ]),

      /*
       * These require additional
       * historical / volume engines.
       *
       * Do not manufacture them.
       */
      newHigh20:
        null,

      newLow20:
        null,

      surgeCount:
        null,

      turnoverTwd:
        null

    });


  return Object.freeze({

    breadth,


    markets:
      Object.freeze({

        TWSE:
          twse,

        TPEX:
          tpex

      }),


    updatedAt:
      new Date()
        .toISOString(),


    meta:
      Object.freeze({

        provider:
          "official-tw",

        partial:
          !twse ||
          !tpex,

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

export const officialTWBreadthProvider =
  Object.freeze({

    id:
      "official-tw-breadth",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getBreadth:
      getOfficialTWBreadth

  });
