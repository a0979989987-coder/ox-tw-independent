/*
 * OX v4.0 Modular
 * Taiwan Official Market Provider
 *
 * Backend-only data adapter.
 *
 * Data sources:
 *
 * TWSE
 * - TAIEX historical / latest trading-day index
 *
 * TPEx
 * - OTC market daily index / market highlight
 *
 *
 * Responsibility:
 *
 * Official TW market sources
 *          ↓
 * This adapter
 *          ↓
 * OX normalized backend payload
 *          ↓
 * api/v1/tw/[endpoint].js
 *          ↓
 * TW Provider
 *          ↓
 * TW Engine
 *
 *
 * IMPORTANT:
 *
 * - No API secrets are required here.
 * - Never manufacture market values.
 * - Missing data stays null.
 * - TX futures are NOT included yet.
 */


/* ========================================================================== */
/* Source URLs                                                                */
/* ========================================================================== */

const TWSE_WEB_BASE =
  "https://www.twse.com.tw/rwd/zh";


const TPEX_OPENAPI_BASE =
  "https://www.tpex.org.tw/openapi/v1";


const DEFAULT_TIMEOUT_MS =
  12000;


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWOfficialProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_OFFICIAL_DATA_ERROR",

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
      "TWOfficialProviderError";


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
/* Generic helpers                                                            */
/* ========================================================================== */

function numberValue(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
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
    value === null ||
    value === undefined
  ) {
    return "";
  }


  return String(
    value
  ).trim();
}


function firstDefined(
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


function firstNumber(
  object,
  keys
) {

  return numberValue(
    firstDefined(
      object,
      keys
    )
  );
}


function firstText(
  object,
  keys
) {

  return textValue(
    firstDefined(
      object,
      keys
    )
  );
}


/* ========================================================================== */
/* Taiwan time                                                                */
/* ========================================================================== */

function getTaipeiDateParts() {

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


  return {

    year:
      Number(
        map.year
      ),

    month:
      Number(
        map.month
      ),

    day:
      Number(
        map.day
      )

  };
}


function currentTaipeiMonthQuery() {

  const {
    year,
    month
  } =
    getTaipeiDateParts();


  return `${
    String(
      year
    ).padStart(
      4,
      "0"
    )
  }${
    String(
      month
    ).padStart(
      2,
      "0"
    )
  }01`;
}


/* ========================================================================== */
/* Date normalize                                                             */
/* ========================================================================== */

function rocDateToISO(
  value
) {

  const text =
    textValue(
      value
    );


  if (
    !text
  ) {
    return null;
  }


  /*
   * Examples:
   *
   * 115/09/23
   * 1150923
   */
  const slashMatch =
    text.match(
      /^(\d{2,3})\/(\d{2})\/(\d{2})$/
    );


  if (
    slashMatch
  ) {

    const year =
      Number(
        slashMatch[1]
      ) +
      1911;


    return `${
      String(
        year
      ).padStart(
        4,
        "0"
      )
    }-${slashMatch[2]}-${slashMatch[3]}`;
  }


  const compactMatch =
    text.match(
      /^(\d{3})(\d{2})(\d{2})$/
    );


  if (
    compactMatch
  ) {

    const year =
      Number(
        compactMatch[1]
      ) +
      1911;


    return `${
      String(
        year
      ).padStart(
        4,
        "0"
      )
    }-${compactMatch[2]}-${compactMatch[3]}`;
  }


  /*
   * Already Gregorian.
   */
  if (
    /^\d{4}-\d{2}-\d{2}$/
      .test(
        text
      )
  ) {

    return text;
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
              "application/json"
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

      throw new TWOfficialProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_OFFICIAL_HTTP_ERROR",

          source,

          status:
            response.status,

          details:
            text.slice(
              0,
              300
            )
        }
      );
    }


    if (
      !text
    ) {

      throw new TWOfficialProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_OFFICIAL_EMPTY_RESPONSE",

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

      throw new TWOfficialProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_OFFICIAL_INVALID_JSON",

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
      TWOfficialProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWOfficialProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_OFFICIAL_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWOfficialProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_OFFICIAL_NETWORK_ERROR",

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
/* TWSE TAIEX                                                                 */
/* ========================================================================== */

function normalizeTAIEXRows(
  payload
) {

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {

    return [];
  }


  if (
    payload.stat &&
    payload.stat !==
      "OK"
  ) {

    return [];
  }


  const rows =
    Array.isArray(
      payload.data
    )
      ? payload.data
      : [];


  return rows
    .map(
      row => {

        if (
          !Array.isArray(
            row
          )
        ) {
          return null;
        }


        return {

          date:
            rocDateToISO(
              row[0]
            ),

          open:
            numberValue(
              row[1]
            ),

          high:
            numberValue(
              row[2]
            ),

          low:
            numberValue(
              row[3]
            ),

          close:
            numberValue(
              row[4]
            )

        };

      }
    )
    .filter(
      item =>
        item &&
        item.close !==
          null
    );
}


async function getTAIEX() {

  const month =
    currentTaipeiMonthQuery();


  const url =
    `${TWSE_WEB_BASE}/TAIEX/MI_5MINS_HIST?date=${month}&response=json`;


  const payload =
    await requestJSON(
      url,
      {
        source:
          "TWSE"
      }
    );


  const rows =
    normalizeTAIEXRows(
      payload
    );


  if (
    !rows.length
  ) {

    throw new TWOfficialProviderError(
      "TWSE returned no TAIEX rows.",
      {
        code:
          "TWSE_TAIEX_EMPTY",

        source:
          "TWSE"
      }
    );
  }


  const latest =
    rows[
      rows.length -
      1
    ];


  const previous =
    rows.length >
      1
      ? rows[
          rows.length -
          2
        ]
      : null;


  const change =
    (
      previous?.close !==
        null &&
      previous?.close !==
        undefined
    )
      ? latest.close -
        previous.close
      : null;


  const changePct =
    (
      change !==
        null &&
      previous?.close
    )
      ? (
          change /
          previous.close
        ) *
        100
      : null;


  return Object.freeze({

    symbol:
      "TAIEX",

    name:
      "加權指數",

    price:
      latest.close,

    change,

    changePct,

    open:
      latest.open,

    high:
      latest.high,

    low:
      latest.low,

    volume:
      null,

    turnoverTwd:
      null,

    timestamp:
      latest.date,

    source:
      "TWSE"

  });
}


/* ========================================================================== */
/* TPEx                                                                       */
/* ========================================================================== */

function extractRows(
  payload
) {

  if (
    Array.isArray(
      payload
    )
  ) {

    return payload;
  }


  if (
    payload &&
    typeof payload ===
      "object"
  ) {

    for (
      const key
      of [
        "data",
        "items",
        "rows",
        "result"
      ]
    ) {

      if (
        Array.isArray(
          payload[key]
        )
      ) {

        return payload[key];
      }
    }
  }


  return [];
}


function rowLooksLikeTPEXIndex(
  row
) {

  if (
    !row ||
    typeof row !==
      "object"
  ) {

    return false;
  }


  const text =
    Object
      .values(
        row
      )
      .map(
        value =>
          textValue(
            value
          )
      )
      .join(
        " "
      )
      .toUpperCase();


  return (
    text.includes(
      "櫃買指數"
    ) ||
    text.includes(
      "TPEX"
    )
  );
}


function normalizeTPEXRow(
  row
) {

  if (
    !row ||
    typeof row !==
      "object"
  ) {

    return null;
  }


  const price =
    firstNumber(
      row,
      [
        "Index",
        "CloseIndex",
        "ClosingIndex",
        "Close",
        "TPEXIndex",
        "OTCIndex",
        "指數",
        "收盤指數",
        "櫃買指數"
      ]
    );


  const change =
    firstNumber(
      row,
      [
        "Change",
        "IndexChange",
        "ChangePoint",
        "ChangePoints",
        "漲跌",
        "漲跌點數"
      ]
    );


  let changePct =
    firstNumber(
      row,
      [
        "ChangePercent",
        "ChangePct",
        "PercentChange",
        "ChangeRate",
        "幅度(%)",
        "漲跌幅",
        "漲跌百分比"
      ]
    );


  if (
    changePct ===
      null &&
    price !==
      null &&
    change !==
      null
  ) {

    const previous =
      price -
      change;


    if (
      previous !==
        0
    ) {

      changePct =
        (
          change /
          previous
        ) *
        100;
    }
  }


  const turnoverTwd =
    firstNumber(
      row,
      [
        "TransactionAmount",
        "TradingValue",
        "TradingAmount",
        "Turnover",
        "成交金額",
        "成交值",
        "成交金額(元)"
      ]
    );


  const date =
    rocDateToISO(
      firstText(
        row,
        [
          "Date",
          "TradeDate",
          "TradingDate",
          "資料日期",
          "日期"
        ]
      )
    );


  if (
    price ===
    null
  ) {

    return null;
  }


  return Object.freeze({

    symbol:
      "TPEX",

    name:
      "櫃買指數",

    price,

    change,

    changePct,

    open:
      firstNumber(
        row,
        [
          "Open",
          "OpenIndex",
          "開盤指數"
        ]
      ),

    high:
      firstNumber(
        row,
        [
          "High",
          "HighIndex",
          "最高指數"
        ]
      ),

    low:
      firstNumber(
        row,
        [
          "Low",
          "LowIndex",
          "最低指數"
        ]
      ),

    volume:
      firstNumber(
        row,
        [
          "TradingShares",
          "TradingVolume",
          "Volume",
          "成交股數",
          "成交量"
        ]
      ),

    turnoverTwd,

    timestamp:
      date,

    source:
      "TPEx"

  });
}


async function requestTPEXEndpoint(
  endpoint
) {

  return requestJSON(
    `${TPEX_OPENAPI_BASE}/${endpoint}`,
    {
      source:
        `TPEx:${endpoint}`
    }
  );
}


async function getTPEXFromDailyIndex() {

  const payload =
    await requestTPEXEndpoint(
      "tpex_daily_trading_index"
    );


  const rows =
    extractRows(
      payload
    );


  if (
    !rows.length
  ) {

    throw new TWOfficialProviderError(
      "TPEx daily trading index returned no rows.",
      {
        code:
          "TPEX_INDEX_EMPTY",

        source:
          "TPEx"
      }
    );
  }


  /*
   * Prefer an explicitly labelled
   * TPEx index row.
   */
  const preferred =
    [...rows]
      .reverse()
      .find(
        rowLooksLikeTPEXIndex
      );


  if (
    preferred
  ) {

    const normalized =
      normalizeTPEXRow(
        preferred
      );


    if (
      normalized
    ) {
      return normalized;
    }
  }


  /*
   * Otherwise inspect newest rows
   * from the end of the payload.
   */
  for (
    let index =
      rows.length -
      1;

    index >=
      0;

    index -=
      1
  ) {

    const normalized =
      normalizeTPEXRow(
        rows[index]
      );


    if (
      normalized
    ) {

      return normalized;
    }
  }


  throw new TWOfficialProviderError(
    "TPEx index row could not be normalized.",
    {
      code:
        "TPEX_INDEX_PARSE_ERROR",

      source:
        "TPEx"
    }
  );
}


async function getTPEXFromHighlight() {

  const payload =
    await requestTPEXEndpoint(
      "tpex_mainborad_highlight"
    );


  const rows =
    extractRows(
      payload
    );


  if (
    !rows.length
  ) {

    throw new TWOfficialProviderError(
      "TPEx market highlight returned no rows.",
      {
        code:
          "TPEX_HIGHLIGHT_EMPTY",

        source:
          "TPEx"
      }
    );
  }


  const preferred =
    rows.find(
      rowLooksLikeTPEXIndex
    ) ||
    rows[0];


  const normalized =
    normalizeTPEXRow(
      preferred
    );


  if (
    !normalized
  ) {

    throw new TWOfficialProviderError(
      "TPEx market highlight could not be normalized.",
      {
        code:
          "TPEX_HIGHLIGHT_PARSE_ERROR",

        source:
          "TPEx"
      }
    );
  }


  return normalized;
}


async function getTPEX() {

  try {

    return await getTPEXFromDailyIndex();

  } catch (
    primaryError
  ) {

    try {

      return await getTPEXFromHighlight();

    } catch (
      fallbackError
    ) {

      throw new TWOfficialProviderError(
        "Unable to normalize TPEx market index data.",
        {
          code:
            "TPEX_MARKET_PULSE_FAILED",

          source:
            "TPEx",

          details: {

            primary:
              primaryError
                ?.code ||
              primaryError
                ?.message ||
              "unknown",

            fallback:
              fallbackError
                ?.code ||
              fallbackError
                ?.message ||
              "unknown"

          },

          cause:
            fallbackError
        }
      );
    }
  }
}


/* ========================================================================== */
/* Market Pulse                                                               */
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


  return {

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

  };
}


export async function getOfficialTWMarketPulse() {

  const [
    taiexResult,
    tpexResult
  ] =
    await Promise
      .allSettled([

        getTAIEX(),

        getTPEX()

      ]);


  const taiex =
    taiexResult.status ===
      "fulfilled"
      ? taiexResult.value
      : null;


  const tpex =
    tpexResult.status ===
      "fulfilled"
      ? tpexResult.value
      : null;


  const successCount =
    [
      taiex,
      tpex
    ]
      .filter(
        Boolean
      )
      .length;


  if (
    successCount ===
    0
  ) {

    throw new TWOfficialProviderError(
      "All official Taiwan market pulse sources failed.",
      {
        code:
          "TW_MARKET_PULSE_ALL_FAILED",

        source:
          "official",

        details: {

          TWSE:
            errorSummary(
              taiexResult
            ),

          TPEX:
            errorSummary(
              tpexResult
            )

        }
      }
    );
  }


  return Object.freeze({

    /*
     * Session is intentionally null
     * until holiday/calendar handling
     * is connected.
     *
     * We do not want a weekday clock
     * heuristic to report REGULAR
     * during an exchange holiday.
     */
    session:
      null,


    pulse:
      Object.freeze({

        TAIEX:
          taiex,

        TPEX:
          tpex,

        /*
         * Taiwan index futures will
         * be connected later through
         * a proper futures source.
         */
        TX:
          null

      }),


    updatedAt:
      new Date()
        .toISOString(),


    meta:
      Object.freeze({

        provider:
          "official-tw",

        partial:
          successCount <
          2,

        sources:
          Object.freeze({

            TWSE:
              taiex
                ? "ready"
                : "error",

            TPEX:
              tpex
                ? "ready"
                : "error",

            TAIFEX:
              "not-connected"

          }),


        errors:
          Object.freeze({

            TWSE:
              errorSummary(
                taiexResult
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
/* Public provider                                                            */
/* ========================================================================== */

export const officialTWProvider =
  Object.freeze({

    id:
      "official-tw",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,


    getMarketPulse:
      getOfficialTWMarketPulse

  });
