import { stopResearch, preloadResearch, refreshTWResearch } from "./research-page.js?v=20261005-briefingdate";
import { createAfterCloseRefresh } from './after-close.js?v=20261001-twhome1';
import {
  TW_MODULE_CONFIG
} from "./config.js";

import {
  createTWMarketState,
  refreshTWMarketState, seedTWRadar
} from "./engine.js?v=20261005-recovery20";

import {
  renderTWHome
} from "./home.js?v=20261005-briefingdate";

import {
  renderTWStrength
} from "./strength.js?v=20261005-recovery20";

import {
  renderTWRadar, stopTWRadar
} from "./radar.js?v=20261005-stable18";
import { cancelTWLookup } from "./lookup.js?v=20261001-tiercomb1";
import { stopTWStrength, preloadTWStrength } from "./strength.js?v=20261005-recovery20";
import { createPreloader } from "./preload.js?v=20261001-twhome1";
import { preloadBundle } from "./patterns/bundle.js?v=20261005-load16";
import {savedRadarSnapshot,saveRadarSnapshot,bundledRadarSnapshot} from './radar-snapshot.js?v=20261005-recovery20';
import { radarNeedsRecovery } from './recovery.js?v=20261005-recovery20';


/*
 * OX v4.0 Modular
 * Taiwan Market Lifecycle
 *
 *
 * Data flow:
 *
 * Market Router
 *      ↓
 * TW Module
 *      ↓
 * TW Engine
 *      ↓
 * TW Provider
 *      ↓
 * Backend
 *
 *
 * UI flow:
 *
 * TW State
 *   ↓
 * Home / Indicator / Radar
 *
 *
 * Responsibilities:
 *
 * - Enter / leave Taiwan market.
 * - Manage Home / Indicator / Radar.
 * - Start Taiwan market refresh.
 * - Keep shared TW data loading while another market is visible.
 * - Prevent stale requests repainting another market.
 * - Restore shared market host.
 *
 *
 * This file does NOT:
 *
 * - call TWSE directly
 * - call TPEX directly
 * - store API secrets
 * - normalize provider data
 * - modify Crypto / US
 */


/* ========================================================================== */
/* Module state                                                               */
/* ========================================================================== */

let activeView =
  "radar";


let isActive =
  false;


function cacheRadarState(state) {
 if(state?.data?.usingCachedRadar||state?.data?.meta?.sourceErrors?.radar)return;
 const data=state?.data;
 saveRadarSnapshot({savedAt:Date.parse(data?.radarUpdatedAt),data:{radar:data?.radar,
   modes:data?.radarModes,modesMeta:data?.radarModesMeta,dataDate:data?.radarDataDate}});
}
function showSavedRadar(saved) {
 if(!saved)return;
 const state=seedTWRadar(saved);
 if(isActive&&activeView==='radar')render(state);
}
showSavedRadar(savedRadarSnapshot());
let recoveryTimer,recoveryAttempts=0;
function scheduleRecovery() {
 clearTimeout(recoveryTimer);
 if(!isActive||!radarNeedsRecovery(createTWMarketState())||recoveryAttempts>=3)return;
 recoveryTimer=setTimeout(()=>{recoveryAttempts++;recoverMarketData(true);},[5000,15000,30000][recoveryAttempts]);
}

/* ========================================================================== */
/* Shared market host                                                        */
/* ========================================================================== */

const SHARED_HOST_ID =
  "market-unavailable-card";


/*
 * TW Home / Indicator / Radar currently
 * render inside the existing shared:
 *
 * #market-unavailable-card
 *
 *
 * Those renderers replace innerHTML.
 *
 * Therefore when leaving TW,
 * the original shell MUST be restored.
 *
 *
 * MarketController.syncPlaceholder()
 * still expects:
 *
 * #market-unavailable-title
 * #market-unavailable-copy
 */
function restoreSharedMarketHost() {

  if (
    typeof document ===
    "undefined"
  ) {
    return;
  }


  const root =
    document.getElementById(
      SHARED_HOST_ID
    );


  if (
    !root
  ) {
    return;
  }


  /*
   * Remove every TW-specific
   * root decoration.
   */
  root.classList.remove(
    "tw-home-root",
    "tw-indicator-root",
    "tw-radar-root"
  );


  /*
   * Restore original shared shell.
   */
  root.innerHTML = `

    <div
      class="market-unavailable-icon"
    >
      OX
    </div>


    <div>

      <div
        class="page-kicker"
      >
        MARKET ARCHITECTURE READY
      </div>


      <h2
        id="market-unavailable-title"
      >
        市場
      </h2>


      <p
        id="market-unavailable-copy"
      >
        市場切換中。
      </p>

    </div>

  `;


  /*
   * Destination market decides
   * whether this host should show.
   */
  root.hidden =
    true;
}


/* ========================================================================== */
/* View preparation                                                          */
/* ========================================================================== */

function prepareSharedHostForView(
  view
) {

  if (
    typeof document ===
    "undefined"
  ) {
    return;
  }


  const root =
    document.getElementById(
      SHARED_HOST_ID
    );


  if (
    !root
  ) {
    return;
  }


  /*
   * Prevent one TW view's layout
   * leaking into another.
   */

  if (
    view !==
    "home"
  ) {

    root.classList.remove(
      "tw-home-root"
    );
  }


  if (
    view !==
    "strength"
  ) {

    root.classList.remove(
      "tw-indicator-root"
    );
  }


  if (
    view !==
    "radar"
  ) {

    root.classList.remove(
      "tw-radar-root"
    );
  }
}


/* ========================================================================== */
/* Renderers                                                                  */
/* ========================================================================== */

const renderers =
  Object.freeze({

    home:
      renderTWHome,


    /*
     * IMPORTANT:
     *
     * Internal route remains:
     *
     * strength
     *
     * User-facing name is:
     *
     * 指標
     *
     * Do not rename the internal route
     * until the global navigation
     * architecture is migrated.
     */
    strength:
      renderTWStrength,


    radar:
      renderTWRadar, stopTWRadar

  });


function isValidView(
  view
) {

  return Object.prototype
    .hasOwnProperty
    .call(
      renderers,
      view
    );
}


function render(
  state =
    createTWMarketState()
) {

  if (
    !isActive
  ) {
    return null;
  }


  const renderer =
    renderers[
      activeView
    ];


  if (
    typeof renderer !==
    "function"
  ) {
    return null;
  }


  if (activeView !== "radar") stopTWRadar();
  if (activeView !== "strength") stopTWStrength();
  if (activeView === "radar") stopResearch();
  prepareSharedHostForView(
    activeView
  );


  return renderer(state);
}


/* ========================================================================== */
/* Request lifecycle                                                         */
/* ========================================================================== */

let marketDataController;
const ensureMarketData = createPreloader(async ({silent=false}={}) => {
  const controller = new AbortController();marketDataController=controller;
  try {
  const state = await refreshTWMarketState({
    signal: controller.signal,
    force: true,
    onRadarReady(state) {
      cacheRadarState(state);
      if (isActive && activeView === "radar") render(state);
    }
  });
  cacheRadarState(state);
  if (isActive) render(state);
  return state;
  } finally { scheduleRecovery(); }
}, { usable: state => ["ready", "partial"].includes(state?.status)
  && Array.isArray(state?.data?.radar) && !radarNeedsRecovery(state) });

function loadMarketData(options = {}) {
  showSavedRadar(savedRadarSnapshot());
  bundledRadarSnapshot().then(showSavedRadar).catch(()=>{});
  const pending = ensureMarketData(options);
  if (isActive) render(createTWMarketState());
  return pending;
}

const closeRefresh=createAfterCloseRefresh(async()=>{
  await Promise.allSettled([loadMarketData({force:true,silent:true}),refreshTWResearch(),preloadBundle({force:true,silent:true})]);
  if(isActive)document.dispatchEvent(new CustomEvent('ox:tw-close-refresh'));
},{active:()=>isActive,visible:()=>!document.hidden,online:()=>navigator.onLine!==false});
let lastRecoveryAt = -Infinity;
function recoverMarketData(force = false) {
  if (!isActive || typeof document === 'undefined' || document.hidden
    || typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (!force && (!radarNeedsRecovery(createTWMarketState()) || Date.now() - lastRecoveryAt < 15000)) return;
  lastRecoveryAt = Date.now();
  return loadMarketData({ force: true });
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => closeRefresh.check());
  window.addEventListener('focus', () => closeRefresh.check());
  document.addEventListener('visibilitychange', () => closeRefresh.check());
  window.addEventListener('online', () => recoverMarketData());
  window.addEventListener('focus', () => recoverMarketData());
  document.addEventListener('visibilitychange', () => recoverMarketData());
  document.addEventListener('ox:tw-retry', () => recoverMarketData(true));
}

function preload() {
  // UI modules and the bundled official snapshot can load while Crypto is visible.
  preloadTWStrength().catch(() => {});
  return Promise.allSettled([loadMarketData(), preloadResearch(), preloadBundle()]);
}


/* ========================================================================== */
/* Taiwan module                                                              */
/* ========================================================================== */

export const twModule =
  Object.freeze({

    id:
      TW_MODULE_CONFIG.id,


    label:
      TW_MODULE_CONFIG.label,


    status:
      TW_MODULE_CONFIG.status,


    /*
     * ================================================================ *
     * Enter Taiwan Market                                              *
     * ================================================================ *
     */
    preload,

    async activate(
      {
        view =
          activeView
      } = {}
    ) {

      isActive =
        true;
      recoveryAttempts=0;

      if (
        isValidView(
          view
        )
      ) {

        activeView =
          view;
      }


      prepareSharedHostForView(
        activeView
      );


      /*
       * Render cached state immediately.
       *
       * This makes market switching
       * feel instant.
       */
      render(
        createTWMarketState()
      );


      /*
       * Then request fresh data.
       *
       * If backend is not configured,
       * Engine returns:
       *
       * status: "unconfigured"
       *
       * without crashing.
       */
      const pending=loadMarketData();
      closeRefresh.start();
      return pending;
    },


    /*
     * ================================================================ *
     * Leave Taiwan Market                                              *
     * ================================================================ *
     *
     * This MUST stay synchronous.
     *
     * Market Router calls deactivate()
     * before the next market finishes
     * activation.
     *
     * Restore the DOM immediately so
     * Crypto / US can safely
     * take control.
     */
    deactivate() {

      isActive =
        false;
      marketDataController?.abort();
      clearTimeout(recoveryTimer);
      closeRefresh.stop();

      stopTWStrength();
      stopTWRadar();
      cancelTWLookup();
      stopResearch();


      restoreSharedMarketHost();
    },


    /*
     * ================================================================ *
     * Change TW View                                                   *
     * ================================================================ *
     *
     * Switching:
     *
     * Home
     * ↕
     * Indicator
     * ↕
     * Radar
     *
     * does NOT refetch the entire
     * Taiwan market every time.
     *
     * All views consume the same
     * normalized TW state.
     */
    view(
      view
    ) {

      if (view !== "radar") cancelTWLookup();

      if (
        isValidView(
          view
        )
      ) {

        activeView =
          view;
      }


      if (
        !isActive
      ) {

        return null;
      }


      prepareSharedHostForView(
        activeView
      );


      return render(
        createTWMarketState()
      );
    },


    /*
     * ================================================================ *
     * Current synchronous state                                       *
     * ================================================================ *
     */
    refresh() {

      return createTWMarketState();
    },


    /*
     * ================================================================ *
     * Explicit fresh reload                                           *
     * ================================================================ *
     *
     * Future refresh buttons can call:
     *
     * window.OXModules
     *   .router
     *   .get("tw")
     *   .reload()
     */
    reload() {

      if (
        !isActive
      ) {

        return Promise.resolve(
          createTWMarketState()
        );
      }


      return loadMarketData({
        force:
          true
      });
    }

  });
