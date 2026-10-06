import {
  TW_MODULE_CONFIG
} from "./config.js";
import { withDeadline } from '../../components/resource-deadline.js';
import { retryTWRequest } from './recovery.js?v=20261005-recovery20';


/*
 * OX v4.0 Modular
 * Taiwan Market Data Provider
 *
 * Browser-side TW market data client.
 *
 *
 * Architecture:
 *
 * GitHub Pages
 *      ↓
 * TW Provider
 *      ↓
 * OX Backend
 *      ↓
 * TWSE / TPEX / Fugle /
 * FinMind / Broker / Other Provider
 *
 *
 * IMPORTANT:
 *
 * - API secrets NEVER belong here.
 * - This file does NOT know
 *   which final Taiwan provider
 *   will be selected.
 * - Provider-specific formats
 *   must be normalized by
 *   TW Backend / TW Engine.
 *
 *
 * Frontend contract:
 *
 * /api/v1/tw/health
 *
 * /api/v1/tw/market-pulse
 * /api/v1/tw/breadth
 * /api/v1/tw/money-flow
 * /api/v1/tw/themes
 * /api/v1/tw/radar
 * /api/v1/tw/indicators
 *
 * /api/v1/tw/quote
 * /api/v1/tw/quotes
 * /api/v1/tw/candles
 * /api/v1/tw/search
 */


const CONTRACT_VERSION =
  "1";


const API_PREFIX =
  `/v${CONTRACT_VERSION}/tw`;


const DEFAULT_TIMEOUT_MS =
  12000;


/*
 * No production API is hard-coded yet.
 *
 * This is intentional.
 *
 * Taiwan backend is not selected yet,
 * therefore frontend must stay
 * honestly unconfigured.
 */
const DEFAULT_API_BASE = typeof location !== "undefined" ? `${location.origin}/api` : "";



/*
 * Runtime configuration priority:
 *
 * 1. configure()
 * 2. window.OX_TW_DATA_API_BASE
 * 3. <meta name="ox-tw-data-api-base">
 * 4. localStorage
 * 5. DEFAULT_API_BASE
 */

const STORAGE_KEY =
  "ox-tw-independent:data-api-base";


const META_NAME =
  "ox-tw-data-api-base";


const GLOBAL_KEY =
  "OX_TW_DATA_API_BASE";


let runtimeApiBase =
  "";


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWDataProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_DATA_ERROR",

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
      "TWDataProviderError";


    this.code =
      code;


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
/* API Base                                                                   */
/* ========================================================================== */

function normalizeApiBase(
  value
) {

  if (
    typeof value !==
    "string"
  ) {
    return "";
  }


  const trimmed =
    value
      .trim()
      .replace(
        /\/+$/,
        ""
      );


  if (
    !trimmed
  ) {
    return "";
  }


  let parsed;


  try {

    parsed =
      new URL(
        trimmed
      );

  } catch {

    throw new TWDataProviderError(
      "TW market data API base must be an absolute URL.",
      {
        code:
          "TW_DATA_INVALID_API_BASE"
      }
    );
  }


  if (
    ![
      "http:",
      "https:"
    ].includes(
      parsed.protocol
    )
  ) {

    throw new TWDataProviderError(
      "TW market data API base must use HTTP or HTTPS.",
      {
        code:
          "TW_DATA_INVALID_API_BASE"
      }
    );
  }


  /*
   * Prevent browser mixed-content failure.
   */
  if (
    typeof location !==
      "undefined" &&

    location.protocol ===
      "https:" &&

    parsed.protocol !==
      "https:" &&

    ![
      "localhost",
      "127.0.0.1"
    ].includes(
      parsed.hostname
    )
  ) {

    throw new TWDataProviderError(
      "TW market data API must use HTTPS when OX is running over HTTPS.",
      {
        code:
          "TW_DATA_INSECURE_API_BASE"
      }
    );
  }


  return trimmed;
}


function readGlobalApiBase() {

  try {

    const value =
      globalThis
        ?.[GLOBAL_KEY];


    return typeof value ===
      "string"
      ? value
      : "";

  } catch {

    return "";
  }
}


function readMetaApiBase() {

  if (
    typeof document ===
    "undefined"
  ) {
    return "";
  }


  try {

    return (
      document
        .querySelector(
          `meta[name="${META_NAME}"]`
        )
        ?.getAttribute(
          "content"
        ) ||
      ""
    );

  } catch {

    return "";
  }
}


function readStoredApiBase() {

  if (
    typeof localStorage ===
    "undefined"
  ) {
    return "";
  }


  try {

    return (
      localStorage.getItem(
        STORAGE_KEY
      ) ||
      ""
    );

  } catch {

    return "";
  }
}


export function getTWApiBase() {

  const candidate =
    runtimeApiBase ||
    readGlobalApiBase() ||
    readMetaApiBase() ||
    readStoredApiBase() ||
    DEFAULT_API_BASE;


  if (
    !candidate
  ) {
    return "";
  }


  return normalizeApiBase(
    candidate
  );
}


/* ========================================================================== */
/* Validation                                                                 */
/* ========================================================================== */

function normalizeSymbol(
  value
) {

  const symbol =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !symbol
  ) {

    throw new TWDataProviderError(
      "A Taiwan stock symbol is required.",
      {
        code:
          "TW_DATA_SYMBOL_REQUIRED"
      }
    );
  }


  /*
   * Supports:
   *
   * 2330
   * 0050
   * 006208
   * 6488
   *
   * and future provider aliases.
   */
  if (
    symbol.length >
      32
  ) {

    throw new TWDataProviderError(
      `Invalid Taiwan symbol: ${symbol}`,
      {
        code:
          "TW_DATA_INVALID_SYMBOL"
      }
    );
  }


  if (
    /[\s,?&#=]/.test(
      symbol
    )
  ) {

    throw new TWDataProviderError(
      `Invalid Taiwan symbol: ${symbol}`,
      {
        code:
          "TW_DATA_INVALID_SYMBOL"
      }
    );
  }


  return symbol;
}


function normalizeSymbols(
  values
) {

  const source =
    Array.isArray(
      values
    )
      ? values
      : [
          values
        ];


  const symbols =
    [
      ...new Set(
        source
          .filter(
            value =>
              value !==
                null &&
              value !==
                undefined &&
              value !==
                ""
          )
          .map(
            normalizeSymbol
          )
      )
    ];


  if (
    !symbols.length
  ) {

    throw new TWDataProviderError(
      "At least one Taiwan stock symbol is required.",
      {
        code:
          "TW_DATA_SYMBOLS_REQUIRED"
      }
    );
  }


  return symbols;
}


function normalizeLimit(
  value,
  fallback,
  max =
    2000
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


  return Math.max(
    1,
    Math.min(
      max,
      Math.floor(
        number
      )
    )
  );
}


/* ========================================================================== */
/* URL                                                                        */
/* ========================================================================== */

function toQueryValue(
  value
) {

  if (
    value instanceof
    Date
  ) {

    return value
      .toISOString();
  }


  if (
    Array.isArray(
      value
    )
  ) {

    return value
      .join(
        ","
      );
  }


  if (
    typeof value ===
    "boolean"
  ) {

    return value
      ? "true"
      : "false";
  }


  return String(
    value
  );
}


function buildURL(
  endpoint,
  params = {}
) {

  const base =
    getTWApiBase();


  if (
    !base
  ) {

    throw new TWDataProviderError(
      "TW market data backend has not been configured yet.",
      {
        code:
          "TW_DATA_API_UNCONFIGURED"
      }
    );
  }


  const cleanEndpoint =
    String(
      endpoint ||
      ""
    )
      .replace(
        /^\/+/,
        ""
      )
      .replace(
        /\/+$/,
        ""
      );


  const url =
    new URL(
      `${base}${API_PREFIX}/${cleanEndpoint}`
    );


  Object
    .entries(
      params
    )
    .forEach(
      (
        [
          key,
          value
        ]
      ) => {

        if (
          value ===
            undefined ||
          value ===
            null ||
          value ===
            ""
        ) {
          return;
        }


        url.searchParams.set(
          key,
          toQueryValue(
            value
          )
        );

      }
    );


  return url;
}


/* ========================================================================== */
/* Response                                                                   */
/* ========================================================================== */

async function parseResponse(
  response
) {

  const text =
    await response
      .text();


  if (
    !text
  ) {
    return null;
  }


  try {

    return JSON.parse(
      text
    );

  } catch {

    throw new TWDataProviderError(
      "TW market data backend returned invalid JSON.",
      {
        code:
          "TW_DATA_INVALID_RESPONSE",

        status:
          response.status
      }
    );
  }
}


function extractErrorMessage(
  payload,
  fallback
) {

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {

    return fallback;
  }


  if (
    typeof payload.message ===
    "string"
  ) {

    return payload.message;
  }


  if (
    typeof payload.error ===
    "string"
  ) {

    return payload.error;
  }


  if (
    payload.error &&
    typeof payload
      .error
      .message ===
      "string"
  ) {

    return payload
      .error
      .message;
  }


  return fallback;
}


function unwrapPayload(
  payload
) {

  if (
    payload &&
    typeof payload ===
      "object" &&
    payload.ok ===
      false
  ) {

    throw new TWDataProviderError(
      extractErrorMessage(
        payload,
        "TW market data request failed."
      ),
      {
        code:
          payload
            ?.error
            ?.code ||
          payload
            ?.code ||
          "TW_DATA_BACKEND_ERROR",

        details:
          payload
      }
    );
  }


  if (
    payload &&
    typeof payload ===
      "object" &&
    Object
      .prototype
      .hasOwnProperty
      .call(
        payload,
        "data"
      )
  ) {

    return payload.data;
  }


  return payload;
}


/* ========================================================================== */
/* Request                                                                    */
/* ========================================================================== */

function request(endpoint, options = {}) {
  const started=Date.now(),budget=options.params?.history?45000:28000;
  return retryTWRequest(() => requestOnce(endpoint, {...options,timeoutMs:Math.max(1000,Math.min(options.timeoutMs||DEFAULT_TIMEOUT_MS,budget-(Date.now()-started)))}), { signal: options.signal, ...(options.params?.history ? {delays:[2000,5000,10000]} : {}), budgetMs:budget });
}

async function requestOnce(
  endpoint,
  {
    params =
      {},

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  if (
    typeof fetch !==
    "function"
  ) {

    throw new TWDataProviderError(
      "Fetch API is not available in this environment.",
      {
        code:
          "TW_DATA_FETCH_UNAVAILABLE"
      }
    );
  }


  const url =
    buildURL(
      endpoint,
      params
    );


  const controller =
    new AbortController();


  let timedOut =
    false;


  const onExternalAbort =
    () => {

      controller.abort();

    };


  if (
    signal
  ) {

    if (
      signal.aborted
    ) {

      controller.abort();

    } else {

      signal.addEventListener(
        "abort",
        onExternalAbort,
        {
          once:
            true
        }
      );
    }
  }


  const timer =
    setTimeout(
      () => {

        timedOut =
          true;

        controller.abort();

      },
      Math.max(
        1000,
        Number(
          timeoutMs
        ) ||
        DEFAULT_TIMEOUT_MS
      )
    );


  try {

    const [response,payload]=await withDeadline(async deadlineSignal=>{
      const cancel=()=>controller.abort();deadlineSignal.addEventListener('abort',cancel,{once:true});
      try {
      const response =
      await fetch(
        url.toString(),
        {
          method:
            "GET",

          mode:
            "cors",

          credentials:
            typeof window !== "undefined" && url.origin === window.location.origin
              ? "same-origin" : "omit",

          cache:
            "no-store",

          headers: {
            Accept:
              "application/json"
          },

          signal:
            controller
              .signal
        }
      );


      const payload =
      await parseResponse(
        response
      );

        return [response,payload];
      }finally{deadlineSignal.removeEventListener('abort',cancel);}
    },Math.max(1000,Number(timeoutMs)||DEFAULT_TIMEOUT_MS),'台股資料讀取逾時',{signal});


    if (
      !response.ok
    ) {

      throw new TWDataProviderError(
        extractErrorMessage(
          payload,
          `TW market data request failed with HTTP ${response.status}.`
        ),
        {
          code:
            "TW_DATA_HTTP_ERROR",

          status:
            response.status,

          details:
            payload
        }
      );
    }


    return unwrapPayload(
      payload
    );

  } catch (
    error
  ) {

    if (
      error instanceof
      TWDataProviderError
    ) {

      throw error;
    }


    if (
      timedOut || error?.name === "TimeoutError"
    ) {

      throw new TWDataProviderError(
        "TW market data request timed out.",
        {
          code:
            "TW_DATA_TIMEOUT",

          cause:
            error
        }
      );
    }


    if (
      signal
        ?.aborted
    ) {

      throw new TWDataProviderError(
        "TW market data request was cancelled.",
        {
          code:
            "TW_DATA_ABORTED",

          cause:
            error
        }
      );
    }


    throw new TWDataProviderError(
      "Unable to reach the TW market data backend.",
      {
        code:
          "TW_DATA_NETWORK_ERROR",

        cause:
          error
      }
    );

  } finally {

    clearTimeout(
      timer
    );


    if (
      signal
    ) {

      signal.removeEventListener(
        "abort",
        onExternalAbort
      );
    }
  }
}


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

function configure(
  {
    apiBase =
      "",

    persist =
      false
  } = {}
) {

  runtimeApiBase =
    normalizeApiBase(
      apiBase
    );


  if (
    persist &&
    typeof localStorage !==
      "undefined"
  ) {

    try {

      if (
        runtimeApiBase
      ) {

        localStorage.setItem(
          STORAGE_KEY,
          runtimeApiBase
        );

      } else {

        localStorage.removeItem(
          STORAGE_KEY
        );
      }

    } catch {

      /*
       * Storage failure should
       * never break provider.
       */
    }
  }


  return Object.freeze({

    apiBase:
      getTWApiBase(),

    available:
      Boolean(
        getTWApiBase()
      )

  });
}


function clearConfiguration(
  {
    clearStored =
      false
  } = {}
) {

  runtimeApiBase =
    "";


  if (
    clearStored &&
    typeof localStorage !==
      "undefined"
  ) {

    try {

      localStorage.removeItem(
        STORAGE_KEY
      );

    } catch {

      /*
       * Ignore storage failure.
       */
    }
  }
}


/* ========================================================================== */
/* Health                                                                     */
/* ========================================================================== */

function health(
  options =
    {}
) {

  return request(
    "health",
    options
  );
}


/* ========================================================================== */
/* Quotes                                                                     */
/* ========================================================================== */

function getQuote(
  symbol,
  options =
    {}
) {

  return request(
    "quote",
    {
      ...options,

      params: {
        ...options.params,

        symbol:
          normalizeSymbol(
            symbol
          )
      }
    }
  );
}


function getQuotes(
  symbols,
  options =
    {}
) {

  return request(
    "quotes",
    {
      ...options,

      params: {
        ...options.params,

        symbols:
          normalizeSymbols(
            symbols
          )
      }
    }
  );
}


/* ========================================================================== */
/* Candles                                                                    */
/* ========================================================================== */

function getCandles(
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

    history = false,

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "candles",
    {
      signal,
      timeoutMs,

      params: {

        symbol:
          normalizeSymbol(
            symbol
          ),

        interval,

        range,

        from,

        to,

        limit,

        adjusted,
        history
      }
    }
  );
}


/* ========================================================================== */
/* Home data                                                                  */
/* ========================================================================== */

function getMarketPulse(
  {
    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "market-pulse",
    {
      signal,
      timeoutMs
    }
  );
}


function getBreadth(
  {
    market =
      "ALL",

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "breadth",
    {
      signal,
      timeoutMs,

      params: {
        market
      }
    }
  );
}


function getMoneyFlow(
  {
    market =
      "ALL",

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "money-flow",
    {
      signal,
      timeoutMs,

      params: {
        market
      }
    }
  );
}


function getThemes(
  {
    limit =
      20,

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "themes",
    {
      signal,
      timeoutMs,

      params: {

        limit:
          normalizeLimit(
            limit,
            20,
            100
          )

      }
    }
  );
}


/* ========================================================================== */
/* Radar                                                                      */
/* ========================================================================== */

function getRadar(
  {
    market =
      "ALL",

    limit =
      500,

    tier =
      "ALL",

    sort =
      "oxScore",

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "radar",
    {
      signal,
      timeoutMs,

      params: {

        market,

        tier,

        sort,

        limit:
          normalizeLimit(
            limit,
            500,
            2000
          )

      }
    }
  );
}


/* ========================================================================== */
/* Indicators                                                                 */
/* ========================================================================== */

function getIndicators(
  {
    symbol =
      null,

    ids =
      [],

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  return request(
    "indicators",
    {
      signal,
      timeoutMs,

      params: {

        symbol:
          symbol
            ? normalizeSymbol(
                symbol
              )
            : null,

        ids:
          Array.isArray(
            ids
          )
            ? ids
            : []

      }
    }
  );
}


/* ========================================================================== */
/* Search                                                                     */
/* ========================================================================== */

function searchSymbols(
  query,
  {
    limit =
      20,

    market =
      "ALL",

    signal =
      null,

    timeoutMs =
      DEFAULT_TIMEOUT_MS
  } = {}
) {

  const q =
    String(
      query ||
      ""
    )
      .trim();


  if (
    !q
  ) {

    return Promise.resolve(
      []
    );
  }


  return request(
    "search",
    {
      signal,
      timeoutMs,

      params: {

        q,

        market,

        limit:
          normalizeLimit(
            limit,
            20,
            100
          )

      }
    }
  );
}


/* ========================================================================== */
/* Provider                                                                   */
/* ========================================================================== */

export const twProvider =
  Object.freeze({

    /*
     * Keep existing module contract.
     */
    id:
      TW_MODULE_CONFIG
        .provider,

    market:
      "tw",

    contract:
      "ox-tw-market-data-v1",

    contractVersion:
      CONTRACT_VERSION,

    transport:
      "server-proxy",


    /*
     * Some possible Taiwan providers
     * require API credentials.
     *
     * They belong ONLY in backend.
     */
    secretRequired:
      true,

    frontendSecretAllowed:
      false,

    requiresServerProxy:
      true,


    /*
     * Provider is considered available
     * only when a backend URL exists.
     */
    get available() {

      try {

        return Boolean(
          getTWApiBase()
        );

      } catch {

        return false;
      }
    },


    get apiBase() {

      return getTWApiBase();
    },


    configure,

    clearConfiguration,


    health,


    getQuote,

    quote:
      getQuote,


    getQuotes,

    quotes:
      getQuotes,


    getCandles,

    candles:
      getCandles,


    getMarketPulse,

    marketPulse:
      getMarketPulse,


    getBreadth,

    breadth:
      getBreadth,


    getMoneyFlow,

    moneyFlow:
      getMoneyFlow,


    getThemes,

    themes:
      getThemes,


    getRadar,

    radar:
      getRadar,


    getIndicators,

    indicators:
      getIndicators,


    search:
      searchSymbols

  });
