import {
  getOfficialTWQuote
} from "./quotes.js";


/*
 * OX v4.0 Modular
 * Taiwan Historical Candle Provider
 *
 * Official sources:
 *
 * TWSE
 * - STOCK_DAY
 *
 * TPEx
 * - st43_result.php
 *
 *
 * Current support:
 *
 * - Daily candles only
 * - TWSE listed stocks
 * - TPEx OTC stocks
 * - OHLC
 * - Volume
 * - Turnover
 * - Daily change
 *
 *
 * IMPORTANT:
 *
 * - Official EOD / historical data.
 * - Not intraday streaming.
 * - Not adjusted price data.
 * - Never manufacture missing candles.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const TWSE_STOCK_DAY_URL =
  "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";


const TPEX_STOCK_DAY_URL =
  "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock";


const DEFAULT_TIMEOUT_MS =
  12000;


const MAX_MONTHS =
  36;


const REQUEST_CONCURRENCY =
  3;

// The exchanges publish daily OHLC from these dates. Completion means the
// published range has been checked, not that pre-publication prices exist.
export const TW_HISTORY_START = Object.freeze({TWSE:'2010-01-01',TPEX:'1994-01-01'});
const monthCache=new Map();
async function cachedMonth(market,symbol,month,loader){
 const key=`${market}:${symbol}:${formatISODate(month)}`,cached=monthCache.get(key);
 if(cached&&cached.expires>Date.now())return cached.promise;
 const expires=Date.now()+(month.getUTCFullYear()===new Date().getUTCFullYear()&&month.getUTCMonth()===new Date().getUTCMonth()?300000:43200000);
 const promise=loader().catch(error=>{if(monthCache.get(key)?.promise===promise)monthCache.delete(key);throw error;});
 monthCache.delete(key);monthCache.set(key,{expires,promise});if(monthCache.size>2048)monthCache.delete(monthCache.keys().next().value);
 return promise;
}


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWCandleProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_CANDLES_ERROR",

      source =
        "",

      symbol =
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
      "TWCandleProviderError";


    this.code =
      code;


    this.source =
      source;


    this.symbol =
      symbol;


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
        /\+/g,
        ""
      )
      .replace(
        /%/g,
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
      "N/A" ||
    cleaned ===
      "X"
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


function normalizeSymbol(
  value
) {

  const symbol =
    textValue(
      value
    )
      .toUpperCase();


  if (
    !symbol
  ) {

    throw new TWCandleProviderError(
      "Taiwan stock symbol is required.",
      {
        code:
          "TW_CANDLES_SYMBOL_REQUIRED"
      }
    );
  }


  if (
    !/^[0-9A-Z.-]{1,16}$/
      .test(
        symbol
      )
  ) {

    throw new TWCandleProviderError(
      "Invalid Taiwan stock symbol.",
      {
        code:
          "TW_CANDLES_INVALID_SYMBOL",

        symbol
      }
    );
  }


  return symbol;
}


function normalizeInterval(
  value
) {

  const interval =
    textValue(
      value ||
      "1D"
    )
      .toUpperCase();


  if (
    [
      "1D",
      "1DAY",
      "DAY",
      "D"
    ].includes(
      interval
    )
  ) {

    return "1D";
  }


  throw new TWCandleProviderError(
    "Current Taiwan official candle provider supports daily candles only.",
    {
      code:
        "TW_CANDLES_INTERVAL_NOT_SUPPORTED"
    }
  );
}


function normalizeLimit(
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


  const parsed =
    Number(
      value
    );


  if (
    !Number.isFinite(
      parsed
    )
  ) {

    return null;
  }


  return Math.max(
    1,
    Math.min(
      1000,
      Math.floor(
        parsed
      )
    )
  );
}


/* ========================================================================== */
/* Date helpers                                                               */
/* ========================================================================== */

function dateOnly(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const date =
    value instanceof
      Date
      ? new Date(
          value.getTime()
        )
      : new Date(
          value
        );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;
  }


  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    )
  );
}


function formatISODate(
  date
) {

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() +
      1
    ).padStart(
      2,
      "0"
    ),
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    )
  ].join(
    "-"
  );
}


function formatCompactMonth(
  date
) {

  return `${
    date.getUTCFullYear()
  }${
    String(
      date.getUTCMonth() +
      1
    ).padStart(
      2,
      "0"
    )
  }01`;
}


function formatROCMonth(
  date
) {

  return `${
    date.getUTCFullYear() -
    1911
  }/${
    String(
      date.getUTCMonth() +
      1
    ).padStart(
      2,
      "0"
    )
  }`;
}


function parseROCDate(
  value
) {

  const raw =
    textValue(
      value
    );


  const match =
    raw.match(
      /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/
    );


  if (
    !match
  ) {

    return null;
  }


  const year =
    Number(
      match[1]
    ) +
    1911;


  const month =
    String(
      Number(
        match[2]
      )
    ).padStart(
      2,
      "0"
    );


  const day =
    String(
      Number(
        match[3]
      )
    ).padStart(
      2,
      "0"
    );


  return `${
    year
  }-${
    month
  }-${
    day
  }`;
}


function firstDayOfMonth(
  date
) {

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1
    )
  );
}


function addMonths(
  date,
  amount
) {

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() +
      amount,
      1
    )
  );
}


function subtractMonths(
  date,
  amount
) {

  return addMonths(
    date,
    -amount
  );
}


function resolveRange(
  {
    range =
      "6M",

    from =
      null,

    to =
      null
  } = {}
) {

  const today =
    dateOnly(
      new Date()
    );


  const end =
    dateOnly(
      to
    ) ||
    today;


  let start =
    dateOnly(
      from
    );


  if (
    !start
  ) {

    const normalizedRange =
      textValue(
        range ||
        "6M"
      )
        .toUpperCase();


    switch (
      normalizedRange
    ) {

      case "5D":

        start =
          new Date(
            end.getTime() -
            14 *
            86400000
          );

        break;


      case "1M":

        start =
          subtractMonths(
            end,
            1
          );

        break;


      case "3M":

        start =
          subtractMonths(
            end,
            3
          );

        break;


      case "6M":

        start =
          subtractMonths(
            end,
            6
          );

        break;


      case "YTD":

        start =
          new Date(
            Date.UTC(
              end.getUTCFullYear(),
              0,
              1
            )
          );

        break;


      case "1Y":

        start =
          subtractMonths(
            end,
            12
          );

        break;


      case "2Y":

        start =
          subtractMonths(
            end,
            24
          );

        break;


      case "3Y":
        start = subtractMonths(end, 36);
        break;

      default:

        start =
          subtractMonths(
            end,
            6
          );

        break;
    }
  }


  if (
    start >
    end
  ) {

    throw new TWCandleProviderError(
      "Taiwan candle start date must be before end date.",
      {
        code:
          "TW_CANDLES_INVALID_RANGE"
      }
    );
  }


  return {

    start,

    end

  };
}


function buildMonths(
  start,
  end
) {

  const months =
    [];


  let current =
    firstDayOfMonth(
      start
    );


  const last =
    firstDayOfMonth(
      end
    );


  while (
    current <=
    last
  ) {

    months.push(
      current
    );


    current =
      addMonths(
        current,
        1
      );
  }


  if (
    months.length >
    MAX_MONTHS +
    1
  ) {

    throw new TWCandleProviderError(
      "Current Taiwan historical candle provider supports up to 36 months per request.",
      {
        code:
          "TW_CANDLES_RANGE_TOO_LARGE",

        details: {

          requestedMonths:
            months.length,

          maximumMonths:
            MAX_MONTHS

        }
      }
    );
  }


  return months;
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

      throw new TWCandleProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_CANDLES_HTTP_ERROR",

          source,

          status:
            response.status
        }
      );
    }


    if (
      !text
    ) {

      throw new TWCandleProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_CANDLES_EMPTY_RESPONSE",

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

      throw new TWCandleProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_CANDLES_INVALID_JSON",

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
      TWCandleProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWCandleProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_CANDLES_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWCandleProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_CANDLES_NETWORK_ERROR",

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
/* TWSE                                                                       */
/* ========================================================================== */

async function fetchTWSEMonth(
  symbol,
  month
) {

  const url =
    new URL(
      TWSE_STOCK_DAY_URL
    );


  url.searchParams.set(
    "response",
    "json"
  );


  url.searchParams.set(
    "date",
    formatCompactMonth(
      month
    )
  );


  url.searchParams.set(
    "stockNo",
    symbol
  );


  const payload =
    await requestJSON(
      url.toString(),
      {
        source:
          "TWSE-STOCK-DAY"
      }
    );


  /*
   * No trading data in this month
   * is allowed and is not treated
   * as an upstream failure.
   */
  if (
    payload?.stat !==
      "OK"
  ) {
    if(typeof payload?.stat==='string'&&/沒有符合條件|查無資料/.test(payload.stat))return [];
    throw new TWCandleProviderError('TWSE historical response is unavailable.',{code:'TW_CANDLES_INVALID_RESPONSE',source:'TWSE',symbol});
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
          ) ||
          row.length <
            7
        ) {

          return null;
        }


        const date =
          parseROCDate(
            row[0]
          );


        if (
          !date
        ) {

          return null;
        }


        return Object.freeze({

          datetime:
            date,

          date,

          open:
            numberValue(
              row[3]
            ),

          high:
            numberValue(
              row[4]
            ),

          low:
            numberValue(
              row[5]
            ),

          close:
            numberValue(
              row[6]
            ),

          volume:
            numberValue(
              row[1]
            ),

          turnoverTwd:
            numberValue(
              row[2]
            ),

          change:
            numberValue(
              row[7]
            ),

          transactions:
            numberValue(
              row[8]
            )

        });

      }
    )
    .filter(
      candle =>
        candle &&
        candle.close !==
          null
    );
}


/* ========================================================================== */
/* TPEx                                                                       */
/* ========================================================================== */

async function fetchTPEXMonth(
  symbol,
  month
) {

  const url =
    new URL(
      TPEX_STOCK_DAY_URL
    );


  url.searchParams.set("response", "json");
  url.searchParams.set("date", formatISODate(month).replaceAll("-", "/"));
  url.searchParams.set("code", symbol);


  const payload =
    await requestJSON(
      url.toString(),
      {
        source:
          "TPEX-ST43"
      }
    );


  const rows = payload?.tables?.find(table => Array.isArray(table.data))?.data ?? payload?.aaData;
  if (!Array.isArray(rows)) {
    if(payload?.stat==='ok'&&Array.isArray(payload.tables)&&payload.tables.length===0)return [];
    throw new TWCandleProviderError("TPEx historical response is unavailable.", {
      code: "TW_CANDLES_INVALID_RESPONSE", source: "TPEX", symbol
    });
  }


  return rows
    .map(
      row => {

        if (
          !Array.isArray(
            row
          ) ||
          row.length <
            7
        ) {

          return null;
        }


        const date =
          parseROCDate(
            row[0]
          );


        if (
          !date
        ) {

          return null;
        }


        const volumeThousands =
          numberValue(
            row[1]
          );


        const turnoverThousands =
          numberValue(
            row[2]
          );


        return Object.freeze({

          datetime:
            date,

          date,

          open:
            numberValue(
              row[3]
            ),

          high:
            numberValue(
              row[4]
            ),

          low:
            numberValue(
              row[5]
            ),

          close:
            numberValue(
              row[6]
            ),


          /*
           * TPEx historical report
           * uses thousands of shares.
           *
           * Normalize to shares.
           */
          volume:
            volumeThousands !==
              null
              ? volumeThousands *
                1000
              : null,


          /*
           * TPEx historical report
           * uses thousands of TWD.
           *
           * Normalize to TWD.
           */
          turnoverTwd:
            turnoverThousands !==
              null
              ? turnoverThousands *
                1000
              : null,

          change:
            numberValue(
              row[7]
            ),

          transactions:
            numberValue(
              row[8]
            )

        });

      }
    )
    .filter(
      candle =>
        candle &&
        candle.close !==
          null
    );
}


/* ========================================================================== */
/* Batch runner                                                               */
/* ========================================================================== */

async function runMonthBatch(
  months,
  loader,
  {concurrency=REQUEST_CONCURRENCY,paceMs=0}={}
) {

  const candles =
    [];


  const failures =
    [];


  for (
    let index =
      0;
    index <
      months.length;
    index +=
      concurrency
  ) {

    const batch =
      months.slice(
        index,
        index +
        concurrency
      );


    const results =
      await Promise.allSettled(
        batch.map(
          month =>
            loader(
              month
            )
        )
      );


    results.forEach(
      (
        result,
        resultIndex
      ) => {

        const month =
          batch[
            resultIndex
          ];


        if (
          result.status ===
            "fulfilled"
        ) {

          candles.push(
            ...result.value
          );

        } else {

          failures.push({

            month:
              `${
                month.getUTCFullYear()
              }-${
                String(
                  month.getUTCMonth() +
                  1
                ).padStart(
                  2,
                  "0"
                )
              }`,

            code:
              result.reason
                ?.code ||
              "UNKNOWN",

            message:
              result.reason
                ?.message ||
              "Unknown candle request error"

          });
        }
      }
    );
    if(paceMs&&index+concurrency<months.length)await new Promise(resolve=>setTimeout(resolve,paceMs));
  }


  /*
   * Never silently return a chart
   * with missing months caused by
   * upstream request failures.
   */
  if (
    failures.length
  ) {

    throw new TWCandleProviderError(
      "Taiwan historical candle request was incomplete.",
      {
        code:
          "TW_CANDLES_PARTIAL_FAILURE",

        details: {

          failures

        }
      }
    );
  }


  return candles;
}


/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

export async function getOfficialTWCandles(
  symbol,
  {
    interval =
      "1D",

    range =
      "6M",

    from =
      null,

    to =
      null,

    limit =
      null,

    adjusted =
      true,

    history = false
  } = {}
) {

  const normalizedSymbol =
    normalizeSymbol(
      symbol
    );


  const normalizedInterval =
    normalizeInterval(
      interval
    );


  const normalizedLimit =
    normalizeLimit(
      limit
    );


  /*
   * Reuse Quote provider to identify
   * TWSE / TPEx safely.
   */
  const quote =
    await getOfficialTWQuote(
      normalizedSymbol
    );


  const market =
    textValue(
      quote?.market
    )
      .toUpperCase();


  if (
    market !==
      "TWSE" &&
    market !==
      "TPEX"
  ) {

    throw new TWCandleProviderError(
      "Unable to determine Taiwan stock market.",
      {
        code:
          "TW_CANDLES_MARKET_UNKNOWN",

        symbol:
          normalizedSymbol
      }
    );
  }


  const resolved =
    resolveRange(
      {
        range,
        from,
        to
      }
    );

  if(history){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!dateOnly(from)||!dateOnly(to)||formatISODate(dateOnly(from))!==from||formatISODate(dateOnly(to))!==to)throw new TWCandleProviderError('History pages require valid from and to dates.',{code:'TW_CANDLES_INVALID_RANGE'});
    const floor=dateOnly(TW_HISTORY_START[market]);if(resolved.start<floor)resolved.start=floor;
    if(resolved.end<resolved.start||buildMonths(resolved.start,resolved.end).length>6)throw new TWCandleProviderError('History pages support up to six calendar months.',{code:'TW_CANDLES_INVALID_RANGE'});
  }


  const months =
    buildMonths(
      resolved.start,
      resolved.end
    );


  const loader =
    market ===
      "TWSE"
      ? month =>
          fetchTWSEMonth(
            normalizedSymbol,
            month
          )
      : month =>
          fetchTPEXMonth(
            normalizedSymbol,
            month
          );


  let candles =
    await runMonthBatch(
      months,
      month => cachedMonth(market,normalizedSymbol,month,()=>loader(month)),
      history?{concurrency:1,paceMs:250}:{}
    );


  const startISO =
    formatISODate(
      resolved.start
    );


  const endISO =
    formatISODate(
      resolved.end
    );


  candles =
    candles
      .filter(
        candle =>
          candle.date >=
            startISO &&
          candle.date <=
            endISO
      )
      .sort(
        (
          a,
          b
        ) =>
          a.date.localeCompare(
            b.date
          )
      );


  /*
   * Remove duplicate dates.
   */
  const byDate =
    new Map();


  candles.forEach(
    candle => {

      byDate.set(
        candle.date,
        candle
      );

    }
  );


  candles =
    [
      ...byDate.values()
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.date.localeCompare(
            b.date
          )
      );


  if (
    normalizedLimit !==
      null &&
    candles.length >
      normalizedLimit
  ) {

    candles =
      candles.slice(
        -normalizedLimit
      );
  }


  if (
    !candles.length && !history
  ) {

    throw new TWCandleProviderError(
      `No historical candles were found for ${normalizedSymbol}.`,
      {
        code:
          "TW_CANDLES_NOT_FOUND",

        symbol:
          normalizedSymbol
      }
    );
  }


  return Object.freeze({

    symbol:
      normalizedSymbol,

    name:
      textValue(
        quote?.name
      ),

    market,

    interval:
      normalizedInterval,

    range:
      textValue(
        range ||
        "6M"
      )
        .toUpperCase(),

    from:
      startISO,

    to:
      endISO,


    /*
     * Official raw historical prices
     * are currently returned.
     *
     * adjusted=true from frontend
     * is accepted for compatibility,
     * but the actual response clearly
     * declares adjusted:false.
     */
    adjusted:
      false,

    requestedAdjusted:
      adjusted ===
        true,

    realtime:
      false,

    candles:
      Object.freeze(
        candles
      ),

    updatedAt:
      new Date()
        .toISOString(),

    meta:
      Object.freeze({

        provider:
          "official-tw",

        source:
          market ===
            "TWSE"
            ? "TWSE-STOCK-DAY"
            : "TPEX-ST43",

        candleCount:
          candles.length,

        monthsRequested:
          months.length,

        historical:
          true,

        realtime:
          false,

        adjusted:
          false,

        supportedIntervals:
          Object.freeze([
            "1D"
          ]),

        maximumMonthsPerRequest:
          MAX_MONTHS,

        historyPage: history,
        earliestAvailableDate: TW_HISTORY_START[market]

      })

  });
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWCandleProvider =
  Object.freeze({

    id:
      "official-tw-candles",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getCandles:
      getOfficialTWCandles

  });
