import { applyClassicToRows } from '../../../../server/markets/tw/classic-provider.js';
import { loadTWSurveillance, loadTWSEAttentionForDate, buildTWSurveillance } from '../../../../server/markets/tw/surveillance.js';

/*
 * OX v4.0 Modular
 * Taiwan Stock Radar Provider
 *
 * Primary official sources:
 *
 * TWSE
 * - MI_INDEX / ALLBUT0999
 *
 * TPEx
 * - otc_quotes_no1430 / stkw_wn1430
 *
 *
 * Fallback official sources:
 *
 * TWSE
 * - STOCK_DAY_ALL
 *
 * TPEx
 * - tpex_mainboard_daily_close_quotes
 *
 *
 * Industry sources:
 *
 * TWSE
 * - t187ap05_L
 *
 * TPEx
 * - mopsfin_t187ap05_O
 *
 *
 * Goal:
 *
 * Always prefer the latest COMPLETED
 * common trading date of TWSE + TPEx.
 *
 * Do not mix two exchanges from
 * different trading dates.
 *
 * Never manufacture market data.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const TWSE_DAILY_URL =
  "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";


const TPEX_DAILY_URL =
  "https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php";


const TWSE_QUOTES_FALLBACK_URL =
  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";


const TPEX_QUOTES_FALLBACK_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes";


const TWSE_INDUSTRY_URL =
  "https://openapi.twse.com.tw/v1/opendata/t187ap05_L";


const TPEX_INDUSTRY_URL =
  "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O";


const DEFAULT_TIMEOUT_MS =
  12000;


const CACHE_TTL_MS =
  60000;


/*
 * Before this time in Taipei,
 * today's after-trading file is
 * not considered completed yet.
 *
 * We deliberately choose a safe
 * time instead of assuming data
 * exists immediately after 13:30.
 */
const COMPLETED_SESSION_HOUR =
  15;


/*
 * Enough to cross weekends and
 * normal Taiwan market holidays.
 */
const MAX_DATE_LOOKBACK =
  10;


/* ========================================================================== */
/* Cache                                                                      */
/* ========================================================================== */

let universeCache = {

  expiresAt:
    0,

  value:
    null

};


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWRadarProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_RADAR_ERROR",

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
      "TWRadarProviderError";


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


function stripHTML(
  value
) {

  return textValue(
    value
  )
    .replace(
      /<[^>]*>/g,
      ""
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .trim();
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
    stripHTML(
      value
    )
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


function clamp(
  value,
  min,
  max
) {

  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}


function normalizeLimit(
  value,
  fallback =
    500
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return fallback;
  }


  return clamp(
    Math.floor(
      number
    ),
    1,
    2000
  );
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


function normalizeTier(
  value
) {

  const tier =
    textValue(
      value
    )
      .toUpperCase();


  if (
    [
      "T1",
      "T2",
      "T3"
    ].includes(
      tier
    )
  ) {

    return tier;
  }


  return "ALL";
}


/* ========================================================================== */
/* Date helpers                                                               */
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


function taipeiNowParts() {

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
          "2-digit",

        hour:
          "2-digit",

        hourCycle:
          "h23"
      }
    );


  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(
          new Date()
        )
        .filter(
          item =>
            item.type !==
            "literal"
        )
        .map(
          item => [
            item.type,
            item.value
          ]
        )
    );


  return {

    year:
      Number(
        parts.year
      ),

    month:
      Number(
        parts.month
      ),

    day:
      Number(
        parts.day
      ),

    hour:
      Number(
        parts.hour
      )

  };
}


function toUTCDate(
  year,
  month,
  day
) {

  return new Date(
    Date.UTC(
      year,
      month -
      1,
      day
    )
  );
}


function addDays(
  date,
  amount
) {

  const output =
    new Date(
      date.getTime()
    );


  output.setUTCDate(
    output.getUTCDate() +
    amount
  );


  return output;
}


function isoDate(
  date
) {

  return `${
    date.getUTCFullYear()
  }-${
    String(
      date.getUTCMonth() +
      1
    ).padStart(
      2,
      "0"
    )
  }-${
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    )
  }`;
}


function compactDate(
  date
) {

  return isoDate(
    date
  )
    .replace(
      /-/g,
      ""
    );
}


function rocDate(
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
  }/${
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    )
  }`;
}


function candidateTradingDates() {

  const now =
    taipeiNowParts();


  let date =
    toUTCDate(
      now.year,
      now.month,
      now.day
    );


  /*
   * Before today's post-close
   * official report is expected,
   * start from yesterday.
   */
  if (
    now.hour <
      COMPLETED_SESSION_HOUR
  ) {

    date =
      addDays(
        date,
        -1
      );
  }


  const dates =
    [];


  for (
    let index =
      0;
    index <
      MAX_DATE_LOOKBACK;
    index +=
      1
  ) {

    dates.push(
      addDays(
        date,
        -index
      )
    );
  }


  return dates;
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

  const started=Date.now();
  let httpStatus=0;
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


    httpStatus=response.status;
    const text =
      await response.text();


    if (
      !response.ok
    ) {

      throw new TWRadarProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_RADAR_HTTP_ERROR",

          source,

          status:
            response.status
        }
      );
    }


    if (
      !text
    ) {

      throw new TWRadarProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_RADAR_EMPTY_RESPONSE",

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

      throw new TWRadarProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_RADAR_INVALID_JSON",

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
      TWRadarProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWRadarProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_RADAR_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWRadarProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_RADAR_NETWORK_ERROR",

        source,

        cause:
          error
      }
    );

  } finally {
    console.info("[OX TW upstream]",{source,status:httpStatus,elapsedMs:Date.now()-started,aborted:controller.signal.aborted});
    clearTimeout(
      timer
    );
  }
}


/* ========================================================================== */
/* Industry                                                                   */
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
  payload
) {

  const map =
    new Map();


  if (
    !Array.isArray(
      payload
    )
  ) {

    return map;
  }


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


    const name =
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


    map.set(
      symbol,
      Object.freeze({

        symbol,

        name,

        industry

      })
    );
  }


  return map;
}


async function loadIndustryMaps() {

  const [
    twseResult,
    tpexResult
  ] =
    await Promise.allSettled([

      requestJSON(
        TWSE_INDUSTRY_URL,
        {
          source:
            "TWSE-INDUSTRY"
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


  return {

    twse:
      twseResult.status ===
        "fulfilled"
        ? buildIndustryMap(
            twseResult.value
          )
        : null,

    tpex:
      tpexResult.status ===
        "fulfilled"
        ? buildIndustryMap(
            tpexResult.value
          )
        : null,

    errors: {

      TWSE:
        twseResult.status ===
          "rejected"
          ? twseResult.reason
          : null,

      TPEX:
        tpexResult.status ===
          "rejected"
          ? tpexResult.reason
          : null

    }

  };
}


/* ========================================================================== */
/* Change                                                                     */
/* ========================================================================== */

function signedTwseChange(
  difference,
  signValue
) {

  if (
    difference ===
      null
  ) {

    return null;
  }


  const sign =
    stripHTML(
      signValue
    );


  if (
    sign.includes(
      "+"
    )
  ) {

    return Math.abs(
      difference
    );
  }


  if (
    sign.includes(
      "-"
    )
  ) {

    return -Math.abs(
      difference
    );
  }


  /*
   * X / blank / special cases:
   * retain raw numeric difference.
   */
  return difference;
}


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


  const previous =
    close -
    change;


  if (
    !Number.isFinite(
      previous
    ) ||
    previous <=
      0
  ) {

    return null;
  }


  return (
    change /
    previous
  ) *
    100;
}


/* ========================================================================== */
/* TWSE daily after-trading                                                   */
/* ========================================================================== */

function findTWSEStockTable(
  payload
) {

  const tables =
    Array.isArray(
      payload?.tables
    )
      ? payload.tables
      : [];


  return tables.find(
    table => {

      const fields =
        Array.isArray(
          table?.fields
        )
          ? table.fields
          : [];


      return (
        fields.includes(
          "證券代號"
        ) &&
        fields.includes(
          "收盤價"
        ) &&
        fields.includes(
          "成交股數"
        )
      );

    }
  ) ||
  null;
}


function fieldIndex(
  fields,
  names
) {

  // Official TWSE / TPEx headings may contain padding or HTML line breaks.
  // Compare their visible labels, never their untrimmed transport strings.
  const normalizedFields =
    fields.map(field =>
      stripHTML(field).replace(/\s+/g, "")
    );

  for (
    const name
    of names
  ) {

    const index =
      normalizedFields.indexOf(
        name.replace(/\s+/g, "")
      );


    if (
      index >=
        0
    ) {

      return index;
    }
  }


  return -1;
}


function normalizeTWSEDailyRows(
  payload,
  industryMap,
  requestedDate
) {

  if (
    payload?.stat !==
      "OK"
  ) {

    return [];
  }


  const table =
    findTWSEStockTable(
      payload
    );


  if (
    !table
  ) {

    return [];
  }


  const fields =
    table.fields;


  const indexes = {

    symbol:
      fieldIndex(
        fields,
        [
          "證券代號"
        ]
      ),

    name:
      fieldIndex(
        fields,
        [
          "證券名稱"
        ]
      ),

    volume:
      fieldIndex(
        fields,
        [
          "成交股數"
        ]
      ),

    turnover:
      fieldIndex(
        fields,
        [
          "成交金額"
        ]
      ),

    close:
      fieldIndex(
        fields,
        [
          "收盤價"
        ]
      ),

    sign:
      fieldIndex(
        fields,
        [
          "漲跌(+/-)"
        ]
      ),

    difference:
      fieldIndex(
        fields,
        [
          "漲跌價差"
        ]
      )

  };


  if (
    indexes.symbol <
      0 ||
    indexes.close <
      0
  ) {

    return [];
  }


  const rows =
    Array.isArray(
      table.data
    )
      ? table.data
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


        const symbol =
          textValue(
            row[
              indexes.symbol
            ]
          );


        const company =
          industryMap
            ?.get(
              symbol
            );


        if (
          !company
        ) {

          return null;
        }


        const price =
          numberValue(
            row[
              indexes.close
            ]
          );


        if (
          price ===
            null ||
          price <=
            0
        ) {

          return null;
        }


        const rawDifference =
          indexes.difference >=
            0
            ? numberValue(
                row[
                  indexes.difference
                ]
              )
            : null;


        const change =
          indexes.sign >=
            0
            ? signedTwseChange(
                rawDifference,
                row[
                  indexes.sign
                ]
              )
            : rawDifference;


        return {

          symbol,

          name:
            (
              indexes.name >=
                0
                ? textValue(
                    row[
                      indexes.name
                    ]
                  )
                : ""
            ) ||
            company.name,

          market:
            "TWSE",

          industry:
            company.industry,

          theme:
            company.industry,

          price,
          currentCandle: {
            open: numberValue(row[fieldIndex(fields, ["開盤價", "開盤"])]),
            high: numberValue(row[fieldIndex(fields, ["最高價", "最高"])]),
            low: numberValue(row[fieldIndex(fields, ["最低價", "最低"])]),
            close: price
          },

          change,

          changePct:
            calculateChangePct(
              price,
              change
            ),

          volume:
            indexes.volume >=
              0
              ? numberValue(
                  row[
                    indexes.volume
                  ]
                )
              : null,

          turnoverTwd:
            indexes.turnover >=
              0
              ? numberValue(
                  row[
                    indexes.turnover
                  ]
                )
              : null,

          dataDate:
            requestedDate

        };

      }
    )
    .filter(
      Boolean
    );
}


async function loadTWSEForDate(
  date,
  industryMap
) {

  const url =
    new URL(
      TWSE_DAILY_URL
    );


  url.searchParams.set(
    "response",
    "json"
  );


  url.searchParams.set(
    "date",
    compactDate(
      date
    )
  );


  url.searchParams.set(
    "type",
    "ALLBUT0999"
  );


  const payload =
    await requestJSON(
      url.toString(),
      {
        source:
          "TWSE-MI-INDEX"
      }
    );


  industryMap=await industryMap;
  const requestedDate =
    isoDate(
      date
    );


  const rows =
    normalizeTWSEDailyRows(
      payload,
      industryMap,
      requestedDate
    );


  if (
    !rows.length
  ) {

    throw new TWRadarProviderError(
      "TWSE returned no usable daily stock rows.",
      {
        code:
          "TWSE_RADAR_DAY_EMPTY",

        source:
          "TWSE",

        details: {

          date:
            requestedDate

        }
      }
    );
  }


  return {

    market:
      "TWSE",

    dataDate:
      requestedDate,

    rows

  };
}


/* ========================================================================== */
/* TPEx daily after-trading                                                   */
/* ========================================================================== */

function findTPEXStockTable(
  payload
) {

  const tables =
    Array.isArray(
      payload?.tables
    )
      ? payload.tables
      : [];


  return tables.find(
    table => {

      const fields =
        Array.isArray(
          table?.fields
        )
          ? table.fields
          : [];


      return (
        fieldIndex(fields, ["代號", "證券代號"]) >= 0 &&
        fieldIndex(fields, ["收盤", "收盤價"]) >= 0
      );

    }
  ) ||
  tables[0] ||
  null;
}


function normalizeTPEXTableRows(
  table,
  industryMap,
  requestedDate
) {

  const fields =
    Array.isArray(
      table?.fields
    )
      ? table.fields
      : [];


  const rows =
    Array.isArray(
      table?.data
    )
      ? table.data
      : [];


  const indexes = {

    symbol:
      fieldIndex(
        fields,
        [
          "代號",
          "證券代號"
        ]
      ),

    name:
      fieldIndex(
        fields,
        [
          "名稱",
          "證券名稱"
        ]
      ),

    close:
      fieldIndex(
        fields,
        [
          "收盤",
          "收盤價"
        ]
      ),

    change:
      fieldIndex(
        fields,
        [
          "漲跌",
          "漲跌價差"
        ]
      ),

    volume:
      fieldIndex(
        fields,
        [
          "成交股數",
          "成交量"
        ]
      ),

    turnover:
      fieldIndex(
        fields,
        [
          "成交金額(元)",
          "成交金額",
          "成交值"
        ]
      )

  };


  if (
    indexes.symbol <
      0 ||
    indexes.close <
      0
  ) {

    return [];
  }


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


        const symbol =
          textValue(
            row[
              indexes.symbol
            ]
          );


        const company =
          industryMap
            ?.get(
              symbol
            );


        if (
          !company
        ) {

          return null;
        }


        const price =
          numberValue(
            row[
              indexes.close
            ]
          );


        if (
          price ===
            null ||
          price <=
            0
        ) {

          return null;
        }


        const change =
          indexes.change >=
            0
            ? numberValue(
                row[
                  indexes.change
                ]
              )
            : null;


        return {

          symbol,

          name:
            (
              indexes.name >=
                0
                ? textValue(
                    row[
                      indexes.name
                    ]
                  )
                : ""
            ) ||
            company.name,

          market:
            "TPEX",

          industry:
            company.industry,

          theme:
            company.industry,

          price,
          currentCandle: {
            open: numberValue(row[fieldIndex(fields, ["開盤價", "開盤"])]),
            high: numberValue(row[fieldIndex(fields, ["最高價", "最高"])]),
            low: numberValue(row[fieldIndex(fields, ["最低價", "最低"])]),
            close: price
          },

          change,

          changePct:
            calculateChangePct(
              price,
              change
            ),

          volume:
            indexes.volume >=
              0
              ? numberValue(
                  row[
                    indexes.volume
                  ]
                )
              : null,

          turnoverTwd:
            indexes.turnover >=
              0
              ? numberValue(
                  row[
                    indexes.turnover
                  ]
                )
              : null,

          dataDate:
            requestedDate

        };

      }
    )
    .filter(
      Boolean
    );
}


function normalizeTPEXAAData(
  payload,
  industryMap,
  requestedDate
) {

  const rows =
    Array.isArray(
      payload?.aaData
    )
      ? payload.aaData
      : [];


  return rows
    .map(
      row => {

        if (
          !Array.isArray(
            row
          ) ||
          row.length <
            8
        ) {

          return null;
        }


        const symbol =
          textValue(
            row[0]
          );


        const company =
          industryMap
            ?.get(
              symbol
            );


        if (
          !company
        ) {

          return null;
        }


        const price =
          numberValue(
            row[2]
          );


        if (
          price ===
            null ||
          price <=
            0
        ) {

          return null;
        }


        const change =
          numberValue(
            row[3]
          );


        return {

          symbol,

          name:
            textValue(
              row[1]
            ) ||
            company.name,

          market:
            "TPEX",

          industry:
            company.industry,

          theme:
            company.industry,

          price,

          change,

          changePct:
            calculateChangePct(
              price,
              change
            ),

          volume:
            row.length > 8
              ? numberValue(row[8])
              : null,

          turnoverTwd:
            row.length > 9
              ? numberValue(row[9])
              : null,

          dataDate:
            requestedDate

        };

      }
    )
    .filter(
      Boolean
    );
}


async function loadTPEXForDate(
  date,
  industryMap
) {

  const url =
    new URL(
      TPEX_DAILY_URL
    );


  url.searchParams.set(
    "l",
    "zh-tw"
  );


  url.searchParams.set(
    "d",
    rocDate(
      date
    )
  );


  url.searchParams.set(
    "se",
    "EW"
  );


  url.searchParams.set(
    "o",
    "json"
  );


  const payload =
    await requestJSON(
      url.toString(),
      {
        source:
          "TPEX-DAILY-CLOSE"
      }
    );


  industryMap=await industryMap;
  const requestedDate =
    isoDate(
      date
    );


  const table =
    findTPEXStockTable(
      payload
    );


  let rows =
    table
      ? normalizeTPEXTableRows(
          table,
          industryMap,
          requestedDate
        )
      : [];


  if (
    !rows.length
  ) {

    rows =
      normalizeTPEXAAData(
        payload,
        industryMap,
        requestedDate
      );
  }


  if (
    !rows.length
  ) {

    throw new TWRadarProviderError(
      "TPEx returned no usable daily stock rows.",
      {
        code:
          "TPEX_RADAR_DAY_EMPTY",

        source:
          "TPEX",

        details: {

          date:
            requestedDate

        }
      }
    );
  }


  return {

    market:
      "TPEX",

    dataDate:
      requestedDate,

    rows

  };
}


/* ========================================================================== */
/* Common latest completed trading date                                       */
/* ========================================================================== */

async function loadLatestCommonDailyMarket(
  twseIndustryMap,
  tpexIndustryMap,
  minimumDate = null
) {

  const started=Date.now();
  const attempts =
    [];


  for (
    const date
    of candidateTradingDates().slice(0,4)
  ) {
    if(Date.now()-started>24000)break;

    const dateISO =
      isoDate(
        date
      );

    if (minimumDate && dateISO < minimumDate) break;


    const [
      twseResult,
      tpexResult
    ] =
      await Promise.allSettled([

        loadTWSEForDate(
          date,
          twseIndustryMap
        ),

        loadTPEXForDate(
          date,
          tpexIndustryMap
        )

      ]);


    if (
      twseResult.status ===
        "fulfilled" &&
      tpexResult.status ===
        "fulfilled"
    ) {

      return {

        mode:
          "latest-completed-trading-day",

        dataDate:
          dateISO,

        twse:
          twseResult.value,

        tpex:
          tpexResult.value,

        attempts

      };
    }


    attempts.push({

      date:
        dateISO,

      TWSE:
        twseResult.status ===
          "fulfilled"
          ? "ready"
          : (
              twseResult.reason
                ?.code ||
              "error"
            ),

      TPEX:
        tpexResult.status ===
          "fulfilled"
          ? "ready"
          : (
              tpexResult.reason
                ?.code ||
              "error"
            )

    });
  }


  throw new TWRadarProviderError(
    "Unable to find a common completed TWSE / TPEx trading date.",
    {
      code:
        "TW_RADAR_COMMON_DATE_NOT_FOUND",

      source:
        "official-tw",

      details: {

        attempts

      }
    }
  );
}


/* ========================================================================== */
/* Fallback snapshot                                                          */
/* ========================================================================== */

function normalizeTwseSnapshotStock(
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


  const company = industryMap?.get(symbol) ||
    ((!industryMap?.size && /^[1-9]\d{3}$/.test(symbol))
      ? { name: textValue(row.Name || row.CompanyName || row['證券名稱']), industry: '' }
      : null);


  if (
    !company
  ) {

    return null;
  }


  const price =
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
    price ===
      null ||
    price <=
      0
  ) {

    return null;
  }


  return {

    symbol,

    name:
      textValue(
        pick(
          row,
          [
            "Name",
            "證券名稱"
          ]
        )
      ) ||
      company.name,

    market:
      "TWSE",

    industry:
      company.industry,

    theme:
      company.industry,

    price,
    currentCandle: {
      open: numberValue(row.OpeningPrice ?? row.Open ?? row['開盤價']),
      high: numberValue(row.HighestPrice ?? row.High ?? row['最高價']),
      low: numberValue(row.LowestPrice ?? row.Low ?? row['最低價']),
      close: price
    },

    change,

    changePct:
      calculateChangePct(
        price,
        change
      ),

    volume:
      numberValue(
        pick(
          row,
          [
            "TradeVolume",
            "成交股數"
          ]
        )
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

  };
}


function normalizeTpexSnapshotStock(
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


  const company = industryMap?.get(symbol) ||
    ((!industryMap?.size && /^[1-9]\d{3}$/.test(symbol))
      ? { name: textValue(row.Name || row.CompanyName || row['證券名稱']), industry: '' }
      : null);


  if (
    !company
  ) {

    return null;
  }


  const price =
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
    price ===
      null ||
    price <=
      0
  ) {

    return null;
  }


  return {

    symbol,

    name:
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
      company.name,

    market:
      "TPEX",

    industry:
      company.industry,

    theme:
      company.industry,

    price,
    currentCandle: {
      open: numberValue(row.OpeningPrice ?? row.Open ?? row['開盤價']),
      high: numberValue(row.HighestPrice ?? row.High ?? row['最高價']),
      low: numberValue(row.LowestPrice ?? row.Low ?? row['最低價']),
      close: price
    },

    change,

    changePct:
      calculateChangePct(
        price,
        change
      ),

    volume:
      numberValue(
        pick(
          row,
          [
            "TradingShares",
            "TradingVolume",
            "成交股數",
            "成交量"
          ]
        )
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
            "資料日期",
            "日期"
          ]
        )
      )

  };
}


function latestDate(
  rows
) {

  const dates =
    rows
      .map(
        item =>
          item.dataDate
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

      date:
        null,

      rows

    };
  }


  return {

    date,

    rows:
      rows.filter(
        item =>
          item.dataDate ===
          date
      )

  };
}


async function loadTWSESnapshot(
  industryMap,
  prefetched
) {

  if (prefetched?.error) throw prefetched.error;

  const payload =
    prefetched?.payload ?? await requestJSON(
      TWSE_QUOTES_FALLBACK_URL,
      {
        source:
          "TWSE-STOCK-DAY-ALL"
      }
    );


  if (
    !Array.isArray(
      payload
    )
  ) {

    throw new TWRadarProviderError(
      "TWSE fallback quote payload is invalid.",
      {
        code:
          "TWSE_RADAR_INVALID",

        source:
          "TWSE"
      }
    );
  }


  const normalized =
    payload
      .map(
        row =>
          normalizeTwseSnapshotStock(
            row,
            industryMap
          )
      )
      .filter(
        Boolean
      );


  const latest =
    keepLatestDate(
      normalized
    );


  if (
    !latest.rows.length
  ) {

    throw new TWRadarProviderError(
      "TWSE fallback returned no usable Radar stocks.",
      {
        code:
          "TWSE_RADAR_EMPTY",

        source:
          "TWSE"
      }
    );
  }


  return {

    market:
      "TWSE",

    dataDate:
      latest.date,

    rows:
      latest.rows

  };
}


async function loadTPEXSnapshot(
  industryMap,
  prefetched
) {

  if (prefetched?.error) throw prefetched.error;

  const payload =
    prefetched?.payload ?? await requestJSON(
      TPEX_QUOTES_FALLBACK_URL,
      {
        source:
          "TPEX-OPENAPI-DAILY"
      }
    );


  if (
    !Array.isArray(
      payload
    )
  ) {

    throw new TWRadarProviderError(
      "TPEx fallback quote payload is invalid.",
      {
        code:
          "TPEX_RADAR_INVALID",

        source:
          "TPEX"
      }
    );
  }


  const normalized =
    payload
      .map(
        row =>
          normalizeTpexSnapshotStock(
            row,
            industryMap
          )
      )
      .filter(
        Boolean
      );


  const latest =
    keepLatestDate(
      normalized
    );


  if (
    !latest.rows.length
  ) {

    throw new TWRadarProviderError(
      "TPEx fallback returned no usable Radar stocks.",
      {
        code:
          "TPEX_RADAR_EMPTY",

        source:
          "TPEX"
      }
    );
  }


  return {

    market:
      "TPEX",

    dataDate:
      latest.date,

    rows:
      latest.rows

  };
}


async function loadFallbackMarket(industryMaps, snapshots = {}, requireBoth = false) {
  const [twseResult, tpexResult] = await Promise.allSettled([
    loadTWSESnapshot(industryMaps.twse, snapshots.twse),
    loadTPEXSnapshot(industryMaps.tpex, snapshots.tpex)
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
    (!twse && !tpex) ||
    (requireBoth && (!twse || !tpex))
  ) {

    throw new TWRadarProviderError(
      "A Taiwan Radar exchange source is unavailable; require both markets.",
      {
        code:
          "TW_RADAR_ALL_FAILED",

        source:
          "official-tw"
      }
    );
  }


  if (
    twse &&
    tpex &&
    twse.dataDate &&
    tpex.dataDate &&
    twse.dataDate !==
      tpex.dataDate
  ) {

    throw new TWRadarProviderError(
      "TWSE and TPEx fallback trading dates do not match.",
      {
        code:
          "TW_RADAR_DATE_MISMATCH",

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


  return {

    mode:
      "openapi-snapshot-fallback",

    dataDate:
      twse
        ?.dataDate ||
      tpex
        ?.dataDate ||
      null,

    twse,

    tpex,

    sourceResults: {

      TWSE:
        twseResult,

      TPEX:
        tpexResult

    }

  };
}


/* ========================================================================== */
/* Error summary                                                              */
/* ========================================================================== */

function errorSummary(
  error
) {

  if (
    !error
  ) {

    return null;
  }


  return Object.freeze({

    code:
      error.code ||
      "UNKNOWN",

    source:
      error.source ||
      "",

    message:
      error.message ||
      "Unknown provider error"

  });
}


/* ========================================================================== */
/* Universe                                                                   */
/* ========================================================================== */

let universeRequest = null;
async function buildUniverse(minimumDate = null) {
  if (universeRequest) {
    const shared = await universeRequest;
    if (!minimumDate || (shared.dataDate >= minimumDate && !shared.meta.partial)) return shared;
  }
  universeRequest = buildUniverseSnapshot(minimumDate).finally(() => { universeRequest = null; });
  return universeRequest;
}
async function buildUniverseSnapshot(minimumDate = null) {

  const now =
    Date.now();


  if (
    universeCache.value &&
    (!minimumDate || (universeCache.value.dataDate >= minimumDate && !universeCache.value.meta.partial)) &&
    universeCache.expiresAt >
      now
  ) {

    return universeCache
      .value;
  }


  // Fetch the large quote payloads while the company dictionaries load.
  // Keep errors as values so a failed exchange cannot reject the other feed.
  const settled = promise => promise.then(payload => ({ payload }), error => ({ error }));
  const industries=loadIndustryMaps();
  const date=candidateTradingDates()[0];
  const daily=(async()=>{
    const [twse,tpex]=await Promise.all([loadTWSEForDate(date,industries.then(m=>m.twse)),loadTPEXForDate(date,industries.then(m=>m.tpex))]);
    return {mode:'latest-completed-trading-day',dataDate:isoDate(date),twse,tpex};
  })();
  const snapshots=Promise.all([industries,
    settled(requestJSON(TWSE_QUOTES_FALLBACK_URL,{source:'TWSE-STOCK-DAY-ALL'})),
    settled(requestJSON(TPEX_QUOTES_FALLBACK_URL,{source:'TPEX-OPENAPI-DAILY',timeoutMs:12000}))
  ]).then(([maps,twse,tpex])=>loadFallbackMarket(maps,{twse,tpex},!!minimumDate));
  const verified=p=>p.then(data=>{if(minimumDate&&data.dataDate<minimumDate)throw new TWRadarProviderError('Quote source is older than verified close.',{code:'TW_RADAR_OLDER_CLOSE'});return data;});
  // Attach rejection handlers before awaiting the slower dictionaries.
  const [industryMaps,winner]=await Promise.all([industries,settled(Promise.any([verified(daily),verified(snapshots)]))]);
  let marketData,primaryError=null;
  try {
    if(winner.error)throw winner.error;marketData=winner.payload;
  }catch(error){
    primaryError=error.errors?.[0]||error;
    try{marketData=await loadLatestCommonDailyMarket(industryMaps.twse,industryMaps.tpex,minimumDate);}
    catch(failure){failure.details={...failure.details,primaryCode:primaryError?.code,primarySource:primaryError?.source};throw failure;}
  }


  const twse =
    marketData.twse ||
    null;


  const tpex =
    marketData.tpex ||
    null;


  const baseRows =
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


  if (
    !baseRows.length
  ) {

    throw new TWRadarProviderError(
      "Taiwan Radar universe is empty.",
      {
        code:
          "TW_RADAR_EMPTY",

        source:
          "official-tw"
      }
    );
  }


  const radar =
    Object.freeze(
      await applyClassicToRows(baseRows, marketData.dataDate)
    );


  const result =
    Object.freeze({

      radar,

      dataDate:
        marketData.dataDate ||
        null,

      updatedAt:
        new Date()
          .toISOString(),

      meta:
        Object.freeze({

          provider:
            "official-tw",

          methodology:
            "ox-classic-structure-volume-v1",

          sourceMode:
            marketData.mode,

          freshnessPolicy:
            "latest-completed-common-trading-day",

          partial:
            !twse ||
            !tpex,

          total:
            radar.length,

          tierThresholds: Object.freeze({T1:82, T2:72, T3:'eligible-only'}),
          historicalIndicatorsConnected: radar.some(row => !!row.classic),

          institutionalByStockConnected:
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

          primarySourceError:
            errorSummary(
              primaryError
            ),

          industryErrors:
            Object.freeze({

              TWSE:
                errorSummary(
                  industryMaps
                    .errors
                    .TWSE
                ),

              TPEX:
                errorSummary(
                  industryMaps
                    .errors
                    .TPEX
                )

            })

        })

    });


  universeCache = {

    expiresAt:
      now +
      CACHE_TTL_MS,

    value:
      result

  };


  return result;
}


/* ========================================================================== */
/* Sorting                                                                    */
/* ========================================================================== */

function numericSort(
  a,
  b,
  key
) {

  const av =
    a[key];


  const bv =
    b[key];


  if (
    av ===
      null &&
    bv ===
      null
  ) {

    return 0;
  }


  if (
    av ===
      null
  ) {

    return 1;
  }


  if (
    bv ===
      null
  ) {

    return -1;
  }


  return bv -
    av;
}


function sortRadar(
  rows,
  sort
) {

  const output =
    [
      ...rows
    ];


  switch (
    textValue(
      sort
    )
  ) {

    case "changePct":

      output.sort(
        (
          a,
          b
        ) =>
          numericSort(
            a,
            b,
            "changePct"
          )
      );

      break;


    case "turnoverTwd":

      output.sort(
        (
          a,
          b
        ) =>
          numericSort(
            a,
            b,
            "turnoverTwd"
          )
      );

      break;


    case "volume":

      output.sort(
        (
          a,
          b
        ) =>
          numericSort(
            a,
            b,
            "volume"
          )
      );

      break;


    case "symbol":

      output.sort(
        (
          a,
          b
        ) =>
          a.symbol.localeCompare(
            b.symbol,
            "zh-TW"
          )
      );

      break;


    case "oxScore":

    default:

      output.sort(
        (
          a,
          b
        ) =>
          numericSort(
            a,
            b,
            "oxScore"
          )
      );

      break;
  }


  return output;
}


/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

export async function getOfficialTWRadar(
  {
    includeSurveillance = false,
    minimumDate = null,
    market =
      "ALL",

    tier =
      "ALL",

    sort =
      "oxScore",

    limit =
      500
  } = {}
) {

  const requestedMarket =
    normalizeMarket(
      market
    );


  const requestedTier =
    normalizeTier(
      tier
    );


  const requestedLimit =
    normalizeLimit(
      limit,
      500
    );


  const surveillanceRequest = includeSurveillance ? loadTWSurveillance() : null;
  const source =
    await buildUniverse(minimumDate);

  let surveillance = null;
  if (surveillanceRequest) {
    const feeds = await surveillanceRequest;
    // The range report already contains the quote session's complete daily
    // list. The single-day request is a fallback when the range is unavailable.
    const datedAttention = feeds.twseAttentionHistory?.ok ? null : await loadTWSEAttentionForDate(source.dataDate);
    surveillance = datedAttention?.ok ? { ...feeds, twseAttention: datedAttention } : feeds;
  }


  let rows =
    [
      ...source.radar
    ];


  if (
    requestedMarket !==
      "ALL"
  ) {

    rows =
      rows.filter(
        row =>
          row.market ===
          requestedMarket
      );
  }


  if (
    requestedTier !==
      "ALL"
  ) {

    rows =
      rows.filter(
        row =>
          row.tier ===
          requestedTier
      );
  }


  rows =
    sortRadar(
      rows,
      sort
    )
      .slice(
        0,
        requestedLimit
      );


  return Object.freeze({

    ...(surveillance ? buildTWSurveillance(surveillance, source.radar, { dataDate: source.dataDate }) : {}),

    radar:
      Object.freeze(
        rows
      ),

    dataDate:
      source.dataDate,

    updatedAt:
      source.updatedAt,

    meta:
      Object.freeze({

        ...source.meta,

        returned:
          rows.length,

        request:
          Object.freeze({

            market:
              requestedMarket,

            tier:
              requestedTier,

            sort:
              textValue(
                sort
              ) ||
              "oxScore",

            limit:
              requestedLimit

          })

      })

  });
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWRadarProvider =
  Object.freeze({

    id:
      "official-tw-radar",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getRadar:
      getOfficialTWRadar

  });
