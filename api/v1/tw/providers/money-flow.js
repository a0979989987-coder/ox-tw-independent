/*
 * OX v4.0 Modular
 * Taiwan Money Flow Provider
 *
 * Official sources:
 *
 * TWSE
 * - BFI82U
 *
 * TPEx
 * - tpex_3insti_summary
 *
 *
 * Provides:
 *
 * - Foreign institutional net flow
 * - Investment trust net flow
 * - Dealer net flow
 *
 *
 * IMPORTANT:
 *
 * - Backend only.
 * - No API secret.
 * - Amounts are TWD.
 * - Never mix different trading dates.
 * - Never manufacture unavailable data.
 */


/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const TWSE_INSTITUTIONAL_URL =
  "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day";


const TPEX_INSTITUTIONAL_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary";


const DEFAULT_TIMEOUT_MS =
  12000;


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWMoneyFlowProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_MONEY_FLOW_ERROR",

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
      "TWMoneyFlowProviderError";


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
        /\s+/g,
        ""
      );


  if (
    !cleaned ||
    cleaned ===
      "--" ||
    cleaned ===
      "---" ||
    cleaned ===
      "-" ||
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


function addNullable(
  values
) {

  const numbers =
    values.filter(
      value =>
        value !==
          null &&
        value !==
          undefined
    );


  if (
    !numbers.length
  ) {

    return null;
  }


  return numbers.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  );
}


function allNumbers(
  values
) {

  return values.every(
    value =>
      typeof value ===
        "number" &&
      Number.isFinite(
        value
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


  /*
   * Gregorian compact:
   *
   * 20260923
   */
  const gregorianCompact =
    raw.match(
      /^(\d{4})(\d{2})(\d{2})$/
    );


  if (
    gregorianCompact
  ) {

    return `${
      gregorianCompact[1]
    }-${
      gregorianCompact[2]
    }-${
      gregorianCompact[3]
    }`;
  }


  /*
   * ROC compact:
   *
   * 1150923
   */
  const rocCompact =
    raw.match(
      /^(\d{3})(\d{2})(\d{2})$/
    );


  if (
    rocCompact
  ) {

    return `${
      Number(
        rocCompact[1]
      ) +
      1911
    }-${
      rocCompact[2]
    }-${
      rocCompact[3]
    }`;
  }


  /*
   * ROC slash:
   *
   * 115/09/23
   */
  const rocSlash =
    raw.match(
      /^(\d{2,3})\/(\d{2})\/(\d{2})$/
    );


  if (
    rocSlash
  ) {

    return `${
      Number(
        rocSlash[1]
      ) +
      1911
    }-${
      rocSlash[2]
    }-${
      rocSlash[3]
    }`;
  }


  /*
   * Gregorian ISO:
   *
   * 2026-09-23
   */
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

      throw new TWMoneyFlowProviderError(
        `${source} returned HTTP ${response.status}.`,
        {
          code:
            "TW_MONEY_FLOW_HTTP_ERROR",

          source,

          status:
            response.status
        }
      );
    }


    if (
      !text
    ) {

      throw new TWMoneyFlowProviderError(
        `${source} returned an empty response.`,
        {
          code:
            "TW_MONEY_FLOW_EMPTY_RESPONSE",

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

      throw new TWMoneyFlowProviderError(
        `${source} returned invalid JSON.`,
        {
          code:
            "TW_MONEY_FLOW_INVALID_JSON",

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
      TWMoneyFlowProviderError
    ) {

      throw error;
    }


    if (
      error?.name ===
      "AbortError"
    ) {

      throw new TWMoneyFlowProviderError(
        `${source} request timed out.`,
        {
          code:
            "TW_MONEY_FLOW_TIMEOUT",

          source,

          cause:
            error
        }
      );
    }


    throw new TWMoneyFlowProviderError(
      `Unable to reach ${source}.`,
      {
        code:
          "TW_MONEY_FLOW_NETWORK_ERROR",

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

function normalizeTwseMoneyFlow(
  payload
) {

  if (
    !payload ||
    typeof payload !==
      "object" ||
    !Array.isArray(
      payload.data
    )
  ) {

    return null;
  }


  if (
    payload.stat &&
    String(
      payload.stat
    ).toUpperCase() !==
      "OK"
  ) {

    return null;
  }


  let foreignNetTwd =
    null;


  let trustNetTwd =
    null;


  let dealerProprietaryNetTwd =
    null;


  let dealerHedgeNetTwd =
    null;


  let totalInstitutionNetTwd =
    null;


  const rows =
    [];


  for (
    const row
    of payload.data
  ) {

    if (
      !Array.isArray(
        row
      ) ||
    row.length <
      4
    ) {

      continue;
    }


    const name =
      textValue(
        row[0]
      );


    const buyTwd =
      numberValue(
        row[1]
      );


    const sellTwd =
      numberValue(
        row[2]
      );


    const netTwd =
      numberValue(
        row[3]
      );


    rows.push(
      Object.freeze({

        name,

        buyTwd,

        sellTwd,

        netTwd

      })
    );


    /*
     * Foreign investors.
     *
     * Foreign dealers are excluded
     * because the official three-major
     * institution definition excludes
     * that row from the main foreign
     * investor net figure.
     */
    if (
      name.includes(
        "外資及陸資"
      ) &&
      name.includes(
        "不含"
      )
    ) {

      foreignNetTwd =
        netTwd;
    }


    if (
      name ===
        "投信"
    ) {

      trustNetTwd =
        netTwd;
    }


    if (
      name.includes(
        "自營商"
      ) &&
      name.includes(
        "自行買賣"
      )
    ) {

      dealerProprietaryNetTwd =
        netTwd;
    }


    if (
      name.includes(
        "自營商"
      ) &&
      name.includes(
        "避險"
      )
    ) {

      dealerHedgeNetTwd =
        netTwd;
    }


    if (
      name ===
        "合計"
    ) {

      totalInstitutionNetTwd =
        netTwd;
    }
  }


  const dealerNetTwd =
    addNullable([
      dealerProprietaryNetTwd,
      dealerHedgeNetTwd
    ]);


  if (
    foreignNetTwd ===
      null &&
    trustNetTwd ===
      null &&
    dealerNetTwd ===
      null
  ) {

    return null;
  }


  return Object.freeze({

    market:
      "TWSE",

    dataDate:
      normalizeDate(
        payload.date ??
        payload
          ?.params
          ?.dayDate
      ),

    foreignNetTwd,

    trustNetTwd,

    dealerNetTwd,

    dealerProprietaryNetTwd,

    dealerHedgeNetTwd,

    totalInstitutionNetTwd,

    source:
      "TWSE-BFI82U",

    rows:
      Object.freeze(
        rows
      )

  });
}


async function getTwseMoneyFlow() {

  const payload =
    await requestJSON(
      TWSE_INSTITUTIONAL_URL,
      {
        source:
          "TWSE-BFI82U"
      }
    );


  const normalized =
    normalizeTwseMoneyFlow(
      payload
    );


  if (
    !normalized
  ) {

    throw new TWMoneyFlowProviderError(
      "TWSE institutional money flow could not be normalized.",
      {
        code:
          "TWSE_MONEY_FLOW_PARSE_ERROR",

        source:
          "TWSE"
      }
    );
  }


  return normalized;
}


/* ========================================================================== */
/* TPEx                                                                       */
/* ========================================================================== */

function normalizeTpexMoneyFlow(
  payload
) {

  if (
    !Array.isArray(
      payload
    ) ||
    !payload.length
  ) {

    return null;
  }


  let foreignNetTwd =
    null;


  let trustNetTwd =
    null;


  let dealerNetTwd =
    null;


  let dealerProprietaryNetTwd =
    null;


  let dealerHedgeNetTwd =
    null;


  let totalInstitutionNetTwd =
    null;


  let dataDate =
    null;


  const rows =
    [];


  for (
    const item
    of payload
  ) {

    if (
      !item ||
      typeof item !==
        "object"
    ) {

      continue;
    }


    const name =
      textValue(
        item.Investor ??
        item.investor ??
        item.單位名稱
      );


    const buyTwd =
      numberValue(
        item.PurchaseAmount ??
        item.purchaseAmount ??
        item.買進金額
      );


    const sellTwd =
      numberValue(
        item.SaleAmount ??
        item.saleAmount ??
        item.賣出金額
      );


    const netTwd =
      numberValue(
        item.Net ??
        item.net ??
        item.買賣超
      );


    const itemDate =
      normalizeDate(
        item.Date ??
        item.date ??
        item.資料日期
      );


    if (
      !dataDate &&
      itemDate
    ) {

      dataDate =
        itemDate;
    }


    rows.push(
      Object.freeze({

        name,

        buyTwd,

        sellTwd,

        netTwd,

        dataDate:
          itemDate

      })
    );


    if (
      name.includes(
        "外資及陸資"
      ) &&
      name.includes(
        "不含"
      )
    ) {

      foreignNetTwd =
        netTwd;
    }


    if (
      name ===
        "投信"
    ) {

      trustNetTwd =
        netTwd;
    }


    /*
     * Prefer the official dealer total.
     */
    if (
      name ===
        "自營商合計"
    ) {

      dealerNetTwd =
        netTwd;
    }


    if (
      name.includes(
        "自營商"
      ) &&
      name.includes(
        "自行買賣"
      )
    ) {

      dealerProprietaryNetTwd =
        netTwd;
    }


    if (
      name.includes(
        "自營商"
      ) &&
      name.includes(
        "避險"
      )
    ) {

      dealerHedgeNetTwd =
        netTwd;
    }


    if (
      name.includes(
        "三大法人合計"
      )
    ) {

      totalInstitutionNetTwd =
        netTwd;
    }
  }


  /*
   * Fallback:
   *
   * If TPEx changes the summary payload
   * and dealer total is missing, combine
   * the two dealer subcategories.
   */
  if (
    dealerNetTwd ===
      null
  ) {

    dealerNetTwd =
      addNullable([
        dealerProprietaryNetTwd,
        dealerHedgeNetTwd
      ]);
  }


  if (
    foreignNetTwd ===
      null &&
    trustNetTwd ===
      null &&
    dealerNetTwd ===
      null
  ) {

    return null;
  }


  return Object.freeze({

    market:
      "TPEX",

    dataDate,

    foreignNetTwd,

    trustNetTwd,

    dealerNetTwd,

    dealerProprietaryNetTwd,

    dealerHedgeNetTwd,

    totalInstitutionNetTwd,

    source:
      "TPEX-3INSTI-SUMMARY",

    rows:
      Object.freeze(
        rows
      )

  });
}


async function getTpexMoneyFlow() {

  const payload =
    await requestJSON(
      TPEX_INSTITUTIONAL_URL,
      {
        source:
          "TPEX-3INSTI-SUMMARY"
      }
    );


  const normalized =
    normalizeTpexMoneyFlow(
      payload
    );


  if (
    !normalized
  ) {

    throw new TWMoneyFlowProviderError(
      "TPEx institutional money flow could not be normalized.",
      {
        code:
          "TPEX_MONEY_FLOW_PARSE_ERROR",

        source:
          "TPEX"
      }
    );
  }


  return normalized;
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

export async function getOfficialTWMoneyFlow() {

  const [
    twseResult,
    tpexResult
  ] =
    await Promise
      .allSettled([

        getTwseMoneyFlow(),

        getTpexMoneyFlow()

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

    throw new TWMoneyFlowProviderError(
      "All Taiwan institutional money flow sources failed.",
      {
        code:
          "TW_MONEY_FLOW_ALL_FAILED",

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
   * Never mix different trading dates.
   */
  const sameTradingDate =
    Boolean(
      twse &&
      tpex &&
      twse.dataDate &&
      tpex.dataDate &&
      twse.dataDate ===
        tpex.dataDate
    );


  const completeValues =
    Boolean(
      sameTradingDate &&
      allNumbers([
        twse.foreignNetTwd,
        twse.trustNetTwd,
        twse.dealerNetTwd,
        tpex.foreignNetTwd,
        tpex.trustNetTwd,
        tpex.dealerNetTwd
      ])
    );


  /*
   * Only publish the combined Taiwan
   * market numbers when both exchanges
   * represent the same trading day.
   *
   * Otherwise frontend values stay null.
   */
  const moneyFlow =
    Object.freeze({

      foreignNetTwd:
        completeValues
          ? twse.foreignNetTwd +
            tpex.foreignNetTwd
          : null,

      trustNetTwd:
        completeValues
          ? twse.trustNetTwd +
            tpex.trustNetTwd
          : null,

      dealerNetTwd:
        completeValues
          ? twse.dealerNetTwd +
            tpex.dealerNetTwd
          : null,

      /*
       * These require separate
       * official datasets.
       *
       * Do not manufacture them.
       */
      marginChangeTwd:
        null,

      bigOrderBias:
        ""

    });


  return Object.freeze({

    moneyFlow,


    markets:
      Object.freeze({

        TWSE:
          twse,

        TPEX:
          tpex

      }),


    dataDate:
      completeValues
        ? twse.dataDate
        : null,


    updatedAt:
      new Date()
        .toISOString(),


    meta:
      Object.freeze({

        provider:
          "official-tw",

        partial:
          !completeValues,

        combined:
          completeValues,

        sameTradingDate,

        dates:
          Object.freeze({

            TWSE:
              twse
                ?.dataDate ||
              null,

            TPEX:
              tpex
                ?.dataDate ||
              null

          }),

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

export const officialTWMoneyFlowProvider =
  Object.freeze({

    id:
      "official-tw-money-flow",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getMoneyFlow:
      getOfficialTWMoneyFlow

  });
