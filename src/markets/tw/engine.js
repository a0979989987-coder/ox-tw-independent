import { classicTWRow } from './classic.js?v=20261002-rank8';
import { bundleClassification, subscribeBundle } from './patterns/bundle.js?v=20261005-load16';
import {
  twProvider
} from "./api.js?v=20261005-recovery20";
import {validRadarSnapshot} from './radar-snapshot.js?v=20261005-recovery20';


/*
 * OX v4.0 Modular
 * Taiwan Market Engine
 *
 * Responsibility:
 *
 * TW Provider
 *      ↓
 * TW Engine
 *      ↓
 * Normalized OX Taiwan State
 *      ↓
 * Home / Indicator / Radar
 *
 *
 * This file:
 *
 * - does NOT store API secrets
 * - does NOT call TWSE directly
 * - does NOT call TPEX directly
 * - does NOT know the final provider
 * - does NOT render UI
 * - does NOT modify Crypto / US
 *
 *
 * Stable frontend contract:
 *
 * state = {
 *
 *   market: "tw",
 *
 *   status:
 *     "idle" |
 *     "loading" |
 *     "unconfigured" |
 *     "partial" |
 *     "ready" |
 *     "error",
 *
 *   provider,
 *
 *   updatedAt,
 *
 *   data: {
 *
 *     session,
 *
 *     pulse,
 *
 *     breadth,
 *
 *     moneyFlow,
 *
 *     themes,
 *
 *     radar,
 *
 *     indicators,
 *
 *     opportunities,
 *
 *     myOX,
 *
 *     meta
 *
 *   },
 *
 *   error
 * }
 */


/* ========================================================================== */
/* State                                                                      */
/* ========================================================================== */

let currentState =
  Object.freeze({

    market:
      "tw",

    status:
      "idle",

    provider:
      twProvider.id,

    updatedAt:
      null,

    data:
      null,

    error:
      null

  });


let activeRequest =
  null;


/* ========================================================================== */
/* Generic helpers                                                            */
/* ========================================================================== */

function finiteNumber(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const parsed =
    Number(
      value
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function textValue(
  value,
  fallback =
    ""
) {

  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }


  return String(
    value
  ).trim();
}


function booleanValue(
  value
) {

  if (
    value === true
  ) {
    return true;
  }


  if (
    value === false
  ) {
    return false;
  }


  if (
    typeof value ===
    "string"
  ) {

    const normalized =
      value
        .trim()
        .toLowerCase();


    if (
      normalized ===
      "true"
    ) {
      return true;
    }


    if (
      normalized ===
      "false"
    ) {
      return false;
    }
  }


  if (
    value === 1
  ) {
    return true;
  }


  if (
    value === 0
  ) {
    return false;
  }


  return null;
}


function objectValue(
  value
) {

  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  )
    ? value
    : {};
}


function arrayValue(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


/* ========================================================================== */
/* Error helpers                                                              */
/* ========================================================================== */

function normalizeError(
  error,
  fallbackCode =
    "TW_MARKET_DATA_ERROR"
) {

  return Object.freeze({

    code:
      error?.code ||
      fallbackCode,

    message:
      error?.message ||
      "Taiwan market data unavailable.",

    status:
      Number(
        error?.status
      ) ||
      0

  });
}


/* ========================================================================== */
/* Market / exchange normalization                                            */
/* ========================================================================== */

function normalizeBoard(
  value
) {

  const board =
    textValue(
      value
    )
      .toUpperCase();


  if (
    [
      "TWSE",
      "TSE",
      "LISTED",
      "上市"
    ].includes(
      board
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
      board
    )
  ) {
    return "TPEX";
  }


  return board;
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


  return "";
}


/* ========================================================================== */
/* Session                                                                    */
/* ========================================================================== */

function normalizeSession(
  value
) {

  const session =
    textValue(
      value
    )
      .toUpperCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  if (
    [
      "REGULAR",
      "OPEN",
      "TRADING"
    ].includes(
      session
    )
  ) {
    return "REGULAR";
  }


  if (
    [
      "PRE_OPEN",
      "PREOPEN",
      "PRE_MARKET"
    ].includes(
      session
    )
  ) {
    return "PRE_OPEN";
  }


  if (
    [
      "CLOSED",
      "CLOSE",
      "AFTER_HOURS"
    ].includes(
      session
    )
  ) {
    return "CLOSED";
  }


  return null;
}


/* ========================================================================== */
/* Pulse                                                                      */
/* ========================================================================== */

function normalizePulseItem(
  raw,
  fallbackSymbol,
  fallbackName
) {

  const item =
    objectValue(
      raw
    );


  return Object.freeze({

    symbol:
      textValue(
        item.symbol ||
        item.code ||
        fallbackSymbol,
        fallbackSymbol
      ),

    name:
      textValue(
        item.name ||
        fallbackName,
        fallbackName
      ),

    price:
      finiteNumber(
        item.price ??
        item.close ??
        item.last
      ),

    change:
      finiteNumber(
        item.change
      ),

    changePct:
      finiteNumber(
        item.changePct ??
        item.percentChange ??
        item.percent_change
      ),

    open:
      finiteNumber(
        item.open
      ),

    high:
      finiteNumber(
        item.high
      ),

    low:
      finiteNumber(
        item.low
      ),

    volume:
      finiteNumber(
        item.volume
      ),

    turnoverTwd:
      finiteNumber(
        item.turnoverTwd ??
        item.turnover ??
        item.amount
      ),

    timestamp:
      item.timestamp ??
      item.datetime ??
      item.updatedAt ??
      null

  });
}


function findPulseItem(
  source,
  aliases
) {

  const object =
    objectValue(
      source
    );


  for (
    const alias
    of aliases
  ) {

    if (
      object[alias]
    ) {

      return object[
        alias
      ];
    }
  }


  /*
   * Some backends may return:
   *
   * [
   *   { symbol:"TAIEX" }
   * ]
   */
  if (
    Array.isArray(
      source
    )
  ) {

    return source.find(
      item => {

        const symbol =
          textValue(
            item?.symbol ||
            item?.code
          )
            .toUpperCase();


        return aliases.includes(
          symbol
        );

      }
    ) || null;
  }


  return null;
}


export function normalizeTWMarketPulse(
  payload
) {

  const raw =
    objectValue(
      payload
    );


  const pulseSource =
    raw.pulse ||
    raw.benchmarks ||
    raw.indices ||
    raw.indexes ||
    raw;


  const taiexRaw =
    findPulseItem(
      pulseSource,
      [
        "TAIEX",
        "TWII",
        "加權指數"
      ]
    );


  const tpexRaw =
    findPulseItem(
      pulseSource,
      [
        "TPEX",
        "OTC",
        "櫃買指數"
      ]
    );


  const txRaw =
    findPulseItem(
      pulseSource,
      [
        "TX",
        "TXF",
        "TAIFEX",
        "台指近月"
      ]
    );


  return Object.freeze({

    session:
      normalizeSession(
        raw.session ||
        raw.marketSession
      ),

    pulse:
      Object.freeze({

        TAIEX:
          normalizePulseItem(
            taiexRaw,
            "TAIEX",
            "加權指數"
          ),

        TPEX:
          normalizePulseItem(
            tpexRaw,
            "TPEX",
            "櫃買指數"
          ),

        TX:
          normalizePulseItem(
            txRaw,
            "TX",
            "台指近月"
          )

      })

  });
}


/* ========================================================================== */
/* Breadth                                                                    */
/* ========================================================================== */

export function normalizeTWBreadth(
  payload
) {

  const raw =
    objectValue(
      payload?.breadth ||
      payload
    );


  return Object.freeze({

    advancers:
      finiteNumber(
        raw.advancers ??
        raw.up ??
        raw.rise
      ),

    decliners:
      finiteNumber(
        raw.decliners ??
        raw.down ??
        raw.fall
      ),

    unchanged:
      finiteNumber(
        raw.unchanged ??
        raw.flat
      ),

    limitUp:
      finiteNumber(
        raw.limitUp ??
        raw.limit_up
      ),

    limitDown:
      finiteNumber(
        raw.limitDown ??
        raw.limit_down
      ),

    newHigh20:
      finiteNumber(
        raw.newHigh20 ??
        raw.high20
      ),

    newLow20:
      finiteNumber(
        raw.newLow20 ??
        raw.low20
      ),

    surgeCount:
      finiteNumber(
        raw.surgeCount ??
        raw.volumeSurgeCount
      ),

    turnoverTwd:
      finiteNumber(
        raw.turnoverTwd ??
        raw.turnover ??
        raw.amount
      )

  });
}


/* ========================================================================== */
/* Money Flow                                                                 */
/* ========================================================================== */

export function normalizeTWMoneyFlow(
  payload
) {

  const raw =
    objectValue(
      payload?.moneyFlow ||
      payload
    );


  return Object.freeze({

    foreignNetTwd:
      finiteNumber(
        raw.foreignNetTwd ??
        raw.foreignNet ??
        raw.foreign
      ),

    trustNetTwd:
      finiteNumber(
        raw.trustNetTwd ??
        raw.trustNet ??
        raw.investmentTrust ??
        raw.trust
      ),

    dealerNetTwd:
      finiteNumber(
        raw.dealerNetTwd ??
        raw.dealerNet ??
        raw.dealer
      ),

    marginChangeTwd:
      finiteNumber(
        raw.marginChangeTwd ??
        raw.marginChange
      ),

    bigOrderBias:
      textValue(
        raw.bigOrderBias ??
        raw.largeOrderBias ??
        ""
      )

  });
}


/* ========================================================================== */
/* Themes                                                                     */
/* ========================================================================== */

function normalizeTheme(
  raw
) {

  const item =
    objectValue(
      raw
    );


  return Object.freeze({

    name:
      textValue(
        item.name ||
        item.theme ||
        item.industry
      ),

    changePct:
      finiteNumber(
        item.changePct ??
        item.percentChange
      ),

    flowTwd:
      finiteNumber(
        item.flowTwd ??
        item.moneyFlow ??
        item.turnoverTwd
      ),

    volumeRatio:
      finiteNumber(
        item.volumeRatio ??
        item.rvol
      ),

    advanceCount:
      finiteNumber(
        item.advanceCount ??
        item.advancers
      ),

    declineCount:
      finiteNumber(
        item.declineCount ??
        item.decliners
      ),

    leaderSymbol:
      textValue(
        item.leaderSymbol ??
        item.leader?.symbol ??
        ""
      ),

    leaderName:
      textValue(
        item.leaderName ??
        item.leader?.name ??
        ""
      )

  });
}


export function normalizeTWThemes(
  payload
) {

  const source =
    Array.isArray(
      payload
    )
      ? payload
      : arrayValue(
          payload?.themes ??
          payload?.items ??
          payload?.data
        );


  return Object.freeze(
    source
      .map(
        normalizeTheme
      )
      .filter(
        item =>
          item.name
      )
  );
}


/* ========================================================================== */
/* Radar                                                                      */
/* ========================================================================== */

function normalizeRadarItem(
  raw
) {

  const item =
    objectValue(
      raw
    );


  const distanceToLimitUpPct =
    finiteNumber(
      item.distanceToLimitUpPct ??
      item.distanceToLimit
    );


  const explicitNearLimit =
    booleanValue(
      item.nearLimitUp
    );


  return Object.freeze({

    symbol:
      textValue(
        item.symbol ||
        item.code
      )
        .toUpperCase(),

    name:
      textValue(
        item.name
      ),

    market:
      normalizeBoard(
        item.market ||
        item.exchange ||
        item.board
      ),

    industry:
      textValue(
        item.industry
      ),

    theme:
      textValue(
        item.theme
      ),

    price:
      finiteNumber(
        item.price ??
        item.close ??
        item.last
      ),

    changePct:
      finiteNumber(
        item.changePct ??
        item.percentChange ??
        item.percent_change
      ),

    volume:
      finiteNumber(
        item.volume
      ),

    turnoverTwd:
      finiteNumber(
        item.turnoverTwd ??
        item.turnover ??
        item.amount
      ),

    volumeRatio:
      finiteNumber(
        item.volumeRatio ??
        item.rvol
      ),

    rs:
      // Historical relative strength is supplied by the provider only.
      finiteNumber(
        item.rs ??
        item.relativeStrength
      ),

    turnoverRate:
      finiteNumber(item.turnoverRate),

    change:
      finiteNumber(item.change),

    disposition:
      item.disposition && typeof item.disposition === "object"
        ? item.disposition : null,

    breakout:
      booleanValue(
        item.breakout
      ) === true,

    breakoutState:
      textValue(
        item.breakoutState
      ),

    nearLimitUp:
      explicitNearLimit ===
        true,

    distanceToLimitUpPct,

    foreignNet:
      finiteNumber(
        item.foreignNet
      ),

    trustNet:
      finiteNumber(
        item.trustNet
      ),

    dealerNet:
      finiteNumber(
        item.dealerNet
      ),

    bigOrderBias:
      textValue(
        item.bigOrderBias
      ),

    setup:
      textValue(
        item.setup
      ),

    oxScore:
      finiteNumber(
        item.oxScore ??
        item.score
      ),

    tier:
      normalizeTier(
        item.tier
      ),

    dataDate:item.dataDate||item.updatedAt||null,
    currentCandle:item.currentCandle||null,
    classic:item.classic||null,
    updatedAt:
      item.updatedAt ??
      item.timestamp ??
      null

  });
}


export function normalizeTWRadar(
  payload
) {

  const source =
    Array.isArray(
      payload
    )
      ? payload
      : arrayValue(
          payload?.radar ??
          payload?.items ??
          payload?.stocks ??
          payload?.data
        );


  return Object.freeze(
    source
      .map(
        item=>{const row=normalizeRadarItem(item),date=payload?.dataDate||row.dataDate;return classicTWRow(row,bundleClassification(row.symbol,'1D',date),date);}
      )
      .filter(
        item =>
          item.symbol
      )
  );
}


/* ========================================================================== */
/* Indicators                                                                 */
/* ========================================================================== */

function normalizeIndicatorReading(
  raw
) {

  if (
    raw === null ||
    raw === undefined
  ) {
    return null;
  }


  if (
    typeof raw !==
      "object" ||
    Array.isArray(
      raw
    )
  ) {

    return Object.freeze({

      value:
        raw,

      display:
        String(
          raw
        ),

      status:
        "ready",

      note:
        "",

      change:
        null

    });
  }


  return Object.freeze({

    value:
      raw.value ??
      null,

    display:
      raw.display ??
      null,

    status:
      textValue(
        raw.status,
        "ready"
      ),

    note:
      textValue(
        raw.note
      ),

    change:
      finiteNumber(
        raw.change
      )

  });
}


export function normalizeTWIndicators(
  payload
) {

  const source =
    objectValue(
      payload?.indicators ||
      payload
    );


  const output =
    {};


  Object
    .entries(
      source
    )
    .forEach(
      (
        [
          id,
          value
        ]
      ) => {

        const normalized =
          normalizeIndicatorReading(
            value
          );


        if (
          normalized
        ) {

          output[id] =
            normalized;
        }

      }
    );


  return Object.freeze(
    output
  );
}


/* ========================================================================== */
/* Opportunity Feed                                                          */
/* ========================================================================== */

/*
 * Opportunity Feed is DERIVED
 * only from real Radar data.
 *
 * No fake events are generated.
 */
function buildOpportunityFeed(
  radar
) {

  const items =
    [];


  radar.forEach(
    stock => {

      if (
        stock.breakout ||
        stock.breakoutState
      ) {

        items.push({

          symbol:
            stock.symbol,

          name:
            stock.name,

          type:
            "BREAKOUT",

          description:
            stock.breakoutState
              ? `價格突破 · ${stock.breakoutState}`
              : "價格突破重要結構",

          score:
            stock.oxScore

        });
      }


      if (
        stock.nearLimitUp ===
        true
      ) {

        items.push({

          symbol:
            stock.symbol,

          name:
            stock.name,

          type:
            "NEAR_LIMIT_UP",

          description:
            stock.distanceToLimitUpPct !==
              null
              ? `距離漲停約 ${stock.distanceToLimitUpPct.toFixed(
                  2
                )}%`
              : "股價接近漲停",

          score:
            stock.oxScore

        });
      }


      if (
        stock.volumeRatio !==
          null &&
        stock.volumeRatio >=
          2
      ) {

        items.push({

          symbol:
            stock.symbol,

          name:
            stock.name,

          type:
            "VOLUME_SURGE",

          description:
            `量比 ${stock.volumeRatio.toFixed(
              2
            )}x`,

          score:
            stock.oxScore

        });
      }

    }
  );


  items.sort(
    (
      a,
      b
    ) => {

      const aScore =
        finiteNumber(
          a.score
        ) ??
        0;


      const bScore =
        finiteNumber(
          b.score
        ) ??
        0;


      return bScore -
        aScore;
    }
  );


  return Object.freeze(
    items
      .slice(
        0,
        12
      )
      .map(
        item =>
          Object.freeze({

            time:
              "",

            symbol:
              item.symbol,

            name:
              item.name,

            type:
              item.type,

            description:
              item.description

          })
      )
  );
}


/* ========================================================================== */
/* My OX                                                                     */
/* ========================================================================== */

/*
 * Personal data is intentionally
 * kept separate from provider data.
 *
 * Current version only reads counts
 * from existing local OX storage.
 */
function buildMyOXState() {

  let watchlistCount =
    null;


  try {

    if (
      typeof localStorage !==
      "undefined"
    ) {

      const raw =
        localStorage.getItem(
          "ox-tw-radar-watchlist-v1"
        );


      if (
        raw
      ) {

        const parsed =
          JSON.parse(
            raw
          );


        if (
          Array.isArray(
            parsed
          )
        ) {

          watchlistCount =
            parsed.length;
        }
      }
    }

  } catch {

    /*
     * Personal storage errors
     * never block market state.
     */
  }


  return Object.freeze({

    watchlistCount,

    todayTriggers:
      null,

    strategyMatches:
      null,

    unreadAlerts:
      null,

    watchlist:
      Object.freeze([]),

    strategies:
      Object.freeze([])

  });
}


/* ========================================================================== */
/* Partial request helpers                                                    */
/* ========================================================================== */

function resultValue(
  result,
  fallback
) {

  return result.status ===
    "fulfilled"
      ? result.value
      : fallback;
}


function resultError(
  result
) {

  if (
    result.status !==
    "rejected"
  ) {
    return null;
  }


  return normalizeError(
    result.reason
  );
}


/* ========================================================================== */
/* State                                                                      */
/* ========================================================================== */

function setState(
  next
) {

  const oldData=currentState.data,newData=next.data;
  if(oldData?.radarDataDate&&newData?.radarDataDate&&newData.radarDataDate<oldData.radarDataDate)next={...next,data:{...newData,...Object.fromEntries(["radar","radarModes","radarModesMeta","radarUpdatedAt","radarDataDate","usingCachedRadar"].map(key=>[key,oldData[key]]))}};
  currentState =
    Object.freeze({

      market:
        "tw",

      provider:
        twProvider.id,

      ...next

    });


  return currentState;
}


function emitState(
  state
) {

  if (
    typeof document ===
    "undefined"
  ) {
    return;
  }


  try {

    document.dispatchEvent(
      new CustomEvent(
        "ox:tw-market-state",
        {
          detail:
            state
        }
      )
    );

  } catch {

    /*
     * Missing listeners
     * must never break engine.
     */
  }
}


/* ========================================================================== */
/* Public state                                                               */
/* ========================================================================== */

export function createTWMarketState() {

  return currentState;
}

export function seedTWRadar(saved) {
  if(!validRadarSnapshot(saved))return currentState;
  const existing=Date.parse(currentState.data?.radarUpdatedAt)||0;
  if(currentState.data?.radarDataDate>saved.data.dataDate||existing>=saved.savedAt)return currentState;
  const payload=saved.data;
  const state=setState({...currentState,status:currentState.status==='loading'?'loading':'partial',data:{
    ...(currentState.data||{}),radar:normalizeTWRadar(payload),radarModes:payload.modes,
    radarModesMeta:payload.modesMeta,radarUpdatedAt:new Date(saved.savedAt).toISOString(),
    radarDataDate:payload.dataDate,usingCachedRadar:true
  }});
  emitState(state);
  return state;
}


/* ========================================================================== */
/* Refresh                                                                    */
/* ========================================================================== */

export async function refreshTWMarketState(
  {
    signal =
      null,

    force =
      false,

    onRadarReady =
      null
  } = {}
) {

  /*
   * Prevent duplicate refreshes.
   */
  if (
    activeRequest
  ) {

    return activeRequest;
  }


  /*
   * Backend not configured yet.
   *
   * This is NOT treated as a crash.
   */
  if (
    !twProvider.available
  ) {

    const state =
      setState({

        status:
          "unconfigured",

        updatedAt:
          currentState
            .updatedAt,

        data:
          currentState
            .data,

        error:
          Object.freeze({

            code:
              "TW_DATA_API_UNCONFIGURED",

            message:
              "TW market data backend has not been configured yet.",

            status:
              0

          })

      });


    emitState(
      state
    );


    return state;
  }


  /*
   * Loading state keeps old data
   * visible if available.
   */
  setState({

    status:
      "loading",

    updatedAt:
      currentState
        .updatedAt,

    data:
      currentState
        .data,

    error:
      null

  });


  emitState(
    currentState
  );


  const radarRequest = twProvider.getRadar({
    market: "ALL",
    limit: 2000,
    sort: "oxScore",
    timeoutMs: 20000,
    signal
  }).then(payload => {
    if(payload?.dataDate<currentState.data?.radarDataDate)throw Object.assign(Error("較舊交易日資料已忽略"),{code:"TW_RADAR_OLDER_DATE"});
    if (!signal?.aborted) {
      const partialState = setState({
        ...currentState,
        status: "loading",
        data: {
          ...(currentState.data || {}),
          radar: normalizeTWRadar(payload),
          radarModes: payload?.modes || {},
          radarModesMeta: payload?.modesMeta || {},
          radarUpdatedAt: new Date().toISOString(),
          radarDataDate: payload?.dataDate,
          usingCachedRadar: false,
          meta: { ...(currentState.data?.meta || {}), sourceErrors: { ...(currentState.data?.meta?.sourceErrors || {}), radar: null } }
        }
      });
      emitState(partialState);
      if (typeof onRadarReady === "function") onRadarReady(partialState);
    }
    return payload;
  });

  activeRequest =
    Promise
      .allSettled([

        twProvider
          .getMarketPulse({
            signal
          }),

        twProvider
          .getBreadth({
            signal
          }),

        twProvider
          .getMoneyFlow({
            signal
          }),

        twProvider
          .getThemes({
            limit:
              30,

            signal
          }),

        radarRequest,

        twProvider
          .getIndicators({
            signal
          })

      ])
      .then(
        results => {

          if (
            signal?.aborted
          ) {

            return currentState;
          }


          const [
            pulseResult,
            breadthResult,
            moneyFlowResult,
            themesResult,
            radarResult,
            indicatorsResult
          ] =
            results;


          const successCount =
            results.filter(
              result =>
                result.status ===
                "fulfilled"
            ).length;


          const failureCount =
            results.length -
            successCount;


          /*
           * Every endpoint failed.
           */
          if (
            successCount ===
            0
          ) {

            const firstError =
              results.find(
                result =>
                  result.status ===
                  "rejected"
              );


            const errorState =
              setState({

                status:
                  "error",

                updatedAt:
                  currentState
                    .updatedAt,

                data:
                  currentState
                    .data,

                error:
                  normalizeError(
                    firstError
                      ?.reason
                  )

              });


            emitState(
              errorState
            );


            return errorState;
          }


          /* ============================================================ */
          /* Normalize                                                    */
          /* ============================================================ */

          const pulseData =
            normalizeTWMarketPulse(
              resultValue(
                pulseResult,
                {}
              )
            );


          const breadth =
            normalizeTWBreadth(
              resultValue(
                breadthResult,
                {}
              )
            );


          const moneyFlow =
            normalizeTWMoneyFlow(
              resultValue(
                moneyFlowResult,
                {}
              )
            );


          const themes =
            normalizeTWThemes(
              resultValue(
                themesResult,
                []
              )
            );


          const radar =
            normalizeTWRadar(
              resultValue(
                radarResult,
                currentState.data?.radar || []
              )
            );


          const indicators =
            normalizeTWIndicators(
              resultValue(
                indicatorsResult,
                {}
              )
            );


          const opportunities =
            buildOpportunityFeed(
              radar
            );


          const myOX =
            buildMyOXState();


          /* ============================================================ */
          /* Source health                                                */
          /* ============================================================ */

          const sourceErrors =
            Object.freeze({

              pulse:
                resultError(
                  pulseResult
                ),

              breadth:
                resultError(
                  breadthResult
                ),

              moneyFlow:
                resultError(
                  moneyFlowResult
                ),

              themes:
                resultError(
                  themesResult
                ),

              radar:
                resultError(
                  radarResult
                ),

              indicators:
                resultError(
                  indicatorsResult
                )

            });


          const now =
            new Date()
              .toISOString();


          const data =
            Object.freeze({

              session:
                pulseData
                  .session,

              pulse:
                pulseData
                  .pulse,

              breadth,

              moneyFlow,

              themes,

              radar,

              // Optional provider-curated lists. The client never derives
              // disposition status from ordinary price or volume fields.
              radarModes:
                resultValue(radarResult, { modes: currentState.data?.radarModes })?.modes || {},
              radarModesMeta: resultValue(radarResult, { modesMeta: currentState.data?.radarModesMeta })?.modesMeta || {},
              radarUpdatedAt: currentState.data?.radarUpdatedAt || null,
              radarDataDate: currentState.data?.radarDataDate || null,
              usingCachedRadar: radarResult.status === 'rejected' && !!currentState.data?.radarUpdatedAt,

              indicators,

              opportunities,

              myOX,

              updatedAt:
                now,

              meta:
                Object.freeze({

                  successfulSources:
                    successCount,

                  failedSources:
                    failureCount,

                  partial:
                    failureCount >
                    0,

                  sourceErrors

                })

            });


          const readyState =
            setState({

              status:
                failureCount >
                  0
                  ? "partial"
                  : "ready",

              updatedAt:
                now,

              data,

              error:
                null

            });


          emitState(
            readyState
          );


          return readyState;

        }
      )
      .catch(
        error => {

          /*
           * This catch is only for
           * unexpected engine failures.
           *
           * Provider endpoint failures
           * are already handled above
           * by Promise.allSettled().
           */
          if (
            signal?.aborted
          ) {

            return currentState;
          }


          const errorState =
            setState({

              status:
                "error",

              updatedAt:
                currentState
                  .updatedAt,

              data:
                currentState
                  .data,

              error:
                normalizeError(
                  error,
                  "TW_ENGINE_ERROR"
                )

            });


          emitState(
            errorState
          );


          return errorState;

        }
      )
      .finally(
        () => {

          activeRequest =
            null;

        }
      );


  return activeRequest;
}


/*
 * Alias for code that prefers
 * "load" terminology.
 */
export const loadTWMarketState =
  refreshTWMarketState;

// All Taiwan pages receive the same newly qualified rows as history chunks arrive.
subscribeBundle(()=>{
 if(!currentState.data?.radar)return;
 const date=currentState.data.radarDataDate;
 const radar=currentState.data.radar.map(row=>classicTWRow(row,bundleClassification(row.symbol,'1D',date),date));
 const next=setState({...currentState,data:Object.freeze({...currentState.data,radar})});emitState(next);
});
