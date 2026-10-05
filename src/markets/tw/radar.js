import { mountTWChartRadar } from './chart-radar.js?v=20261005-load16';
import { radarAvailability } from './recovery.js?v=20261005-recovery20';
import { TW_RADAR_MODES, normalizeTWStockCard, rowsForTWMode, renderTWStockCard } from "./radar-card.js";
import { observeTWMiniCandles, resetTWMiniCandles, openTWStockDetail } from "./radar-candles.js?v=20261005-weeklist4";

/*
 * OX v4.0 Modular
 * Taiwan Stock Radar
 *
 * Provider-agnostic renderer.
 *
 * Responsibility:
 * - Render TW stock screener / radar.
 * - Read only from TW normalized market state.
 * - T1 / T2 / T3 filtering.
 * - Listed / OTC filtering.
 * - Search.
 * - Quick conditions.
 * - Advanced conditions.
 * - Sorting.
 * - Local watchlist.
 * - Desktop / mobile responsive UI.
 *
 * This file DOES NOT:
 * - call TWSE directly
 * - call TPEX directly
 * - call broker APIs directly
 * - generate fake stock data
 * - modify Crypto / US
 *
 *
 * Future normalized contract:
 *
 * state.data.radar = [
 *   {
 *     symbol: "2330",
 *     name: "台積電",
 *
 *     market: "TWSE",
 *     industry: "半導體",
 *     theme: "AI / 半導體",
 *
 *     price: 1000,
 *     changePct: 3.25,
 *
 *     volume: 32000,
 *     turnoverTwd: 32000000000,
 *     volumeRatio: 1.85,
 *
 *     rs: 88,
 *
 *     breakout: true,
 *     breakoutState: "20D HIGH",
 *
 *     nearLimitUp: false,
 *     distanceToLimitUpPct: 3.2,
 *
 *     foreignNet: 12000,
 *     trustNet: 3200,
 *     dealerNet: -800,
 *
 *     bigOrderBias: "BUY",
 *
 *     setup: "突破",
 *     oxScore: 91,
 *     tier: "T1"
 *   }
 * ]
 */


const ROOT_ID =
  "market-unavailable-card";


const WATCHLIST_KEY =
  "ox-tw-radar-watchlist-v1";


/* ========================================================================== */
/* State                                                                      */
/* ========================================================================== */

const TIERS =
  Object.freeze([
    "ALL",
    "T1",
    "T2",
    "T3"
  ]);


const BOARDS =
  Object.freeze([
    "ALL",
    "TWSE",
    "TPEX"
  ]);


let activeTier =
  "ALL";


let activeBoard =
  "ALL";


let searchQuery =
  "";


let sortKey =
  "oxScore";

let activeMode = "risk";
let chartRadar=null,latestRadarState=null,pendingChartSymbol=null;
const RADAR_MODES = [...TW_RADAR_MODES.filter(mode => mode.id !== 'watchlist'), { id: "screener", label: "篩選器" }, ...TW_RADAR_MODES.filter(mode => mode.id === 'watchlist')];
let screener=null, screenerHost=null, screenerGeneration=0;
function stopScreener(){++screenerGeneration;screener?.destroy();screener=null;screenerHost=null;}
async function showScreener(host){
  if(screenerHost===host)return;
  stopScreener();screenerHost=host;const generation=screenerGeneration;
  host.textContent="篩選器載入中…";
  try{const {mountScreener}=await import("./screener/view.js?v=20261005-stable18");
    if(generation!==screenerGeneration||activeMode!=="screener"||!host.isConnected)return;
    host.replaceChildren();screener=mountScreener(host,{onOpenRadar(symbol){document.dispatchEvent(new CustomEvent("ox:tw-chart-symbol",{detail:{symbol}}));}});
  }catch{if(generation===screenerGeneration){host.textContent="篩選器暫時無法載入";screenerHost=null;}}
}
export function stopTWRadar(){stopScreener();chartRadar?.destroy();chartRadar=null;pageObserver?.disconnect();modeResizeObserver?.disconnect();resetTWMiniCandles();}
if(typeof document!=='undefined')document.addEventListener('ox:tw-chart-symbol',event=>{if(!/^\d{4}$/.test(event.detail?.symbol))return;activeMode='chart';pendingChartSymbol=event.detail.symbol;if(document.body.dataset.market==='tw'&&document.body.dataset.view==='radar')renderTWRadar(latestRadarState);});
let pageObserver = null;
let modeResizeObserver = null;

function positionModeIndicator(root) {
  const rail = root.querySelector('.twr-mode-rail');
  const selected = rail?.querySelector('.active');
  if (!selected) return;
  rail.style.setProperty('--mode-x', `${selected.offsetLeft}px`);
  rail.style.setProperty('--mode-width', `${selected.offsetWidth}px`);
}


const quickFilters =
  new Set();


const advancedFilters = {
  minChange:
    "",

  minVolumeRatio:
    "",

  minTurnover:
    "",

  minRS:
    "",

  theme:
    "ALL"
};


/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function escapeHTML(
  value
) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]
  );
}


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


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
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


function formatPrice(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  let digits = 2;


  if (
    number >= 1000
  ) {
    digits = 0;

  } else if (
    number >= 100
  ) {
    digits = 1;
  }


  return new Intl.NumberFormat(
    "zh-TW",
    {
      minimumFractionDigits:
        digits,

      maximumFractionDigits:
        digits
    }
  ).format(
    number
  );
}


function formatPercent(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  return `${
    number > 0
      ? "+"
      : ""
  }${number.toFixed(
    2
  )}%`;
}


function formatRatio(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  return `${number.toFixed(
    2
  )}x`;
}


function formatScore(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  return String(
    Math.round(
      number
    )
  );
}


function formatVolume(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  return new Intl.NumberFormat(
    "zh-TW",
    {
      notation:
        "compact",

      maximumFractionDigits:
        1
    }
  ).format(
    number
  );
}


function formatTurnover(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  const hundredMillion =
    number /
    100000000;


  if (
    Math.abs(
      hundredMillion
    ) >= 1
  ) {

    return `${
      hundredMillion
        .toLocaleString(
          "zh-TW",
          {
            maximumFractionDigits:
              1
          }
        )
    } 億`;
  }


  return new Intl.NumberFormat(
    "zh-TW",
    {
      notation:
        "compact",

      maximumFractionDigits:
        1
    }
  ).format(
    number
  );
}


function formatNet(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "—";
  }


  return `${
    number > 0
      ? "+"
      : ""
  }${new Intl.NumberFormat(
    "zh-TW",
    {
      notation:
        "compact",

      maximumFractionDigits:
        1
    }
  ).format(
    number
  )}`;
}


function changeClass(
  value
) {

  const number =
    finiteNumber(
      value
    );


  if (
    number === null
  ) {
    return "";
  }


  if (
    number > 0
  ) {
    return "twr-up";
  }


  if (
    number < 0
  ) {
    return "twr-down";
  }


  return "";
}


function getRoot() {

  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }


  return document.getElementById(
    ROOT_ID
  );
}


function isTWMarket() {

  if (
    typeof document ===
    "undefined"
  ) {
    return false;
  }


  return (
    document.body
      ?.dataset
      ?.market ===
    "tw"
  );
}


/* ========================================================================== */
/* Watchlist                                                                  */
/* ========================================================================== */

function loadWatchlist() {

  try {

    const raw =
      localStorage.getItem(
        WATCHLIST_KEY
      );


    if (
      !raw
    ) {
      return new Set();
    }


    const parsed =
      JSON.parse(
        raw
      );


    if (
      !Array.isArray(
        parsed
      )
    ) {
      return new Set();
    }


    return new Set(
      parsed.map(
        value =>
          String(
            value
          )
      )
    );

  } catch {

    return new Set();
  }
}


function saveWatchlist(
  watchlist
) {

  try {

    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify(
        [...watchlist]
      )
    );

  } catch {

    /*
     * LocalStorage failure
     * must never break Radar.
     */
  }
}


/* ========================================================================== */
/* Normalize                                                                  */
/* ========================================================================== */

function normalizeTier(
  value
) {

  const tier =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase();


  return TIERS.includes(
    tier
  )
    ? tier
    : "";
}


function normalizeBoard(
  value
) {

  const raw =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    [
      "TWSE",
      "TSE",
      "LISTED",
      "上市"
    ].includes(
      raw
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
      raw
    )
  ) {
    return "TPEX";
  }


  return "";
}


function normalizeRow(
  source
) {

  const item =
    source &&
    typeof source ===
    "object"
      ? source
      : {};


  const distanceToLimitUp =
    finiteNumber(
      item.distanceToLimitUpPct
    );


  const explicitNearLimitUp =
    item.nearLimitUp ===
    true;


  /*
   * OX UI heuristic:
   * distance <= 1.5%
   * is treated as "接近漲停"
   * only when the provider supplies
   * distanceToLimitUpPct.
   */
  const nearLimitUp =
    explicitNearLimitUp ||
    (
      distanceToLimitUp !==
        null &&
      distanceToLimitUp >=
        0 &&
      distanceToLimitUp <=
        1.5
    );


  return {

    symbol:
      String(
        item.symbol ||
        item.code ||
        ""
      )
        .trim()
        .toUpperCase(),

    name:
      String(
        item.name ||
        ""
      )
        .trim(),

    market:
      normalizeBoard(
        item.market ||
        item.exchange ||
        item.board
      ),

    industry:
      String(
        item.industry ||
        ""
      )
        .trim(),

    theme:
      String(
        item.theme ||
        ""
      )
        .trim(),

    price:
      finiteNumber(
        item.price
      ),

    changePct:
      finiteNumber(
        item.changePct
      ),

    volume:
      finiteNumber(
        item.volume
      ),

    turnoverTwd:
      finiteNumber(
        item.turnoverTwd
      ),

    volumeRatio:
      finiteNumber(
        item.volumeRatio ??
        item.rvol
      ),

    rs:
      finiteNumber(
        item.rs ??
        item.relativeStrength
      ),

    breakout:
      item.breakout ===
      true,

    breakoutState:
      String(
        item.breakoutState ||
        ""
      )
        .trim(),

    nearLimitUp,

    distanceToLimitUpPct:
      distanceToLimitUp,

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
      String(
        item.bigOrderBias ||
        ""
      )
        .trim(),

    setup:
      String(
        item.setup ||
        ""
      )
        .trim(),

    oxScore:
      finiteNumber(
        item.oxScore
      ),

    tier:
      normalizeTier(
        item.tier
      ),

    updatedAt:
      item.updatedAt ||
      null,

    // Reserved for an explicit official disposition adapter.
    disposition: item.disposition,
    turnoverRate: finiteNumber(item.turnoverRate),
    change: finiteNumber(item.change)
  };
}


function getRadarRows(
  state
) {

  const source =
    state?.data
      ?.radar;


  if (
    !Array.isArray(
      source
    )
  ) {
    return [];
  }


  return source
    .map(
      normalizeRow
    )
    .filter(
      row =>
        row.symbol
    );
}


/* ========================================================================== */
/* Quick filter logic                                                         */
/* ========================================================================== */

function passQuickFilters(
  row,
  watchlist
) {

  for (
    const filter
    of quickFilters
  ) {

    switch (
      filter
    ) {

      case "strong":

        if (
          row.changePct ===
            null ||
          row.changePct <
            3
        ) {
          return false;
        }

        break;


      case "volume":

        if (
          row.volumeRatio ===
            null ||
          row.volumeRatio <
            2
        ) {
          return false;
        }

        break;


      case "breakout":

        if (
          !row.breakout &&
          !row.breakoutState
        ) {
          return false;
        }

        break;


      case "nearLimit":

        if (
          !row.nearLimitUp
        ) {
          return false;
        }

        break;


      case "foreign":

        if (
          row.foreignNet ===
            null ||
          row.foreignNet <=
            0
        ) {
          return false;
        }

        break;


      case "trust":

        if (
          row.trustNet ===
            null ||
          row.trustNet <=
            0
        ) {
          return false;
        }

        break;


      case "turnover":

        if (
          row.turnoverTwd ===
            null ||
          row.turnoverTwd <
            500000000
        ) {
          return false;
        }

        break;


      case "rs":

        if (
          row.rs ===
            null ||
          row.rs <
            70
        ) {
          return false;
        }

        break;


      case "watch":

        if (
          !watchlist.has(
            row.symbol
          )
        ) {
          return false;
        }

        break;
    }
  }


  return true;
}


/* ========================================================================== */
/* Filtering                                                                  */
/* ========================================================================== */

function filterRows(
  rows,
  watchlist
) {

  const query =
    searchQuery
      .trim()
      .toLowerCase();


  return rows.filter(
    row => {

      if (
        activeTier !==
          "ALL" &&
        row.tier !==
          activeTier
      ) {
        return false;
      }


      if (
        activeBoard !==
          "ALL" &&
        row.market !==
          activeBoard
      ) {
        return false;
      }


      if (
        query
      ) {

        const haystack =
          [
            row.symbol,
            row.name,
            row.industry,
            row.theme,
            row.setup
          ]
            .join(
              " "
            )
            .toLowerCase();


        if (
          !haystack.includes(
            query
          )
        ) {
          return false;
        }
      }


      const minChange =
        finiteNumber(
          advancedFilters
            .minChange
        );


      if (
        minChange !==
          null &&
        (
          row.changePct ===
            null ||
          row.changePct <
            minChange
        )
      ) {
        return false;
      }


      const minVolumeRatio =
        finiteNumber(
          advancedFilters
            .minVolumeRatio
        );


      if (
        minVolumeRatio !==
          null &&
        (
          row.volumeRatio ===
            null ||
          row.volumeRatio <
            minVolumeRatio
        )
      ) {
        return false;
      }


      const minTurnover =
        finiteNumber(
          advancedFilters
            .minTurnover
        );


      if (
        minTurnover !==
          null &&
        (
          row.turnoverTwd ===
            null ||
          row.turnoverTwd <
            minTurnover
        )
      ) {
        return false;
      }


      const minRS =
        finiteNumber(
          advancedFilters
            .minRS
        );


      if (
        minRS !==
          null &&
        (
          row.rs ===
            null ||
          row.rs <
            minRS
        )
      ) {
        return false;
      }


      if (
        advancedFilters
          .theme !==
          "ALL" &&
        row.theme !==
          advancedFilters
            .theme
      ) {
        return false;
      }


      if (
        !passQuickFilters(
          row,
          watchlist
        )
      ) {
        return false;
      }


      return true;
    }
  );
}


/* ========================================================================== */
/* Sorting                                                                    */
/* ========================================================================== */

function numberSort(
  a,
  b,
  key
) {

  const av =
    finiteNumber(
      a[key]
    );


  const bv =
    finiteNumber(
      b[key]
    );


  if (
    av === null &&
    bv === null
  ) {
    return 0;
  }


  if (
    av === null
  ) {
    return 1;
  }


  if (
    bv === null
  ) {
    return -1;
  }


  return bv - av;
}


function sortRows(
  rows
) {

  const result =
    [...rows];


  switch (
    sortKey
  ) {

    case "changePct":

      result.sort(
        (
          a,
          b
        ) =>
          numberSort(
            a,
            b,
            "changePct"
          )
      );

      break;


    case "turnoverTwd":

      result.sort(
        (
          a,
          b
        ) =>
          numberSort(
            a,
            b,
            "turnoverTwd"
          )
      );

      break;


    case "volumeRatio":

      result.sort(
        (
          a,
          b
        ) =>
          numberSort(
            a,
            b,
            "volumeRatio"
          )
      );

      break;


    case "rs":

      result.sort(
        (
          a,
          b
        ) =>
          numberSort(
            a,
            b,
            "rs"
          )
      );

      break;


    case "symbol":

      result.sort(
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

      result.sort(
        (
          a,
          b
        ) =>
          numberSort(
            a,
            b,
            "oxScore"
          )
      );

      break;
  }


  return result;
}


/* ========================================================================== */
/* Styles                                                                     */
/* ========================================================================== */

function ensureStyles() {

  if (
    typeof document ===
    "undefined"
  ) {
    return;
  }


  if (
    document.getElementById(
      "ox-tw-radar-style"
    )
  ) {
    return;
  }


  const style =
    document.createElement(
      "style"
    );


  style.id =
    "ox-tw-radar-style";


  style.textContent = `

    /* ================================================================ */
    /* Root                                                             */
    /* ================================================================ */

    #market-unavailable-card.tw-radar-root {
      display: block !important;
      width: 100%;
      max-width: none;
      min-width: 0;
      padding: 0;
      margin: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
      text-align: left;
      overflow: visible;

      --twr-border:
        rgba(255,255,255,.085);

      --twr-soft:
        rgba(255,255,255,.045);

      --twr-card:
        rgba(18,24,34,.74);

      --twr-strong:
        rgba(18,24,34,.91);

      --twr-muted:
        rgba(218,229,242,.56);

      --twr-up:
        #f16a70;

      --twr-down:
        #48b78e;

      --twr-gold:
        #e7b955;

      --twr-blue:
        #8aa9e8;
    }


    body.theme-light
    #market-unavailable-card.tw-radar-root {

      --twr-border:
        rgba(45,63,84,.11);

      --twr-soft:
        rgba(34,53,78,.04);

      --twr-card:
        rgba(255,255,255,.80);

      --twr-strong:
        rgba(255,255,255,.95);

      --twr-muted:
        rgba(43,60,80,.58);

      --twr-gold:
        #a87312;

      --twr-blue:
        #5578bd;
    }


    .tw-radar-root * {
      box-sizing:
        border-box;
    }


    .twr-shell {
      width: 100%;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }


    /* ================================================================ */
    /* Header                                                           */
    /* ================================================================ */

    .twr-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      padding: 4px 2px;
    }


    .twr-eyebrow {
      margin-bottom: 5px;
      color: var(--twr-muted);
      font-size: 11px;
      font-weight: 850;
      letter-spacing: .16em;
    }


    .twr-header h2 {
      margin: 0;
      color: var(--ink);
      font-size: clamp(25px,3vw,38px);
      line-height: 1.06;
    }


    .twr-header p {
      max-width: 720px;
      margin: 8px 0 0;
      color: var(--twr-muted);
      font-size: 12px;
      line-height: 1.65;
    }


    .twr-status {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--twr-border);
      border-radius: 999px;
      background: var(--twr-soft);
      color: var(--twr-muted);
      font-size: 9px;
      font-weight: 850;
      white-space: nowrap;
    }


    .twr-status i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #8795a8;
    }


    .twr-status.ready i {
      background: var(--twr-up);
      box-shadow:
        0 0 12px
        rgba(55,202,150,.55);
    }


    .twr-status.error i {
      background: var(--twr-down);
    }


    /* ================================================================ */
    /* Panel                                                            */
    /* ================================================================ */

    .twr-panel {
      position: relative;
      overflow: hidden;
      padding: 16px;
      border: 1px solid var(--twr-border);
      border-radius: 20px;
      background: var(--twr-card);
      box-shadow:
        0 18px 44px
        rgba(0,0,0,.09);
      backdrop-filter:
        blur(22px)
        saturate(130%);
      -webkit-backdrop-filter:
        blur(22px)
        saturate(130%);
    }


    .twr-panel::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(
          135deg,
          rgba(255,255,255,.045),
          transparent 40%
        );
    }


    /* ================================================================ */
    /* Summary                                                          */
    /* ================================================================ */

    .twr-summary {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns:
        repeat(4,minmax(0,1fr));
      gap: 8px;
    }


    .twr-summary-card {
      padding: 12px;
      border: 1px solid var(--twr-border);
      border-radius: 14px;
      background: var(--twr-soft);
    }


    .twr-summary-card small {
      display: block;
      color: var(--twr-muted);
      font-size: 8px;
      font-weight: 800;
    }


    .twr-summary-card strong {
      display: block;
      margin-top: 5px;
      color: var(--ink);
      font-size: 21px;
      line-height: 1;
      font-variant-numeric:
        tabular-nums;
    }


    /* ================================================================ */
    /* Toolbar                                                          */
    /* ================================================================ */

    .twr-toolbar {
      position: relative;
      z-index: 1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }


    .twr-group {
      display: flex;
      align-items: center;
      gap: 5px;
    }


    .twr-tab,
    .twr-board,
    .twr-quick,
    .twr-reset {
      appearance: none;
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--twr-border);
      border-radius: 10px;
      background: transparent;
      color: var(--twr-muted);
      font: inherit;
      font-size: 8px;
      font-weight: 850;
      cursor: pointer;
      white-space: nowrap;
    }


    .twr-tab.active,
    .twr-board.active,
    .twr-quick.active {
      color: var(--ink);
      border-color:
        rgba(231,185,85,.28);
      background:
        rgba(231,185,85,.10);
    }


    .twr-search {
      flex: 1 1 200px;
      min-width: 150px;
      height: 34px;
      padding: 0 12px;
      border: 1px solid var(--twr-border);
      border-radius: 11px;
      outline: 0;
      background: var(--twr-soft);
      color: var(--ink);
      font: inherit;
      font-size: 9px;
    }


    .twr-search::placeholder {
      color: var(--twr-muted);
    }


    .twr-sort {
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--twr-border);
      border-radius: 11px;
      outline: 0;
      background: var(--twr-soft);
      color: var(--ink);
      font: inherit;
      font-size: 9px;
    }


    /* ================================================================ */
    /* Quick filters                                                    */
    /* ================================================================ */

    .twr-quick-row {
      position: relative;
      z-index: 1;
      display: flex;
      gap: 6px;
      margin-top: 10px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }


    .twr-quick-row::-webkit-scrollbar {
      display: none;
    }


    .twr-quick {
      flex: 0 0 auto;
      border-radius: 999px;
    }


    /* ================================================================ */
    /* Advanced                                                         */
    /* ================================================================ */

    .twr-advanced {
      position: relative;
      z-index: 1;
      margin-top: 10px;
      border-top:
        1px solid var(--twr-border);
      padding-top: 10px;
    }


    .twr-advanced summary {
      cursor: pointer;
      color: var(--twr-muted);
      font-size: 9px;
      font-weight: 850;
      user-select: none;
    }


    .twr-advanced-grid {
      display: grid;
      grid-template-columns:
        repeat(5,minmax(0,1fr));
      gap: 7px;
      margin-top: 10px;
    }


    .twr-filter-field span {
      display: block;
      margin-bottom: 5px;
      color: var(--twr-muted);
      font-size: 8px;
    }


    .twr-filter-field select {
      width: 100%;
      height: 34px;
      padding: 0 8px;
      border: 1px solid var(--twr-border);
      border-radius: 10px;
      outline: 0;
      background: var(--twr-soft);
      color: var(--ink);
      font: inherit;
      font-size: 9px;
    }


    /* ================================================================ */
    /* Result head                                                      */
    /* ================================================================ */

    .twr-results-head {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 14px 0 9px;
    }


    .twr-results-head span {
      color: var(--twr-muted);
      font-size: 9px;
    }


    .twr-results-head b {
      color: var(--ink);
    }


    /* ================================================================ */
    /* Table                                                            */
    /* ================================================================ */

    .twr-table-head {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns:
        32px
        minmax(135px,1.35fr)
        minmax(100px,.9fr)
        minmax(86px,.72fr)
        minmax(100px,.9fr)
        minmax(95px,.8fr)
        74px;
      gap: 10px;
      align-items: center;
      padding: 0 11px 8px;
      color: var(--twr-muted);
      font-size: 7px;
      font-weight: 900;
      letter-spacing: .06em;
    }


    .twr-list {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 7px;
    }


    .twr-row {
      display: grid;
      grid-template-columns:
        32px
        minmax(135px,1.35fr)
        minmax(100px,.9fr)
        minmax(86px,.72fr)
        minmax(100px,.9fr)
        minmax(95px,.8fr)
        74px;
      gap: 10px;
      align-items: center;
      min-height: 71px;
      padding: 10px 11px;
      border: 1px solid var(--twr-border);
      border-radius: 14px;
      background: var(--twr-soft);
      transition:
        transform .15s ease,
        border-color .15s ease;
    }


    .twr-row:hover {
      transform:
        translateY(-1px);
      border-color:
        rgba(231,185,85,.22);
    }


    /* Watch */

    .twr-watch {
      appearance: none;
      display: grid;
      place-items: center;
      width: 27px;
      height: 27px;
      padding: 0;
      border: 1px solid var(--twr-border);
      border-radius: 9px;
      background: transparent;
      color: var(--twr-muted);
      font-size: 13px;
      cursor: pointer;
    }


    .twr-watch.active {
      color: var(--twr-gold);
      background:
        rgba(231,185,85,.09);
    }


    /* Identity */

    .twr-identity {
      min-width: 0;
    }


    .twr-symbol-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }


    .twr-symbol {
      color: var(--ink);
      font-size: 15px;
      font-weight: 900;
    }


    .twr-tier {
      flex: 0 0 auto;
      padding: 3px 6px;
      border-radius: 7px;
      font-size: 7px;
      font-weight: 900;
    }


    .twr-tier.t1 {
      color: var(--twr-gold);
      border:
        1px solid
        rgba(231,185,85,.28);
      background:
        rgba(231,185,85,.08);
    }


    .twr-tier.t2 {
      color: var(--twr-blue);
      border:
        1px solid
        rgba(122,166,224,.24);
      background:
        rgba(122,166,224,.07);
    }


    .twr-tier.t3 {
      color: var(--twr-muted);
      border:
        1px solid
        var(--twr-border);
    }


    .twr-name {
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--twr-muted);
      font-size: 9px;
    }


    /* Meta */

    .twr-meta strong,
    .twr-price strong,
    .twr-flow strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ink);
      font-size: 10px;
    }


    .twr-meta small,
    .twr-price small,
    .twr-flow small {
      display: block;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--twr-muted);
      font-size: 8px;
    }


    .twr-metric {
      min-width: 0;
    }


    .twr-metric span {
      display: block;
      color: var(--twr-muted);
      font-size: 7px;
    }


    .twr-metric strong {
      display: block;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ink);
      font-size: 10px;
    }


    .twr-score {
      text-align: right;
    }


    .twr-score strong {
      display: block;
      color: var(--twr-gold);
      font-size: 18px;
      line-height: 1;
      font-weight: 900;
    }


    .twr-score small {
      display: block;
      margin-top: 5px;
      color: var(--twr-muted);
      font-size: 7px;
    }


    .twr-up {
      color: var(--twr-up) !important;
    }


    .twr-down {
      color: var(--twr-down) !important;
    }


    /* ================================================================ */
    /* Waiting / Empty                                                  */
    /* ================================================================ */

    .twr-empty {
      padding: 26px 18px;
      border: 1px dashed var(--twr-border);
      border-radius: 15px;
      color: var(--twr-muted);
      text-align: center;
      font-size: 9px;
      line-height: 1.7;
    }


    .twr-empty b {
      display: block;
      margin-bottom: 5px;
      color: var(--ink);
      font-size: 11px;
    }


    .twr-wait-row {
      position: relative;
      overflow: hidden;
      display: grid;
      grid-template-columns:
        32px
        1.3fr
        .9fr
        .7fr
        .9fr
        .8fr
        70px;
      gap: 10px;
      padding: 16px 11px;
      border: 1px solid var(--twr-border);
      border-radius: 14px;
      background: var(--twr-soft);
    }


    .twr-wait-row i {
      height: 9px;
      border-radius: 999px;
      background:
        rgba(130,150,175,.11);
    }


    .twr-wait-row::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(
          100deg,
          transparent 25%,
          rgba(255,255,255,.025) 48%,
          transparent 72%
        );
      transform:
        translateX(-100%);
      animation:
        twrShimmer
        2.3s
        infinite;
    }


    @keyframes twrShimmer {

      100% {
        transform:
          translateX(100%);
      }

    }


    .twr-error {
      margin-top: 10px;
      padding: 11px 12px;
      border:
        1px solid
        rgba(239,102,123,.20);
      border-radius: 12px;
      color:
        rgba(239,160,172,.88);
      background:
        rgba(239,102,123,.06);
      font-size: 9px;
      line-height: 1.55;
    }


    /* ================================================================ */
    /* Footer                                                           */
    /* ================================================================ */

    .twr-footer {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding-top: 11px;
      border-top:
        1px solid var(--twr-border);
      color: var(--twr-muted);
      font-size: 8px;
      line-height: 1.5;
    }


    /* ================================================================ */
    /* Tablet                                                           */
    /* ================================================================ */

    @media (max-width: 950px) {

      .twr-table-head,
      .twr-row {
        grid-template-columns:
          30px
          minmax(125px,1.3fr)
          minmax(82px,.8fr)
          minmax(78px,.7fr)
          minmax(86px,.8fr)
          68px;
      }


      .twr-table-head
      > :nth-child(6),

      .twr-row
      > :nth-child(6) {
        display: none;
      }


      .twr-advanced-grid {
        grid-template-columns:
          repeat(3,minmax(0,1fr));
      }

    }


    /* ================================================================ */
    /* Mobile                                                           */
    /* ================================================================ */

    @media (max-width: 720px) {

      #market-unavailable-card.tw-radar-root {
        padding: 0 !important;
        overflow: visible !important;
      }


      .twr-shell {
        gap: 11px;
      }


      .twr-header {
        align-items: flex-start;
        flex-direction: column;
        gap: 10px;
      }


      .twr-header h2 {
        font-size: 26px;
      }


      .twr-header p {
        font-size: 10px;
      }


      .twr-panel {
        padding: 13px;
        border-radius: 18px;
      }


      .twr-summary {
        grid-template-columns:
          repeat(2,minmax(0,1fr));
      }


      .twr-toolbar {
        align-items: stretch;
      }


      .twr-search {
        flex-basis: 100%;
        order: 3;
      }


      .twr-sort {
        flex: 1 1 auto;
      }


      .twr-advanced-grid {
        grid-template-columns:
          repeat(2,minmax(0,1fr));
      }


      .twr-table-head {
        display: none;
      }


      .twr-list {
        gap: 8px;
      }


      .twr-row {
        position: relative;
        display: grid;
        grid-template-columns:
          32px
          minmax(0,1fr)
          auto;
        grid-template-areas:
          "watch identity score"
          "meta price score"
          "volume rs score"
          "flow flow flow";
        gap: 8px 9px;
        min-height: 0;
        padding: 11px;
      }


      .twr-row
      > :nth-child(1) {
        grid-area: watch;
      }


      .twr-row
      > :nth-child(2) {
        grid-area: identity;
      }


      .twr-row
      > :nth-child(3) {
        grid-area: meta;
      }


      .twr-row
      > :nth-child(4) {
        grid-area: price;
      }


      .twr-row
      > :nth-child(5) {
        grid-area: volume;
      }


      .twr-row
      > :nth-child(6) {
        display: block;
        grid-area: rs;
      }


      .twr-row
      > :nth-child(7) {
        grid-area: score;
        align-self: start;
      }


      .twr-meta,
      .twr-price,
      .twr-metric,
      .twr-flow {
        padding: 8px;
        border: 1px solid var(--twr-border);
        border-radius: 10px;
        background:
          rgba(127,147,170,.035);
      }


      .twr-flow {
        display: grid !important;
        grid-template-columns:
          repeat(3,1fr);
        gap: 6px;
      }


      .twr-flow span {
        min-width: 0;
      }


      .twr-footer {
        flex-direction: column;
      }

    }


    @media (max-width: 420px) {

      .twr-advanced-grid {
        grid-template-columns: 1fr;
      }


      .twr-group {
        overflow-x: auto;
        scrollbar-width: none;
      }


      .twr-group::-webkit-scrollbar {
        display: none;
      }

    }

  `;


  document.head.appendChild(
    style
  );
  if (document.getElementById('ox-tw-radar-css')) return;
  const ui = document.createElement("link");
  ui.id = 'ox-tw-radar-css';
  ui.rel = "stylesheet";
  ui.href = "src/markets/tw/radar-ui.css?v=20261005-wide2";
  document.head.appendChild(ui);
}


/* ========================================================================== */
/* Rendering                                                                  */
/* ========================================================================== */

function boardLabel(
  board
) {

  if (
    board === "TWSE"
  ) {
    return "上市";
  }


  if (
    board === "TPEX"
  ) {
    return "上櫃";
  }


  return "—";
}


function renderTier(
  tier
) {

  if (
    !tier
  ) {
    return "";
  }


  return `
    <span
      class="
        twr-tier
        ${tier.toLowerCase()}
      "
    >
      ${escapeHTML(
        tier
      )}
    </span>
  `;
}


function renderFlow(
  row
) {

  return `
    <span>
      <small>外資</small>
      <strong
        class="${changeClass(
          row.foreignNet
        )}"
      >
        ${formatNet(
          row.foreignNet
        )}
      </strong>
    </span>

    <span>
      <small>投信</small>
      <strong
        class="${changeClass(
          row.trustNet
        )}"
      >
        ${formatNet(
          row.trustNet
        )}
      </strong>
    </span>

    <span>
      <small>大單</small>
      <strong>
        ${escapeHTML(
          row.bigOrderBias ||
          "—"
        )}
      </strong>
    </span>
  `;
}


function renderRow(
  row,
  watchlist
) {

  const watched =
    watchlist.has(
      row.symbol
    );


  const board =
    boardLabel(
      row.market
    );


  const theme =
    row.theme ||
    row.industry ||
    "題材待接";


  const setup =
    row.setup ||
    row.breakoutState ||
    (
      row.breakout
        ? "突破"
        : "—"
    );


  return `

    <article
      class="twr-row"
      data-twr-symbol="${escapeHTML(
        row.symbol
      )}"
    >


      <button
        type="button"
        class="
          twr-watch
          ${
            watched
              ? "active"
              : ""
          }
        "
        data-twr-watch="${escapeHTML(
          row.symbol
        )}"
        aria-label="${
          watched
            ? "取消觀察"
            : "加入觀察"
        } ${escapeHTML(
          row.symbol
        )}"
      >
        ${
          watched
            ? "★"
            : "☆"
        }
      </button>


      <div
        class="twr-identity"
      >

        <div
          class="twr-symbol-line"
        >

          <strong
            class="twr-symbol"
          >
            ${escapeHTML(
              row.symbol
            )}
          </strong>

          ${renderTier(
            row.tier
          )}

        </div>


        <div
          class="twr-name"
        >
          ${escapeHTML(
            row.name ||
            "名稱待接"
          )}
        </div>

      </div>


      <div
        class="twr-meta"
      >

        <strong>
          ${escapeHTML(
            board
          )}
          ·
          ${escapeHTML(
            theme
          )}
        </strong>

        <small>
          ${escapeHTML(
            setup
          )}
        </small>

      </div>


      <div
        class="twr-price"
      >

        <strong>
          ${formatPrice(
            row.price
          )}
        </strong>

        <small
          class="${changeClass(
            row.changePct
          )}"
        >
          ${formatPercent(
            row.changePct
          )}
        </small>

      </div>


      <div
        class="twr-metric"
      >

        <span>
          成交額 / 量比
        </span>

        <strong>
          ${formatTurnover(
            row.turnoverTwd
          )}
          ·
          ${formatRatio(
            row.volumeRatio
          )}
        </strong>

      </div>


      <div
        class="twr-metric twr-flow"
      >

        ${renderFlow(
          row
        )}

      </div>


      <div
        class="twr-score"
      >

        <strong>
          ${formatScore(
            row.oxScore
          )}
        </strong>

        <small>
          RS
          ${formatScore(
            row.rs
          )}
        </small>

      </div>


    </article>

  `;
}


function renderWaitingRows() {

  return Array
    .from(
      {
        length: 4
      }
    )
    .map(
      () => `

        <div
          class="twr-wait-row"
        >
          <i></i>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </div>

      `
    )
    .join(
      ""
    );
}


/* ========================================================================== */
/* Theme select                                                               */
/* ========================================================================== */

function renderThemeOptions(
  rows
) {

  const themes =
    [...new Set(
      rows
        .map(
          row =>
            row.theme
        )
        .filter(
          Boolean
        )
    )]
      .sort(
        (
          a,
          b
        ) =>
          a.localeCompare(
            b,
            "zh-TW"
          )
      );


  return `
    <option
      value="ALL"
    >
      全部題材
    </option>

    ${themes
      .map(
        theme => `

          <option
            value="${escapeHTML(
              theme
            )}"
            ${
              advancedFilters
                .theme ===
              theme
                ? "selected"
                : ""
            }
          >
            ${escapeHTML(
              theme
            )}
          </option>

        `
      )
      .join(
        ""
      )}
  `;
}


/* ========================================================================== */
/* Data UI refresh                                                            */
/* ========================================================================== */

function refreshRadarDataUI(
  root,
  state,
  watchlist
) {

  const rows =
    getRadarRows(
      state
    );

  const modeRows = rowsForTWMode(state, activeMode, rows, watchlist);


  const filtered =
    activeMode === "classic"
      ? sortRows(filterRows(rows, watchlist))
      : modeRows.filter(row => activeBoard === "ALL" || row.market === activeBoard)
          .filter(row => !searchQuery || `${row.symbol} ${row.name} ${row.industry}`.toLowerCase().includes(searchQuery.toLowerCase()));

  const availability = radarAvailability(state, activeMode, filtered.length);
  const scanButton = root.querySelector('[data-twr-scan]');
  if (scanButton) {
    scanButton.disabled = availability.loading;
    scanButton.setAttribute('aria-busy', String(availability.loading));
  }


  const totalEl =
    root.querySelector(
      "#twr-total"
    );


  const t1El =
    root.querySelector(
      "#twr-t1"
    );


  const breakoutEl =
    root.querySelector(
      "#twr-breakout"
    );


  const watchEl =
    root.querySelector(
      "#twr-watch-count"
    );


  const resultCount =
    root.querySelector(
      "#twr-result-count"
    );


  const list =
    root.querySelector(
      "#twr-list"
    );

  const marketScan = root.querySelector("#twr-market-scan");
  const marketScanList = root.querySelector("#twr-market-scan-list");
  const resultsPanel = root.querySelector(".twr-results-panel");


  if (
    totalEl
  ) {

    totalEl.textContent =
      String(
        rows.length
      );
  }


  if (
    t1El
  ) {

    t1El.textContent =
      String(
        rows.filter(
          row =>
            row.tier ===
            "T1"
        ).length
      );
  }


  if (
    breakoutEl
  ) {

    breakoutEl.textContent =
      String(
        rows.filter(
          row =>
            row.breakout ||
            row.breakoutState
        ).length
      );
  }


  if (
    watchEl
  ) {

    watchEl.textContent =
      String(
        watchlist.size
      );
  }


  if (
    resultCount
  ) {

    resultCount.textContent =
      availability.count;
  }

  const modeRail = root.querySelector(".twr-mode-rail");
  modeRail?.querySelectorAll("[data-twr-mode]").forEach(button => {
    const selected = button.dataset.twrMode === activeMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  positionModeIndicator(root);
  root.querySelectorAll(".twr-classic-only").forEach(section => section.hidden = activeMode !== "classic");
  const chartHost=root.querySelector('#twr-chart-radar');
  if(chartHost)chartHost.hidden=activeMode!=='chart';
  const filterHost=root.querySelector('#twr-screener');
  if(filterHost)filterHost.hidden=activeMode!=='screener';
  if(scanButton)scanButton.hidden=activeMode==='screener';
  if(activeMode==='screener'){
    pageObserver?.disconnect();resetTWMiniCandles();
    if(resultsPanel)resultsPanel.hidden=true;if(marketScan)marketScan.hidden=true;
    chartRadar?.destroy();chartRadar=null;showScreener(filterHost);return;
  }
  if(screenerHost)stopScreener();
  if(activeMode==='chart'){
    pageObserver?.disconnect();resetTWMiniCandles();if(resultsPanel)resultsPanel.hidden=true;if(marketScan)marketScan.hidden=true;
    if(!chartRadar)chartRadar=mountTWChartRadar(chartHost,{state,watchlist});else chartRadar.update(state);
    if(pendingChartSymbol){chartRadar.openSymbol(pendingChartSymbol);pendingChartSymbol=null;}
    return;
  }
  if(chartRadar){chartRadar.destroy();chartRadar=null;}
  const label = root.querySelector("#twr-mode-label");
  if (label) label.textContent = TW_RADAR_MODES.find(mode => mode.id === activeMode)?.label || "";


  root
    .querySelectorAll(
      "[data-twr-tier]"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset
            .twrTier ===
            activeTier
        );

      }
    );


  root
    .querySelectorAll(
      "[data-twr-board]"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          button.dataset
            .twrBoard ===
            activeBoard
        );

      }
    );


  root
    .querySelectorAll(
      "[data-twr-quick]"
    )
    .forEach(
      button => {

        button.classList.toggle(
          "active",
          quickFilters.has(
            button.dataset
              .twrQuick
          )
        );

      }
    );


  if (
    !list
  ) {
    return;
  }

  pageObserver?.disconnect();
  resetTWMiniCandles();

  if (marketScan) marketScan.hidden = true;
  if (marketScanList) marketScanList.innerHTML = "";
  if (resultsPanel) resultsPanel.hidden = false;
  const sourceNotice = root.querySelector("#twr-source-notice");
  if (sourceNotice) {
    sourceNotice.hidden = true;
    sourceNotice.textContent = "";
  }



  /*
   * No provider data yet.
   */
  if (
    rows.length ===
    0
    && activeMode === "classic"
  ) {

    list.innerHTML = `<div class="twr-empty"><b>${state?.status === "error" ? "資料載入失敗" : state?.status === "loading" ? "資料載入中" : "尚無台股行情"}</b>請稍後重試。</div>`;

    return;
  }


  /*
   * Provider has data,
   * but filters removed everything.
   */
  if (
    filtered.length ===
    0
  ) {

    list.innerHTML = activeMode === "classic" ? '<div class="twr-empty"><b>沒有符合目前條件的股票</b>請調整篩選條件。</div>' : "";

    if (activeMode !== "classic") {
      const meta = state?.data?.radarModesMeta?.[activeMode];
      const loading = activeMode !== "watchlist" && availability.loading && !meta;
      if (loading) {
        list.innerHTML = '<div class="twr-empty" role="status">官方名單更新中，取得股票後即顯示。</div>';
      } else {
        const message = activeMode === "watchlist" ? "尚未收藏股票。點選股票卡片右上角的星星即可加入自選。"
          : availability.unavailable || meta?.status === "error" ? "台股資料暫時無法取得，請確認網路後重新載入。"
          : meta?.status === "partial" ? "目前尚無可確認的股票，部分官方名單仍在更新。"
          : activeMode === "risk" ? "目前官方名單沒有公布注意或接近處置門檻的股票。"
          : activeMode === "release" ? "目前沒有 3 個交易日內處置結束的股票。"
          : "目前官方名單沒有處置中的股票。";
        list.innerHTML = `<div class="twr-empty" role="status">${message}</div>`;
      }
    }

    return;
  }


  let shown = 0;
  const appendPage = () => {
    const page = filtered.slice(shown, shown + 40);
    shown += page.length;
    const sentinel = list.querySelector(".twr-more-sentinel");
    sentinel?.insertAdjacentHTML("beforebegin", page.map(row =>
      renderTWStockCard(normalizeTWStockCard(row), watchlist)).join(""));
    if (shown >= filtered.length) sentinel?.remove();
    observeTWMiniCandles(list);
  };
  list.innerHTML = `<div class="twr-more-sentinel" aria-hidden="true"></div>`;
  appendPage();
  if (shown < filtered.length) {
    pageObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        appendPage();
        if (shown >= filtered.length) pageObserver?.disconnect();
      }
    }, { rootMargin: "400px" });
    pageObserver.observe(list.querySelector(".twr-more-sentinel"));
  }
}


/* ========================================================================== */
/* Reset filters                                                              */
/* ========================================================================== */

function resetFilters() {

  activeTier =
    "ALL";


  activeBoard =
    "ALL";


  searchQuery =
    "";


  sortKey =
    "oxScore";


  quickFilters.clear();


  advancedFilters.minChange =
    "";


  advancedFilters.minVolumeRatio =
    "";


  advancedFilters.minTurnover =
    "";


  advancedFilters.minRS =
    "";


  advancedFilters.theme =
    "ALL";
}


/* ========================================================================== */
/* Public renderer                                                            */
/* ========================================================================== */

export function renderTWRadar(
  state
) {

  /*
   * Never paint TW UI
   * outside TW Market.
   */
  if (
    !isTWMarket()
  ) {

    return {

      view:
        "radar",

      status:
        state?.status ||
        "inactive"

    };
  }


  const root =
    getRoot();


  if (
    !root
  ) {

    return {

      view:
        "radar",

      status:
        "missing-root"

    };
  }


  latestRadarState=state;
  const scanButton = root.querySelector('[data-twr-scan]');
  if (scanButton) {
    scanButton.disabled = state?.status === 'loading';
    scanButton.setAttribute('aria-busy', String(scanButton.disabled));
  }
  if(activeMode==='screener'&&screenerHost&&root.contains(screenerHost))return {view:'radar',status:state?.status};
  if(activeMode==='chart'&&chartRadar&&root.querySelector('#twr-chart-radar')){chartRadar.update(state);if(pendingChartSymbol){chartRadar.openSymbol(pendingChartSymbol);pendingChartSymbol=null;}return {view:'radar',status:state?.status};}
  stopTWRadar();
  ensureStyles();


  const rows =
    getRadarRows(
      state
    );


  const watchlist =
    loadWatchlist();


  root.hidden =
    false;


  root.classList.add(
    "tw-radar-root"
  );


  root.classList.remove(
    "tw-home-root",
    "tw-indicator-root"
  );


  root.innerHTML = `

    <div
      class="twr-shell"
    >


      <nav class="twr-mode-viewport" aria-label="台股雷達模式"><div class="twr-mode-rail" role="tablist"><span class="twr-mode-indicator" aria-hidden="true"></span>${RADAR_MODES.map(mode => `<button type="button" role="tab" data-twr-mode="${mode.id}" aria-selected="${mode.id === activeMode}" aria-label="${mode.label}"><span class="twr-label-full">${mode.label}</span><span class="twr-label-short" aria-hidden="true">${({"圖表雷達":"雷達","風險股":"風險","處置中":"處置","即將出關":"出關"})[mode.label]||mode.label}</span></button>`).join("")}</div></nav>
      <section id="twr-chart-radar" hidden></section>
      <section id="twr-screener" hidden aria-label="台股篩選器"></section>


      <!-- ============================================================ -->
      <!-- SUMMARY                                                      -->
      <!-- ============================================================ -->

      <section
        class="twr-panel twr-classic-only"
      >

        <div
          class="twr-summary"
        >

          <div
            class="twr-summary-card"
          >

            <small>
              掃描池
            </small>

            <strong
              id="twr-total"
            >
              0
            </strong>

          </div>


          <div
            class="twr-summary-card"
          >

            <small>
              T1
            </small>

            <strong
              id="twr-t1"
            >
              0
            </strong>

          </div>


          <div
            class="twr-summary-card"
          >

            <small>
              突破
            </small>

            <strong
              id="twr-breakout"
            >
              0
            </strong>

          </div>


          <div
            class="twr-summary-card"
          >

            <small>
              我的觀察
            </small>

            <strong
              id="twr-watch-count"
            >
              ${watchlist.size}
            </strong>

          </div>

        </div>

      </section>


      <!-- ============================================================ -->
      <!-- FILTERS                                                      -->
      <!-- ============================================================ -->

      <section
        class="twr-panel twr-classic-only"
      >

        <div
          class="twr-toolbar"
        >


          <!-- Tier -->

          <div
            class="twr-group"
          >

            ${TIERS
              .map(
                tier => `

                  <button
                    type="button"
                    class="
                      twr-tab
                      ${
                        activeTier ===
                        tier
                          ? "active"
                          : ""
                      }
                    "
                    data-twr-tier="${tier}"
                  >
                    ${tier}
                  </button>

                `
              )
              .join(
                ""
              )}

          </div>


          <!-- Board -->

          <div
            class="twr-group"
          >

            <button
              type="button"
              class="
                twr-board
                ${
                  activeBoard ===
                  "ALL"
                    ? "active"
                    : ""
                }
              "
              data-twr-board="ALL"
            >
              全市場
            </button>

            <button
              type="button"
              class="
                twr-board
                ${
                  activeBoard ===
                  "TWSE"
                    ? "active"
                    : ""
                }
              "
              data-twr-board="TWSE"
            >
              上市
            </button>

            <button
              type="button"
              class="
                twr-board
                ${
                  activeBoard ===
                  "TPEX"
                    ? "active"
                    : ""
                }
              "
              data-twr-board="TPEX"
            >
              上櫃
            </button>

          </div>


          <!-- Search -->

          <input
            id="twr-search"
            class="twr-search"
            type="search"
            autocomplete="off"
            value="${escapeHTML(
              searchQuery
            )}"
            placeholder="搜尋股票代號、名稱、產業、題材…"
          >


          <!-- Sort -->

          <select
            id="twr-sort"
            class="twr-sort"
          >

            <option
              value="oxScore"
              ${
                sortKey ===
                "oxScore"
                  ? "selected"
                  : ""
              }
            >
              OX Score
            </option>

            <option
              value="changePct"
              ${
                sortKey ===
                "changePct"
                  ? "selected"
                  : ""
              }
            >
              漲幅
            </option>

            <option
              value="turnoverTwd"
              ${
                sortKey ===
                "turnoverTwd"
                  ? "selected"
                  : ""
              }
            >
              成交額
            </option>

            <option
              value="volumeRatio"
              ${
                sortKey ===
                "volumeRatio"
                  ? "selected"
                  : ""
              }
            >
              量比
            </option>

            <option
              value="rs"
              ${
                sortKey ===
                "rs"
                  ? "selected"
                  : ""
              }
            >
              RS
            </option>

            <option
              value="symbol"
              ${
                sortKey ===
                "symbol"
                  ? "selected"
                  : ""
              }
            >
              股票代號
            </option>

          </select>


          <button
            type="button"
            class="twr-reset"
            id="twr-reset"
          >
            清除
          </button>

        </div>


        <!-- ========================================================== -->
        <!-- QUICK FILTERS                                              -->
        <!-- ========================================================== -->

        <div
          class="twr-quick-row"
        >

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="strong"
          >
            漲幅 ≥ 3%
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="volume"
          >
            量比 ≥ 2x
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="breakout"
          >
            突破
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="nearLimit"
          >
            接近漲停
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="foreign"
          >
            外資買超
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="trust"
          >
            投信買超
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="turnover"
          >
            成交額 ≥ 5億
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="rs"
          >
            RS ≥ 70
          </button>

          <button
            type="button"
            class="twr-quick"
            data-twr-quick="watch"
          >
            ★ 我的觀察
          </button>

        </div>


        <!-- ========================================================== -->
        <!-- ADVANCED                                                   -->
        <!-- ========================================================== -->

        <details
          class="twr-advanced"
        >

          <summary>
            進階條件
          </summary>


          <div
            class="twr-advanced-grid"
          >


            <label
              class="twr-filter-field"
            >

              <span>
                最低漲幅
              </span>

              <select
                id="twr-min-change"
              >

                <option value="">
                  不限制
                </option>

                <option value="1">
                  ≥ 1%
                </option>

                <option value="3">
                  ≥ 3%
                </option>

                <option value="5">
                  ≥ 5%
                </option>

                <option value="7">
                  ≥ 7%
                </option>

              </select>

            </label>


            <label
              class="twr-filter-field"
            >

              <span>
                最低量比
              </span>

              <select
                id="twr-min-volume"
              >

                <option value="">
                  不限制
                </option>

                <option value="1.2">
                  ≥ 1.2x
                </option>

                <option value="1.5">
                  ≥ 1.5x
                </option>

                <option value="2">
                  ≥ 2x
                </option>

                <option value="3">
                  ≥ 3x
                </option>

              </select>

            </label>


            <label
              class="twr-filter-field"
            >

              <span>
                最低成交額
              </span>

              <select
                id="twr-min-turnover"
              >

                <option value="">
                  不限制
                </option>

                <option value="100000000">
                  ≥ 1 億
                </option>

                <option value="500000000">
                  ≥ 5 億
                </option>

                <option value="1000000000">
                  ≥ 10 億
                </option>

                <option value="2000000000">
                  ≥ 20 億
                </option>

              </select>

            </label>


            <label
              class="twr-filter-field"
            >

              <span>
                最低 RS
              </span>

              <select
                id="twr-min-rs"
              >

                <option value="">
                  不限制
                </option>

                <option value="50">
                  ≥ 50
                </option>

                <option value="60">
                  ≥ 60
                </option>

                <option value="70">
                  ≥ 70
                </option>

                <option value="80">
                  ≥ 80
                </option>

              </select>

            </label>


            <label
              class="twr-filter-field"
            >

              <span>
                題材
              </span>

              <select
                id="twr-theme"
              >
                ${renderThemeOptions(
                  rows
                )}
              </select>

            </label>


          </div>

        </details>

      </section>


      <!-- ============================================================ -->
      <!-- RESULTS                                                      -->
      <!-- ============================================================ -->

      <section
        class="twr-panel twr-results-panel"
      >


        <div
          class="twr-results-head"
        >

          <span>
            <span id="twr-mode-label">${TW_RADAR_MODES.find(mode => mode.id === activeMode)?.label}</span>
            <b
              id="twr-result-count"
            >
              0
            </b>
            檔
          </span>


          <span>${escapeHTML(state?.data?.radarModesMeta?.asOf ? `日行情 ${state.data.radarModesMeta.asOf.slice(5).replace("-", "/")}` : "")}</span>

        </div>

        <p id="twr-source-notice" class="twr-source-notice" role="status" hidden></p>



        <div
          class="twr-table-head twr-classic-only"
        >

          <span>
            ★
          </span>

          <span>
            股票
          </span>

          <span>
            市場 / 題材
          </span>

          <span>
            價格
          </span>

          <span>
            成交額 / 量比
          </span>

          <span>
            法人 / 大單
          </span>

          <span
            style="text-align:right"
          >
            OX / RS
          </span>

        </div>


        <div
          class="twr-list"
          id="twr-list"
        >
        </div>




        <footer
          class="twr-footer twr-classic-only"
        >

          <span>
            T1 / T2 / T3
            由未來 TW Engine
            的 OX 規則產生，
            Radar 本身不自行偽造分級。
          </span>

          <span>
            觀察清單儲存在此瀏覽器。
          </span>

        </footer>


      </section>

      <section class="twr-market-scan" id="twr-market-scan" hidden aria-label="台股行情">
        <div class="twr-list" id="twr-market-scan-list"></div>
      </section>


    </div>
    <button type="button" class="twr-scan-button" data-twr-scan aria-label="重新掃描台股雷達" title="重新掃描台股雷達"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 12 17 7M12 2v2M22 12h-2M12 22v-2M2 12h2"/></svg></button>
  `;


  /* ======================================================================== */
  /* Restore advanced selections                                              */
  /* ======================================================================== */

  const minChange =
    root.querySelector(
      "#twr-min-change"
    );


  const minVolume =
    root.querySelector(
      "#twr-min-volume"
    );


  const minTurnover =
    root.querySelector(
      "#twr-min-turnover"
    );


  const minRS =
    root.querySelector(
      "#twr-min-rs"
    );


  const themeSelect =
    root.querySelector(
      "#twr-theme"
    );


  if (
    minChange
  ) {
    minChange.value =
      advancedFilters
        .minChange;
  }


  if (
    minVolume
  ) {
    minVolume.value =
      advancedFilters
        .minVolumeRatio;
  }


  if (
    minTurnover
  ) {
    minTurnover.value =
      advancedFilters
        .minTurnover;
  }


  if (
    minRS
  ) {
    minRS.value =
      advancedFilters
        .minRS;
  }


  if (
    themeSelect
  ) {

    const exists =
      [...themeSelect.options]
        .some(
          option =>
            option.value ===
            advancedFilters
              .theme
        );


    themeSelect.value =
      exists
        ? advancedFilters
            .theme
        : "ALL";


    if (
      !exists
    ) {
      advancedFilters.theme =
        "ALL";
    }
  }


  /* ======================================================================== */
  /* Dynamic refresh                                                          */
  /* ======================================================================== */

  const refresh =
    () =>
      refreshRadarDataUI(
        root,
        state,
        watchlist
      );

  root.querySelector('[data-twr-scan]')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('ox:tw-retry'));
  });


  /* ======================================================================== */
  /* Search                                                                   */
  /* ======================================================================== */

  root
    .querySelector(
      "#twr-search"
    )
    ?.addEventListener(
      "input",
      event => {

        searchQuery =
          event.target
            .value ||
          "";


        refresh();

      }
    );


  /* ======================================================================== */
  /* Sort                                                                     */
  /* ======================================================================== */

  root
    .querySelector(
      "#twr-sort"
    )
    ?.addEventListener(
      "change",
      event => {

        sortKey =
          event.target
            .value ||
          "oxScore";


        refresh();

      }
    );


  /* ======================================================================== */
  /* Advanced                                                                 */
  /* ======================================================================== */

  minChange
    ?.addEventListener(
      "change",
      event => {

        advancedFilters
          .minChange =
          event.target
            .value;


        refresh();

      }
    );


  minVolume
    ?.addEventListener(
      "change",
      event => {

        advancedFilters
          .minVolumeRatio =
          event.target
            .value;


        refresh();

      }
    );


  minTurnover
    ?.addEventListener(
      "change",
      event => {

        advancedFilters
          .minTurnover =
          event.target
            .value;


        refresh();

      }
    );


  minRS
    ?.addEventListener(
      "change",
      event => {

        advancedFilters
          .minRS =
          event.target
            .value;


        refresh();

      }
    );


  themeSelect
    ?.addEventListener(
      "change",
      event => {

        advancedFilters
          .theme =
          event.target
            .value ||
          "ALL";


        refresh();

      }
    );


  /* ======================================================================== */
  /* Click delegation                                                         */
  /* ======================================================================== */

  const shell =
    root.querySelector(
      ".twr-shell"
    );


  shell
    ?.addEventListener(
      "click",
      event => {

        const modeButton = event.target.closest("[data-twr-mode]");
        if (modeButton) {
          activeMode = modeButton.dataset.twrMode;
          modeButton.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
          refreshRadarDataUI(root,latestRadarState||state,watchlist);
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            root.querySelector('#twr-list')?.animate([
              { opacity: .25, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'translateY(0)' }
            ], { duration: 220, easing: 'cubic-bezier(.22,.8,.22,1)' });
          }
          return;
        }


        /* Tier */

        const tierButton =
          event.target.closest(
            "[data-twr-tier]"
          );


        if (
          tierButton
        ) {

          activeTier =
            tierButton.dataset
              .twrTier ||
            "ALL";


          refresh();

          return;
        }

        /* Board */

        const boardButton =
          event.target.closest(
            "[data-twr-board]"
          );


        if (
          boardButton
        ) {

          activeBoard =
            boardButton.dataset
              .twrBoard ||
            "ALL";


          refresh();

          return;
        }


        /* Quick */

        const quickButton =
          event.target.closest(
            "[data-twr-quick]"
          );


        if (
          quickButton
        ) {

          const key =
            quickButton.dataset
              .twrQuick;


          if (
            quickFilters.has(
              key
            )
          ) {

            quickFilters.delete(
              key
            );

          } else {

            quickFilters.add(
              key
            );
          }


          refresh();

          return;
        }


        /* Watchlist */

        const watchButton =
          event.target.closest(
            "[data-twr-watch]"
          );


        if (
          watchButton
        ) {

          const symbol =
            watchButton.dataset
              .twrWatch;


          if (
            watchlist.has(
              symbol
            )
          ) {

            watchlist.delete(
              symbol
            );

          } else {

            watchlist.add(
              symbol
            );
          }


          saveWatchlist(
            watchlist
          );

          // Updating one icon avoids replacing every card and reloading their
          // candles, which caused a visible scroll/layout jump on mobile.
          const selected = watchlist.has(symbol);
          watchButton.classList.toggle("active", selected);
          watchButton.setAttribute("aria-pressed", String(selected));
          watchButton.setAttribute("aria-label", `${selected ? "取消收藏" : "收藏"} ${watchButton.closest(".tw-stock-card")?.querySelector(".tw-stock-identity strong")?.textContent || symbol}`);
          root.querySelector("#twr-watch-count")?.replaceChildren(document.createTextNode(String(watchlist.size)));

          if (activeMode === "watchlist" && !selected) {
            // Only the removed favourite leaves this grid; other modes keep
            // their cards, candles, and scroll position untouched.
            const card = watchButton.closest(".tw-stock-card");
            card?.remove();
            root.querySelector("#twr-result-count")?.replaceChildren(
              document.createTextNode(String(watchlist.size)));
            if (!watchlist.size) refresh();
          }

          return;
        }

        const stock = event.target.closest("[data-twr-symbol]");
        if (stock) {
          const row = [...rowsForTWMode(state, activeMode, getRadarRows(state), watchlist), ...getRadarRows(state)]
            .find(item => item.symbol === stock.dataset.twrSymbol);
          openTWStockDetail(root, row);
          return;
        }


        /* Reset */

        if (
          event.target.closest(
            "#twr-reset"
          )
        ) {

          resetFilters();


          const search =
            root.querySelector(
              "#twr-search"
            );


          const sort =
            root.querySelector(
              "#twr-sort"
            );


          if (
            search
          ) {
            search.value =
              "";
          }


          if (
            sort
          ) {
            sort.value =
              "oxScore";
          }


          if (
            minChange
          ) {
            minChange.value =
              "";
          }


          if (
            minVolume
          ) {
            minVolume.value =
              "";
          }


          if (
            minTurnover
          ) {
            minTurnover.value =
              "";
          }


          if (
            minRS
          ) {
            minRS.value =
              "";
          }


          if (
            themeSelect
          ) {
            themeSelect.value =
              "ALL";
          }


          refresh();

        }

      }
    );


  modeResizeObserver?.disconnect();
  modeResizeObserver = new ResizeObserver(() => positionModeIndicator(root));
  modeResizeObserver.observe(root.querySelector('.twr-mode-rail'));

  shell?.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".tw-stock-card")) {
      event.preventDefault();
      const row = [...rowsForTWMode(state, activeMode, getRadarRows(state), watchlist), ...getRadarRows(state)].find(item => item.symbol === event.target.dataset.twrSymbol);
      openTWStockDetail(root, row);
    }
  });

  refresh();


  return {

    view:
      "radar",

    status:
      state?.status ||
      "placeholder",

    count:
      rows.length,

    data:
      state?.data ||
      null

  };
}
