const featureAPIGate = async () => true;
import { getOfficialTWResearch } from '../../../server/markets/tw/research-provider.js';
import { getHomeSection } from '../../../server/markets/tw/home-provider.js';
import { handleTWOutlook } from '../../../server/markets/tw/outlook.js';
import {
  getOfficialTWMarketPulse
} from "./providers/official.js";


import {
  getOfficialTWBreadth
} from "./providers/breadth.js";


import {
  getOfficialTWMoneyFlow
} from "./providers/money-flow.js";


import {
  getOfficialTWThemes
} from "./providers/themes.js";


import {
  getOfficialTWRadar
} from "./providers/radar.js";


import {
  getOfficialTWQuote,
  getOfficialTWQuotes
} from "./providers/quotes.js";


import {
  searchOfficialTWSymbols
} from "./providers/search.js";


import {
  getOfficialTWCandles
} from "./providers/candles.js";


import {
  getOfficialTWIndicators
} from "./providers/indicators.js";


/*
 * OX v4.0 Modular
 * Taiwan Market Backend Gateway
 *
 * Route:
 *
 * /api/v1/tw/:endpoint
 *
 *
 * Current implemented data:
 *
 * - Market Pulse
 * - Market Breadth
 * - Money Flow
 * - Themes
 * - Radar
 * - Quote
 * - Quotes
 * - Search
 * - Candles
 * - Indicators
 *
 *
 * IMPORTANT:
 *
 * - Browser only talks to this backend.
 * - Never expose provider secrets.
 * - Never manufacture unavailable data.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([]);


/* ========================================================================== */
/* Response helpers                                                           */
/* ========================================================================== */

function json(
  res,
  status,
  body
) {

  res.status(
    status
  );


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  return res.end(
    JSON.stringify(
      body
    )
  );
}


function ok(
  res,
  data,
  meta =
    undefined
) {

  return json(
    res,
    200,
    {

      ok:
        true,

      data,

      ...(
        meta
          ? {
              meta
            }
          : {}
      )

    }
  );
}


function fail(
  res,
  status,
  code,
  message,
  details =
    undefined
) {

  return json(
    res,
    status,
    {

      ok:
        false,

      error: {

        code,

        message,

        ...(
          details
            ? {
                details
              }
            : {}
        )

      }

    }
  );
}


/* ========================================================================== */
/* CORS                                                                       */
/* ========================================================================== */

function getAllowedOrigins() {

  const extra =
    String(
      process.env
        .OX_ALLOWED_ORIGINS ||
      ""
    )
      .split(
        ","
      )
      .map(
        value =>
          value.trim()
      )
      .filter(
        Boolean
      );


  return [
    ...new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...extra
    ])
  ];
}


function applyCors(
  req,
  res
) {

  const origin =
    req.headers
      .origin;


  if (
    !origin
  ) {

    return true;
  }


  const allowed =
    getAllowedOrigins();


  if (
    !allowed.includes(
      origin
    )
  ) {

    return false;
  }


  res.setHeader(
    "Access-Control-Allow-Origin",
    origin
  );


  res.setHeader(
    "Vary",
    "Origin"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );


  return true;
}


/* ========================================================================== */
/* Parameters                                                                 */
/* ========================================================================== */

function stringParam(
  value,
  fallback =
    ""
) {

  if (
    Array.isArray(
      value
    )
  ) {

    return String(
      value[0] ||
      fallback
    ).trim();
  }


  return String(
    value ===
      undefined ||
    value ===
      null
      ? fallback
      : value
  ).trim();
}


function numberParam(
  value,
  fallback,
  {
    min =
      1,

    max =
      100
  } = {}
) {

  const raw =
    Array.isArray(
      value
    )
      ? value[0]
      : value;


  const parsed =
    Number(
      raw
    );


  if (
    !Number.isFinite(
      parsed
    )
  ) {

    return fallback;
  }


  return Math.max(
    min,
    Math.min(
      max,
      Math.floor(
        parsed
      )
    )
  );
}


function booleanParam(
  value,
  fallback =
    false
) {

  const raw =
    Array.isArray(
      value
    )
      ? value[0]
      : value;


  if (
    raw ===
      undefined ||
    raw ===
      null ||
    raw ===
      ""
  ) {

    return fallback;
  }


  const normalized =
    String(
      raw
    )
      .trim()
      .toLowerCase();


  if (
    [
      "true",
      "1",
      "yes",
      "on"
    ].includes(
      normalized
    )
  ) {

    return true;
  }


  if (
    [
      "false",
      "0",
      "no",
      "off"
    ].includes(
      normalized
    )
  ) {

    return false;
  }


  return fallback;
}


/* ========================================================================== */
/* Cache                                                                      */
/* ========================================================================== */

function setShortCache(
  res,
  seconds =
    10
) {

  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${seconds}, stale-while-revalidate=${Math.max(
      10,
      seconds * 2
    )}`
  );
}


/* ========================================================================== */
/* Health                                                                     */
/* ========================================================================== */

async function handleHealth(
  req,
  res
) {

  return ok(
    res,
    {

      service:
        "ox-tw-market-data",

      status:
        "ready",

      market:
        "tw",

      provider:
        "official-tw",

      upstreamConfigured:
        true,

      sources:
        Object.freeze([
          "TWSE",
          "TPEx"
        ]),

      implementedEndpoints:
        Object.freeze([
          "health",
          "market-pulse",
          "breadth",
          "money-flow",
          "themes",
          "radar",
          "quote",
          "quotes",
          "search",
          "candles",
          "indicators"
        ]),

      pendingEndpoints:
        Object.freeze([]),

      timestamp:
        new Date()
          .toISOString()

    },
    {

      contract:
        "ox-tw-market-data-v1",

      version:
        1

    }
  );
}


/* ========================================================================== */
/* Market Pulse                                                               */
/* ========================================================================== */

async function handleMarketPulse(
  req,
  res
) {

  const data =
    await getOfficialTWMarketPulse();


  setShortCache(
    res,
    60
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      realtime:
        false

    }
  );
}


/* ========================================================================== */
/* Market Breadth                                                             */
/* ========================================================================== */

async function handleBreadth(
  req,
  res
) {

  const requestedMarket =
    stringParam(
      req.query
        .market,
      "ALL"
    )
      .toUpperCase();


  const data =
    await getOfficialTWBreadth();


  setShortCache(
    res,
    60
  );


  if (
    requestedMarket ===
      "TWSE" ||
    requestedMarket ===
      "TPEX"
  ) {

    const marketData =
      data
        ?.markets
        ?.[requestedMarket] ||
      null;


    if (
      !marketData
    ) {

      return fail(
        res,
        503,
        "TW_BREADTH_MARKET_UNAVAILABLE",
        `${requestedMarket} breadth data is currently unavailable.`
      );
    }


    return ok(
      res,
      {

        breadth: {

          advancers:
            marketData
              .advancers ??
            null,

          decliners:
            marketData
              .decliners ??
            null,

          unchanged:
            marketData
              .unchanged ??
            null,

          limitUp:
            marketData
              .limitUp ??
            null,

          limitDown:
            marketData
              .limitDown ??
            null,

          newHigh20:
            null,

          newLow20:
            null,

          surgeCount:
            null,

          turnoverTwd:
            null

        },

        market:
          marketData,

        updatedAt:
          data
            .updatedAt,

        meta:
          data
            .meta

      },
      {

        provider:
          "official-tw",

        market:
          requestedMarket,

        realtime:
          false

      }
    );
  }


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      market:
        "ALL",

      realtime:
        false

    }
  );
}


/* ========================================================================== */
/* Money Flow                                                                 */
/* ========================================================================== */

async function handleMoneyFlow(
  req,
  res
) {

  const requestedMarket =
    stringParam(
      req.query
        .market,
      "ALL"
    )
      .toUpperCase();


  const data =
    await getOfficialTWMoneyFlow();


  setShortCache(
    res,
    60
  );


  if (
    requestedMarket ===
      "TWSE" ||
    requestedMarket ===
      "TPEX"
  ) {

    const marketData =
      data
        ?.markets
        ?.[requestedMarket] ||
      null;


    if (
      !marketData
    ) {

      return fail(
        res,
        503,
        "TW_MONEY_FLOW_MARKET_UNAVAILABLE",
        `${requestedMarket} money flow data is currently unavailable.`
      );
    }


    return ok(
      res,
      {

        moneyFlow: {

          foreignNetTwd:
            marketData
              .foreignNetTwd ??
            null,

          trustNetTwd:
            marketData
              .trustNetTwd ??
            null,

          dealerNetTwd:
            marketData
              .dealerNetTwd ??
            null,

          marginChangeTwd:
            null,

          bigOrderBias:
            ""

        },

        market:
          marketData,

        dataDate:
          marketData
            .dataDate ??
          null,

        updatedAt:
          data
            .updatedAt,

        meta:
          data
            .meta

      },
      {

        provider:
          "official-tw",

        market:
          requestedMarket,

        realtime:
          false

      }
    );
  }


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      market:
        "ALL",

      realtime:
        false

    }
  );
}


/* ========================================================================== */
/* Themes                                                                     */
/* ========================================================================== */

async function handleThemes(
  req,
  res
) {

  const limit =
    numberParam(
      req.query
        .limit,
      30,
      {
        min:
          1,

        max:
          100
      }
    );


  const data =
    await getOfficialTWThemes(
      {
        limit
      }
    );


  setShortCache(
    res,
    120
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      methodology:
        "official-industry-constituent-average",

      realtime:
        false,

      limit

    }
  );
}


/* ========================================================================== */
/* Radar                                                                      */
/* ========================================================================== */

async function handleRadar(
  req,
  res
) {

  const market =
    stringParam(
      req.query
        .market,
      "ALL"
    )
      .toUpperCase();


  const tier =
    stringParam(
      req.query
        .tier,
      "ALL"
    )
      .toUpperCase();


  const sort =
    stringParam(
      req.query
        .sort,
      "oxScore"
    );


  const limit =
    numberParam(
      req.query
        .limit,
      500,
      {
        min:
          1,

        max:
          2000
      }
    );


  const data =
    await getOfficialTWRadar(
      {
        includeSurveillance: true,
        market,
        tier,
        sort,
        limit
      }
    );


  setShortCache(
    res,
    60
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      methodology:
        "daily-relative-strength-activity-v1",

      realtime:
        false,

      market,

      tier,

      sort,

      limit

    }
  );
}


/* ========================================================================== */
/* Quote                                                                      */
/* ========================================================================== */

async function handleQuote(
  req,
  res
) {

  const symbol =
    stringParam(
      req.query
        .symbol
    );


  if (
    !symbol
  ) {

    return fail(
      res,
      400,
      "TW_QUOTE_SYMBOL_REQUIRED",
      "Taiwan stock symbol is required."
    );
  }


  const data =
    await getOfficialTWQuote(
      symbol
    );


  setShortCache(
    res,
    60
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      realtime:
        false,

      snapshot:
        "daily"

    }
  );
}


/* ========================================================================== */
/* Quotes                                                                     */
/* ========================================================================== */

async function handleQuotes(
  req,
  res
) {

  const symbols =
    stringParam(
      req.query
        .symbols
    );


  if (
    !symbols
  ) {

    return fail(
      res,
      400,
      "TW_QUOTES_SYMBOLS_REQUIRED",
      "At least one Taiwan stock symbol is required."
    );
  }


  const data =
    await getOfficialTWQuotes(
      symbols
    );


  setShortCache(
    res,
    60
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      realtime:
        false,

      snapshot:
        "daily"

    }
  );
}


/* ========================================================================== */
/* Search                                                                     */
/* ========================================================================== */

async function handleSearch(
  req,
  res
) {

  const query =
    stringParam(
      req.query
        .q
    );


  const market =
    stringParam(
      req.query
        .market,
      "ALL"
    )
      .toUpperCase();


  const limit =
    numberParam(
      req.query
        .limit,
      20,
      {
        min:
          1,

        max:
          100
      }
    );


  if (
    !query
  ) {

    setShortCache(
      res,
      60
    );


    return ok(
      res,
      [],
      {

        provider:
          "official-tw",

        market,

        limit

      }
    );
  }


  const data =
    await searchOfficialTWSymbols(
      query,
      {
        market,
        limit
      }
    );


  setShortCache(
    res,
    120
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      realtime:
        false,

      market,

      query,

      limit

    }
  );
}


/* ========================================================================== */
/* Candles                                                                    */
/* ========================================================================== */

async function handleCandles(
  req,
  res
) {

  const symbol =
    stringParam(
      req.query
        .symbol
    );


  if (
    !symbol
  ) {

    return fail(
      res,
      400,
      "TW_CANDLES_SYMBOL_REQUIRED",
      "Taiwan stock symbol is required."
    );
  }


  const interval =
    stringParam(
      req.query
        .interval,
      "1D"
    );


  const range =
    stringParam(
      req.query
        .range,
      "6M"
    );


  const from =
    stringParam(
      req.query
        .from
    );


  const to =
    stringParam(
      req.query
        .to
    );


  const limit =
    req.query
      .limit !==
      undefined
      ? numberParam(
          req.query
            .limit,
          null,
          {
            min:
              1,

            max:
              1000
          }
        )
      : null;


  const adjusted =
    booleanParam(
      req.query
        .adjusted,
      true
    );


  const data =
    await getOfficialTWCandles(
      symbol,
      {
        interval,
        range,

        from:
          from ||
          null,

        to:
          to ||
          null,

        limit,
        adjusted,
        history: booleanParam(req.query.history,false)
      }
    );


  setShortCache(
    res,
    300
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      historical:
        true,

      realtime:
        false,

      interval:
        "1D"

    }
  );
}


/* ========================================================================== */
/* Indicators                                                                 */
/* ========================================================================== */

async function handleIndicators(
  req,
  res
) {

  const symbol =
    stringParam(
      req.query
        .symbol
    );


  /*
   * Frontend sends ids as a comma-separated
   * query string, but the provider also
   * accepts arrays.
   */
  const ids =
    req.query
      .ids ||
    [];


  const data =
    await getOfficialTWIndicators(
      {

        symbol:
          symbol ||
          null,

        ids

      }
    );


  setShortCache(
    res,
    symbol
      ? 120
      : 60
  );


  return ok(
    res,
    data,
    {

      provider:
        "official-tw",

      methodology:
        "official-data-derived-indicators-v1",

      realtime:
        false,

      symbol:
        symbol ||
        null

    }
  );
}


/* ========================================================================== */
/* Main handler                                                               */
/* ========================================================================== */

export async function handleTWRequest(
  req,
  res,
  accessGate = featureAPIGate
) {

  if (stringParam(req.query?.endpoint).toLowerCase() === 'outlook') {
    if (!(await accessGate(req,res,'outlook'))) return;
    return handleTWOutlook(req, res);
  }

  if (
    !applyCors(
      req,
      res
    )
  ) {

    return fail(
      res,
      403,
      "ORIGIN_NOT_ALLOWED",
      "This origin is not allowed to access the OX TW market API."
    );
  }


  if (
    req.method ===
      "OPTIONS"
  ) {

    res.status(
      204
    );


    return res.end();
  }


  if (
    req.method !==
      "GET"
  ) {

    return fail(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      "Only GET requests are supported."
    );
  }


  const endpoint =
    stringParam(
      req.query
        .endpoint
    )
      .toLowerCase();


  res.setHeader("X-OX-Revision",process.env.VERCEL_GIT_COMMIT_SHA||"local-recovery20");
  const requestStarted=Date.now();
  if (!(await accessGate(req,res,endpoint))) return;

  try {

    switch (
      endpoint
    ) {


      case "research": {
        const refresh=booleanParam(req.query.refresh,false);
        const data = await getOfficialTWResearch({refresh});
        if(refresh)res.setHeader('Cache-Control','no-store');else setShortCache(res, 300);
        return ok(res, data, { realtime: false, provider: "official-tw" });
      }

      case "etf": {
        const action=stringParam(req.query.action||'catalog'), refresh=booleanParam(req.query.refresh,false);
        const etf=await import('../../../server/markets/tw/etf.js');
        res.setHeader('Cache-Control','no-store');
        if(action==='catalog')return ok(res,await etf.getCatalog({refresh}),{realtime:false});
        if(action==='offering')return ok(res,await etf.getOfferings({refresh}),{realtime:false});
        if(action==='radar')return ok(res,await etf.getHotStocks({refresh}),{realtime:false});
        const symbols=stringParam(req.query.symbols||req.query.symbol).split(',').filter(Boolean);
        if(!symbols.length||symbols.length>8||symbols.some(s=>!/^00\d{2,4}[A-Z]?$/.test(s)))return fail(res,400,'INVALID_ETF_SYMBOL','請選擇 1–8 檔有效 ETF。');
        if(action==='history')return ok(res,await etf.batchHistory([...new Set(symbols)],{refresh}),{realtime:false});
        if(action==='holdings'&&symbols.length===1)return ok(res,await etf.getHoldings(symbols[0],{refresh}),{realtime:false});
        return fail(res,400,'INVALID_ETF_ACTION','無效的 ETF 查詢。');
      }

      case "home": {
        const section=stringParam(req.query.section||'core');
        if(!['core','briefing','night'].includes(section))return fail(res,400,'INVALID_SECTION','Unknown Taiwan home section.');
        res.setHeader('Cache-Control','no-store');
        const data=await getHomeSection(section,{refresh:booleanParam(req.query.refresh,false)});
        return ok(res,data,{realtime:false,provider:'ox-tw-home',timezone:'Asia/Taipei'});
      }

      case "health":

        return await handleHealth(
          req,
          res
        );


      case "market-pulse":

        return await handleMarketPulse(
          req,
          res
        );


      case "breadth":

        return await handleBreadth(
          req,
          res
        );


      case "money-flow":

        return await handleMoneyFlow(
          req,
          res
        );


      case "themes":

        return await handleThemes(
          req,
          res
        );


      case "radar":

        return await handleRadar(
          req,
          res
        );


      case "quote":

        return await handleQuote(
          req,
          res
        );


      case "quotes":

        return await handleQuotes(
          req,
          res
        );


      case "search":

        return await handleSearch(
          req,
          res
        );


      case "candles":

        return await handleCandles(
          req,
          res
        );


      case "indicators":

        return await handleIndicators(
          req,
          res
        );


      default:

        return fail(
          res,
          404,
          "ENDPOINT_NOT_FOUND",
          `Unknown TW market endpoint: ${
            endpoint ||
            "(empty)"
          }`
        );

    }

  } catch (
    error
  ) {

    console.error(
      "[OX TW API]",
      {

        endpoint,
        source:error?.source,
        upstreamStatus:error?.status,
        elapsedMs:Date.now()-requestStarted,
        attempts:error?.details?.attempts,

        code:
          error?.code ||
          "UNKNOWN",

        message:
          error?.message ||
          "Unknown error",
        failedMonths: error?.details?.failures?.map(({month,code})=>({month,code}))

      }
    );


    const errorCode =
      String(
        error?.code ||
        ""
      );


    /*
     * Invalid input.
     */
    if (
      errorCode ===
        "TW_QUOTE_SYMBOL_REQUIRED" ||
      errorCode ===
        "TW_QUOTES_SYMBOLS_REQUIRED" ||
      errorCode ===
        "TW_QUOTE_INVALID_SYMBOL" ||
      errorCode ===
        "TW_QUOTES_TOO_MANY_SYMBOLS" ||
      errorCode ===
        "TW_CANDLES_SYMBOL_REQUIRED" ||
      errorCode ===
        "TW_CANDLES_INVALID_SYMBOL" ||
      errorCode ===
        "TW_CANDLES_INTERVAL_NOT_SUPPORTED" ||
      errorCode ===
        "TW_CANDLES_INVALID_RANGE" ||
      errorCode ===
        "TW_CANDLES_RANGE_TOO_LARGE"
    ) {

      return fail(
        res,
        400,
        errorCode,
        error?.message ||
        "Invalid Taiwan market request."
      );
    }


    /*
     * Symbol / candle data not found.
     */
    if (
      errorCode ===
        "TW_QUOTE_NOT_FOUND" ||
      errorCode ===
        "TW_CANDLES_NOT_FOUND"
    ) {

      return fail(
        res,
        404,
        errorCode,
        error?.message ||
        "Taiwan market data was not found."
      );
    }


    /*
     * Official Taiwan upstream failure.
     */
    if (
      errorCode.startsWith(
        "TW_"
      ) ||
      errorCode.startsWith(
        "TWSE_"
      ) ||
      errorCode.startsWith(
        "TPEX_"
      )
    ) {

      return fail(
        res,
        502,
        "TW_DATA_UPSTREAM_ERROR",
        "Unable to retrieve Taiwan official market data.",
        {endpoint,providerCode:errorCode,source:String(error?.source||"official-tw").slice(0,80),upstreamStatus:Number(error?.status)||0,elapsedMs:Date.now()-requestStarted,attempts:error?.details?.attempts,primaryCode:error?.details?.primaryCode,primarySource:error?.details?.primarySource}
      );
    }


    return fail(
      res,
      500,
      "TW_DATA_SERVER_ERROR",
      "Unable to process the Taiwan market data request."
    );

  }
}

export default function handler(req,res){return handleTWRequest(req,res);}
