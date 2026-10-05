import {
  getOfficialTWBreadth
} from "./breadth.js";

import {
  getOfficialTWMarketPulse
} from "./official.js";

import {
  getOfficialTWMoneyFlow
} from "./money-flow.js";

import {
  getOfficialTWRadar
} from "./radar.js";

import {
  getOfficialTWCandles
} from "./candles.js";


/*
 * OX v4.0 Modular
 * Taiwan Indicator Provider
 *
 * Principle:
 *
 * Existing real official data
 *        ↓
 * OX calculations
 *        ↓
 * Indicator Center
 *
 *
 * No fake values.
 *
 * Unsupported indicators explicitly
 * return status: "unavailable".
 */


/* ========================================================================== */
/* Indicator IDs                                                              */
/* ========================================================================== */

const ALL_INDICATOR_IDS =
  Object.freeze([

    "marketBreadth",
    "advanceDeclineRatio",
    "newHighLow",
    "limitUpDown",
    "marketTurnover",
    "taiexVsTpex",

    "changePct",
    "volumeRatio",
    "turnoverRank",
    "volumeRank",
    "vwap",
    "amplitude",
    "turnoverRate",

    "relativeStrength",
    "maAlignment",
    "breakout20",
    "breakout60",
    "rsi",
    "kd",
    "macd",
    "atr",

    "majorHolder",
    "retailHolder",
    "branchConcentration",
    "bigOrderBias",
    "marginBalance",
    "shortBalance",

    "foreignNet",
    "trustNet",
    "dealerNet",
    "institutionStreak",
    "institutionOwnership",

    "revenueYoY",
    "revenueMoM",
    "eps",
    "roe",
    "grossMargin",
    "operatingMargin",
    "pe",
    "pb",
    "dividendYield",

    "themeStrength",
    "themeBreadth",
    "themeFlow",
    "leaderStatus",

    "nearLimitUp",
    "unusualVolume",
    "priceBreakout",
    "rapidRise",
    "revenueEvent",

    "txBasis",
    "foreignFuturesOI",
    "putCallRatio",
    "optionOI"

  ]);


/* ========================================================================== */
/* Error                                                                      */
/* ========================================================================== */

export class TWIndicatorProviderError
  extends Error {

  constructor(
    message,
    {
      code =
        "TW_INDICATORS_ERROR",

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
      "TWIndicatorProviderError";

    this.code =
      code;

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


function finiteNumber(
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


function average(
  values
) {

  const numbers =
    values.filter(
      value =>
        typeof value ===
          "number" &&
        Number.isFinite(
          value
        )
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
  ) /
  numbers.length;
}


function formatNumber(
  value,
  digits =
    2
) {

  const number =
    finiteNumber(
      value
    );

  if (
    number ===
      null
  ) {

    return "—";
  }

  return new Intl.NumberFormat(
    "zh-TW",
    {
      minimumFractionDigits:
        0,

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
    number ===
      null
  ) {

    return "—";
  }

  return `${
    number >
      0
      ? "+"
      : ""
  }${number.toFixed(
    2
  )}%`;
}


function formatTwd(
  value
) {

  const number =
    finiteNumber(
      value
    );

  if (
    number ===
      null
  ) {

    return "—";
  }

  const absolute =
    Math.abs(
      number
    );

  if (
    absolute >=
      100000000
  ) {

    return `${
      number >
        0
        ? "+"
        : ""
    }${(
      number /
      100000000
    ).toLocaleString(
      "zh-TW",
      {
        maximumFractionDigits:
          1
      }
    )} 億`;
  }

  if (
    absolute >=
      10000
  ) {

    return `${
      number >
        0
        ? "+"
        : ""
    }${(
      number /
      10000
    ).toLocaleString(
      "zh-TW",
      {
        maximumFractionDigits:
          0
      }
    )} 萬`;
  }

  return formatNumber(
    number,
    0
  );
}


/* ========================================================================== */
/* Reading                                                                    */
/* ========================================================================== */

function reading(
  value,
  display,
  note =
    ""
) {

  return Object.freeze({

    value:
      value ??
      null,

    display:
      display ??
      null,

    status:
      "ready",

    note,

    change:
      null

  });
}


function unavailable(
  note =
    "資料來源尚未接入"
) {

  return Object.freeze({

    value:
      null,

    display:
      null,

    status:
      "unavailable",

    note,

    change:
      null

  });
}


function createBaseReadings() {

  const output =
    {};

  ALL_INDICATOR_IDS
    .forEach(
      id => {

        output[id] =
          unavailable();

      }
    );

  return output;
}


/* ========================================================================== */
/* Requested IDs                                                              */
/* ========================================================================== */

function normalizeIds(
  value
) {

  if (
    !value
  ) {

    return [];
  }

  const source =
    Array.isArray(
      value
    )
      ? value
      : String(
          value
        )
          .split(
            ","
          );

  return [
    ...new Set(
      source
        .map(
          item =>
            textValue(
              item
            )
        )
        .filter(
          item =>
            ALL_INDICATOR_IDS
              .includes(
                item
              )
        )
    )
  ];
}


function filterIndicators(
  readings,
  ids
) {

  if (
    !ids.length
  ) {

    return Object.freeze(
      readings
    );
  }

  const output =
    {};

  ids.forEach(
    id => {

      if (
        readings[id]
      ) {

        output[id] =
          readings[id];
      }

    }
  );

  return Object.freeze(
    output
  );
}


/* ========================================================================== */
/* Result helpers                                                             */
/* ========================================================================== */

function resultValue(
  result
) {

  return result.status ===
    "fulfilled"
      ? result.value
      : null;
}


function resultError(
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

    message:
      result.reason
        ?.message ||
      "Unknown provider error"

  });
}


/* ========================================================================== */
/* Market indicators                                                          */
/* ========================================================================== */

function applyBreadthIndicators(
  readings,
  payload
) {

  const breadth =
    payload
      ?.breadth ||
    {};

  const advancers =
    finiteNumber(
      breadth.advancers
    );

  const decliners =
    finiteNumber(
      breadth.decliners
    );

  const unchanged =
    finiteNumber(
      breadth.unchanged
    );

  const limitUp =
    finiteNumber(
      breadth.limitUp
    );

  const limitDown =
    finiteNumber(
      breadth.limitDown
    );


  if (
    advancers !==
      null ||
    decliners !==
      null
  ) {

    readings.marketBreadth =
      reading(
        (
          advancers ??
          0
        ) -
        (
          decliners ??
          0
        ),
        `${
          formatNumber(
            advancers,
            0
          )
        } 漲 / ${
          formatNumber(
            decliners,
            0
          )
        } 跌${
          unchanged !==
            null
            ? ` / ${
                formatNumber(
                  unchanged,
                  0
                )
              } 平`
            : ""
        }`,
        "上市＋上櫃股票廣度"
      );
  }


  if (
    advancers !==
      null &&
    decliners !==
      null &&
    decliners >
      0
  ) {

    const ratio =
      advancers /
      decliners;

    readings.advanceDeclineRatio =
      reading(
        ratio,
        ratio.toFixed(
          2
        ),
        "上漲家數 ÷ 下跌家數"
      );
  }


  if (
    limitUp !==
      null ||
    limitDown !==
      null
  ) {

    readings.limitUpDown =
      reading(
        (
          limitUp ??
          0
        ) -
        (
          limitDown ??
          0
        ),
        `${
          formatNumber(
            limitUp,
            0
          )
        } 漲停 / ${
          formatNumber(
            limitDown,
            0
          )
        } 跌停`,
        "官方市場漲跌停家數"
      );
  }


  readings.newHighLow =
    unavailable(
      "20 / 60 日新高新低資料待接"
    );
}


function applyPulseIndicators(
  readings,
  payload
) {

  const pulse =
    payload
      ?.pulse ||
    {};

  const taiex =
    finiteNumber(
      pulse
        ?.TAIEX
        ?.changePct
    );

  const tpex =
    finiteNumber(
      pulse
        ?.TPEX
        ?.changePct
    );


  if (
    taiex !==
      null ||
    tpex !==
      null
  ) {

    readings.taiexVsTpex =
      reading(
        (
          taiex ??
          0
        ) -
        (
          tpex ??
          0
        ),
        `TAIEX ${
          formatPercent(
            taiex
          )
        } / TPEX ${
          formatPercent(
            tpex
          )
        }`,
        "大型權值與中小型股環境"
      );
  }
}


function applyMoneyFlowIndicators(
  readings,
  payload
) {

  const money =
    payload
      ?.moneyFlow ||
    {};

  const foreign =
    finiteNumber(
      money.foreignNetTwd
    );

  const trust =
    finiteNumber(
      money.trustNetTwd
    );

  const dealer =
    finiteNumber(
      money.dealerNetTwd
    );


  if (
    foreign !==
      null
  ) {

    readings.foreignNet =
      reading(
        foreign,
        formatTwd(
          foreign
        ),
        "全市場外資買賣超"
      );
  }


  if (
    trust !==
      null
  ) {

    readings.trustNet =
      reading(
        trust,
        formatTwd(
          trust
        ),
        "全市場投信買賣超"
      );
  }


  if (
    dealer !==
      null
  ) {

    readings.dealerNet =
      reading(
        dealer,
        formatTwd(
          dealer
        ),
        "全市場自營商買賣超"
      );
  }
}


/* ========================================================================== */
/* Radar-derived market indicators                                            */
/* ========================================================================== */

function buildTopTheme(
  rows
) {

  const groups =
    new Map();


  rows.forEach(
    row => {

      const theme =
        textValue(
          row.theme ||
          row.industry
        );

      const changePct =
        finiteNumber(
          row.changePct
        );

      if (
        !theme ||
        changePct ===
          null
      ) {

        return;
      }


      if (
        !groups.has(
          theme
        )
      ) {

        groups.set(
          theme,
          {
            name:
              theme,

            sum:
              0,

            count:
              0,

            advancers:
              0,

            decliners:
              0,

            leader:
              null
          }
        );
      }


      const group =
        groups.get(
          theme
        );


      group.sum +=
        changePct;

      group.count +=
        1;


      if (
        changePct >
        0
      ) {

        group.advancers +=
          1;

      } else if (
        changePct <
        0
      ) {

        group.decliners +=
          1;
      }


      if (
        !group.leader ||
        changePct >
          group.leader.changePct
      ) {

        group.leader = {

          symbol:
            row.symbol,

          name:
            row.name,

          changePct

        };
      }

    }
  );


  const themes =
    [
      ...groups.values()
    ]
      .filter(
        item =>
          item.count >=
          2
      )
      .map(
        item => ({

          ...item,

          averageChange:
            item.sum /
            item.count

        })
      )
      .sort(
        (
          a,
          b
        ) =>
          b.averageChange -
          a.averageChange
      );


  return themes[0] ||
    null;
}


function rankedPosition(
  rows,
  symbol,
  key
) {

  const sorted =
    rows
      .filter(
        row =>
          finiteNumber(
            row[key]
          ) !==
          null
      )
      .sort(
        (
          a,
          b
        ) =>
          finiteNumber(
            b[key]
          ) -
          finiteNumber(
            a[key]
          )
      );


  const index =
    sorted.findIndex(
      row =>
        row.symbol ===
        symbol
    );


  if (
    index <
      0
  ) {

    return null;
  }


  return {

    rank:
      index +
      1,

    total:
      sorted.length

  };
}


function applyRadarMarketIndicators(
  readings,
  payload
) {

  const rows =
    Array.isArray(
      payload?.radar
    )
      ? payload.radar
      : [];


  if (
    !rows.length
  ) {

    return;
  }


  const turnover =
    rows.reduce(
      (
        total,
        row
      ) => {

        const value =
          finiteNumber(
            row.turnoverTwd
          );

        return total +
          (
            value ??
            0
          );

      },
      0
    );


  if (
    turnover >
      0
  ) {

    readings.marketTurnover =
      reading(
        turnover,
        formatTwd(
          turnover
        ),
        "OX 普通股股票池成交額，不含 ETF 等商品"
      );
  }


  const topTurnover =
    [
      ...rows
    ]
      .filter(
        row =>
          finiteNumber(
            row.turnoverTwd
          ) !==
          null
      )
      .sort(
        (
          a,
          b
        ) =>
          b.turnoverTwd -
          a.turnoverTwd
      )[0];


  if (
    topTurnover
  ) {

    readings.turnoverRank =
      reading(
        1,
        `#1 ${
          topTurnover.symbol
        } ${
          topTurnover.name ||
          ""
        }`,
        `成交額 ${
          formatTwd(
            topTurnover.turnoverTwd
          )
        }`
      );
  }


  const topVolume =
    [
      ...rows
    ]
      .filter(
        row =>
          finiteNumber(
            row.volume
          ) !==
          null
      )
      .sort(
        (
          a,
          b
        ) =>
          b.volume -
          a.volume
      )[0];


  if (
    topVolume
  ) {

    readings.volumeRank =
      reading(
        1,
        `#1 ${
          topVolume.symbol
        } ${
          topVolume.name ||
          ""
        }`,
        "今日成交量最高股票"
      );
  }


  const theme =
    buildTopTheme(
      rows
    );


  if (
    theme
  ) {

    readings.themeStrength =
      reading(
        theme.averageChange,
        `${
          theme.name
        } ${
          formatPercent(
            theme.averageChange
          )
        }`,
        "官方產業分類平均漲跌幅"
      );


    readings.themeBreadth =
      reading(
        theme.advancers -
        theme.decliners,
        `${
          theme.advancers
        } 漲 / ${
          theme.decliners
        } 跌`,
        `目前最強族群：${theme.name}`
      );


    if (
      theme.leader
    ) {

      readings.leaderStatus =
        reading(
          theme.leader.changePct,
          `${
            theme.leader.symbol
          } ${
            theme.leader.name ||
            ""
          }`,
          `${
            theme.name
          } 領頭股 · ${
            formatPercent(
              theme.leader.changePct
            )
          }`
        );
    }
  }


  const rapidCount =
    rows.filter(
      row =>
        finiteNumber(
          row.changePct
        ) !==
          null &&
        row.changePct >=
          5
    )
      .length;


  readings.rapidRise =
    reading(
      rapidCount,
      `${
        rapidCount
      } 檔`,
      "本版定義：單日漲幅 ≥ 5%"
    );
}


/* ========================================================================== */
/* Technical calculations                                                     */
/* ========================================================================== */

function sma(
  values,
  period
) {

  if (
    values.length <
      period
  ) {

    return null;
  }

  return average(
    values.slice(
      -period
    )
  );
}


function emaSeries(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];
  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  const output =
    [];

  let current =
    values[0];


  output.push(
    current
  );


  for (
    let index =
      1;
    index <
      values.length;
    index +=
      1
  ) {

    current =
      (
        values[index] *
        multiplier
      ) +
      (
        current *
        (
          1 -
          multiplier
        )
      );


    output.push(
      current
    );
  }


  return output;
}


function calculateRSI(
  closes,
  period =
    14
) {

  if (
    closes.length <=
      period
  ) {

    return null;
  }


  let gains =
    0;

  let losses =
    0;


  for (
    let index =
      1;
    index <=
      period;
    index +=
      1
  ) {

    const change =
      closes[index] -
      closes[index - 1];


    if (
      change >
        0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(
          change
        );
    }
  }


  let averageGain =
    gains /
    period;

  let averageLoss =
    losses /
    period;


  for (
    let index =
      period +
      1;
    index <
      closes.length;
    index +=
      1
  ) {

    const change =
      closes[index] -
      closes[index - 1];


    const gain =
      Math.max(
        change,
        0
      );


    const loss =
      Math.max(
        -change,
        0
      );


    averageGain =
      (
        averageGain *
        (
          period -
          1
        ) +
        gain
      ) /
      period;


    averageLoss =
      (
        averageLoss *
        (
          period -
          1
        ) +
        loss
      ) /
      period;
  }


  if (
    averageLoss ===
      0
  ) {

    return 100;
  }


  const relativeStrength =
    averageGain /
    averageLoss;


  return 100 -
    (
      100 /
      (
        1 +
        relativeStrength
      )
    );
}


function calculateKD(
  candles,
  period =
    9
) {

  if (
    candles.length <
      period
  ) {

    return null;
  }


  let k =
    50;

  let d =
    50;


  for (
    let index =
      period -
      1;
    index <
      candles.length;
    index +=
      1
  ) {

    const window =
      candles.slice(
        index -
        period +
        1,
        index +
        1
      );


    const highs =
      window
        .map(
          item =>
            finiteNumber(
              item.high
            )
        )
        .filter(
          value =>
            value !==
            null
        );


    const lows =
      window
        .map(
          item =>
            finiteNumber(
              item.low
            )
        )
        .filter(
          value =>
            value !==
            null
        );


    const close =
      finiteNumber(
        candles[index]
          .close
      );


    if (
      !highs.length ||
      !lows.length ||
      close ===
        null
    ) {

      continue;
    }


    const highest =
      Math.max(
        ...highs
      );


    const lowest =
      Math.min(
        ...lows
      );


    if (
      highest ===
        lowest
    ) {

      continue;
    }


    const rsv =
      (
        (
          close -
          lowest
        ) /
        (
          highest -
          lowest
        )
      ) *
      100;


    k =
      (
        2 /
        3
      ) *
      k +
      (
        1 /
        3
      ) *
      rsv;


    d =
      (
        2 /
        3
      ) *
      d +
      (
        1 /
        3
      ) *
      k;
  }


  return {

    k,

    d

  };
}


function calculateMACD(
  closes
) {

  if (
    closes.length <
      26
  ) {

    return null;
  }


  const ema12 =
    emaSeries(
      closes,
      12
    );


  const ema26 =
    emaSeries(
      closes,
      26
    );


  const dif =
    closes.map(
      (
        value,
        index
      ) =>
        ema12[index] -
        ema26[index]
    );


  const signal =
    emaSeries(
      dif,
      9
    );


  const lastIndex =
    closes.length -
    1;


  return {

    dif:
      dif[
        lastIndex
      ],

    signal:
      signal[
        lastIndex
      ],

    histogram:
      dif[
        lastIndex
      ] -
      signal[
        lastIndex
      ]

  };
}


function calculateATR(
  candles,
  period =
    14
) {

  if (
    candles.length <=
      period
  ) {

    return null;
  }


  const trueRanges =
    [];


  for (
    let index =
      1;
    index <
      candles.length;
    index +=
      1
  ) {

    const high =
      finiteNumber(
        candles[index]
          .high
      );


    const low =
      finiteNumber(
        candles[index]
          .low
      );


    const previousClose =
      finiteNumber(
        candles[index - 1]
          .close
      );


    if (
      high ===
        null ||
      low ===
        null ||
      previousClose ===
        null
    ) {

      continue;
    }


    trueRanges.push(
      Math.max(

        high -
        low,

        Math.abs(
          high -
          previousClose
        ),

        Math.abs(
          low -
          previousClose
        )

      )
    );
  }


  if (
    trueRanges.length <
      period
  ) {

    return null;
  }


  return average(
    trueRanges.slice(
      -period
    )
  );
}


function calculateBreakout(
  candles,
  period
) {

  if (
    candles.length <
      period +
      1
  ) {

    return null;
  }


  const latest =
    candles[
      candles.length -
      1
    ];


  const previous =
    candles.slice(
      -period -
      1,
      -1
    );


  const highs =
    previous
      .map(
        item =>
          finiteNumber(
            item.high
          )
      )
      .filter(
        value =>
          value !==
          null
      );


  const close =
    finiteNumber(
      latest.close
    );


  if (
    highs.length <
      period ||
    close ===
      null
  ) {

    return null;
  }


  return close >
    Math.max(
      ...highs
    );
}


/* ========================================================================== */
/* Symbol indicators                                                          */
/* ========================================================================== */

function applySymbolSnapshot(
  readings,
  row,
  radarRows
) {

  if (
    !row
  ) {

    readings.changePct =
      unavailable(
        "找不到指定股票"
      );

    return;
  }


  const changePct =
    finiteNumber(
      row.changePct
    );


  if (
    changePct !==
      null
  ) {

    readings.changePct =
      reading(
        changePct,
        formatPercent(
          changePct
        ),
        `${
          row.symbol
        } ${
          row.name ||
          ""
        }`
      );
  }


  const turnoverRank =
    rankedPosition(
      radarRows,
      row.symbol,
      "turnoverTwd"
    );


  if (
    turnoverRank
  ) {

    readings.turnoverRank =
      reading(
        turnoverRank.rank,
        `#${
          turnoverRank.rank
        } / ${
          turnoverRank.total
        }`,
        "全市場普通股成交額排名"
      );
  }


  const volumeRank =
    rankedPosition(
      radarRows,
      row.symbol,
      "volume"
    );


  if (
    volumeRank
  ) {

    readings.volumeRank =
      reading(
        volumeRank.rank,
        `#${
          volumeRank.rank
        } / ${
          volumeRank.total
        }`,
        "全市場普通股成交量排名"
      );
  }


  readings.foreignNet =
    unavailable(
      "目前已接全市場外資資料，個股外資待接"
    );

  readings.trustNet =
    unavailable(
      "目前已接全市場投信資料，個股投信待接"
    );

  readings.dealerNet =
    unavailable(
      "目前已接全市場自營商資料，個股資料待接"
    );


  if (
    changePct !==
      null
  ) {

    const rapid =
      changePct >=
      5;


    readings.rapidRise =
      reading(
        rapid,
        rapid
          ? "是"
          : "否",
        "本版定義：單日漲幅 ≥ 5%"
      );
  }
}


function applyTechnicalIndicators(
  readings,
  candlePayload
) {

  const candles =
    Array.isArray(
      candlePayload
        ?.candles
    )
      ? candlePayload.candles
      : [];


  const valid =
    candles.filter(
      candle =>
        finiteNumber(
          candle.close
        ) !==
        null
    );


  if (
    !valid.length
  ) {

    return;
  }


  const closes =
    valid.map(
      candle =>
        finiteNumber(
          candle.close
        )
    );


  const latest =
    valid[
      valid.length -
      1
    ];


  const previous =
    valid.length >=
      2
      ? valid[
          valid.length -
          2
        ]
      : null;


  /* ------------------------------------------------------------------------ */
  /* Volume ratio                                                             */
  /* ------------------------------------------------------------------------ */

  if (
    valid.length >=
      21
  ) {

    const latestVolume =
      finiteNumber(
        latest.volume
      );


    const previousVolumes =
      valid
        .slice(
          -21,
          -1
        )
        .map(
          candle =>
            finiteNumber(
              candle.volume
            )
        )
        .filter(
          value =>
            value !==
            null
        );


    const averageVolume =
      average(
        previousVolumes
      );


    if (
      latestVolume !==
        null &&
      averageVolume !==
        null &&
      averageVolume >
        0
    ) {

      const ratio =
        latestVolume /
        averageVolume;


      readings.volumeRatio =
        reading(
          ratio,
          `${
            ratio.toFixed(
              2
            )
          }x`,
          "最新成交量 ÷ 前 20 日平均量"
        );


      readings.unusualVolume =
        reading(
          ratio >=
            2,
          ratio >=
            2
            ? "是"
            : "否",
          "本版定義：量比 ≥ 2x"
        );
    }
  }


  /* ------------------------------------------------------------------------ */
  /* Amplitude                                                                */
  /* ------------------------------------------------------------------------ */

  const high =
    finiteNumber(
      latest.high
    );


  const low =
    finiteNumber(
      latest.low
    );


  const previousClose =
    finiteNumber(
      previous
        ?.close
    );


  if (
    high !==
      null &&
    low !==
      null &&
    previousClose !==
      null &&
    previousClose >
      0
  ) {

    const amplitude =
      (
        (
          high -
          low
        ) /
        previousClose
      ) *
      100;


    readings.amplitude =
      reading(
        amplitude,
        `${
          amplitude.toFixed(
            2
          )
        }%`,
        "當日高低差 ÷ 前一日收盤"
      );
  }


  /* ------------------------------------------------------------------------ */
  /* Moving averages                                                          */
  /* ------------------------------------------------------------------------ */

  const ma5 =
    sma(
      closes,
      5
    );


  const ma20 =
    sma(
      closes,
      20
    );


  const ma60 =
    sma(
      closes,
      60
    );


  if (
    ma5 !==
      null &&
    ma20 !==
      null &&
    ma60 !==
      null
  ) {

    let structure =
      "糾結";


    if (
      ma5 >
        ma20 &&
      ma20 >
        ma60
    ) {

      structure =
        "多頭排列";

    } else if (
      ma5 <
        ma20 &&
      ma20 <
        ma60
    ) {

      structure =
        "空頭排列";
    }


    readings.maAlignment =
      reading(
        structure,
        structure,
        `MA5 ${
          formatNumber(
            ma5
          )
        } / MA20 ${
          formatNumber(
            ma20
          )
        } / MA60 ${
          formatNumber(
            ma60
          )
        }`
      );
  }


  /* ------------------------------------------------------------------------ */
  /* Breakouts                                                                */
  /* ------------------------------------------------------------------------ */

  const breakout20 =
    calculateBreakout(
      valid,
      20
    );


  if (
    breakout20 !==
      null
  ) {

    readings.breakout20 =
      reading(
        breakout20,
        breakout20
          ? "突破"
          : "未突破",
        "收盤價是否高於前 20 個交易日最高價"
      );
  }


  const breakout60 =
    calculateBreakout(
      valid,
      60
    );


  if (
    breakout60 !==
      null
  ) {

    readings.breakout60 =
      reading(
        breakout60,
        breakout60
          ? "突破"
          : "未突破",
        "收盤價是否高於前 60 個交易日最高價"
      );
  }


  if (
    breakout20 !==
      null ||
    breakout60 !==
      null
  ) {

    const label =
      breakout60
        ? "60D 突破"
        : breakout20
          ? "20D 突破"
          : "未突破";


    readings.priceBreakout =
      reading(
        Boolean(
          breakout20 ||
          breakout60
        ),
        label,
        "OX 價格結構"
      );
  }


  /* ------------------------------------------------------------------------ */
  /* RSI                                                                      */
  /* ------------------------------------------------------------------------ */

  const rsi =
    calculateRSI(
      closes,
      14
    );


  if (
    rsi !==
      null
  ) {

    readings.rsi =
      reading(
        rsi,
        rsi.toFixed(
          1
        ),
        "RSI 14"
      );
  }


  /* ------------------------------------------------------------------------ */
  /* KD                                                                       */
  /* ------------------------------------------------------------------------ */

  const kd =
    calculateKD(
      valid,
      9
    );


  if (
    kd
  ) {

    readings.kd =
      reading(
        kd.k,
        `K ${
          kd.k.toFixed(
            1
          )
        } / D ${
          kd.d.toFixed(
            1
          )
        }`,
        "KD 9"
      );
  }


  /* ------------------------------------------------------------------------ */
  /* MACD                                                                     */
  /* ------------------------------------------------------------------------ */

  const macd =
    calculateMACD(
      closes
    );


  if (
    macd
  ) {

    readings.macd =
      reading(
        macd.histogram,
        `DIF ${
          macd.dif.toFixed(
            2
          )
        } / OSC ${
          macd.histogram.toFixed(
            2
          )
        }`,
        "MACD 12 / 26 / 9"
      );
  }


  /* ------------------------------------------------------------------------ */
  /* ATR                                                                      */
  /* ------------------------------------------------------------------------ */

  const atr =
    calculateATR(
      valid,
      14
    );


  if (
    atr !==
      null
  ) {

    readings.atr =
      reading(
        atr,
        formatNumber(
          atr,
          2
        ),
        "ATR 14"
      );
  }
}


/* ========================================================================== */
/* Explicit unavailable notes                                                 */
/* ========================================================================== */

function applyUnavailableNotes(
  readings
) {

  const notes = {

    newHighLow:
      "20 / 60 日全市場新高新低統計待接",

    vwap:
      "需要盤中逐筆或分鐘價量資料",

    turnoverRate:
      "流通股數／股本換手資料待接",

    relativeStrength:
      "需個股與大盤歷史比較序列，暫不以 OX Score 冒充 RS",

    majorHolder:
      "集保股權分散資料待接",

    retailHolder:
      "集保股權分散資料待接",

    branchConcentration:
      "券商分點資料待接",

    bigOrderBias:
      "逐筆大單資料待接",

    marginBalance:
      "融資餘額資料待接",

    shortBalance:
      "融券餘額資料待接",

    institutionStreak:
      "個股法人歷史序列待接",

    institutionOwnership:
      "法人持股比例資料待接",

    revenueYoY:
      "月營收指標資料待接",

    revenueMoM:
      "月營收指標資料待接",

    eps:
      "財報 EPS 資料待接",

    roe:
      "財報 ROE 資料待接",

    grossMargin:
      "財報毛利率資料待接",

    operatingMargin:
      "財報營業利益率資料待接",

    pe:
      "估值資料待接",

    pb:
      "估值資料待接",

    dividendYield:
      "殖利率資料待接",

    themeFlow:
      "目前不以成交額冒充族群資金流",

    nearLimitUp:
      "個股精確漲停價距離資料待接",

    revenueEvent:
      "月營收事件資料待接",

    txBasis:
      "TAIFEX 台指期資料待接",

    foreignFuturesOI:
      "TAIFEX 外資期貨未平倉資料待接",

    putCallRatio:
      "TAIFEX Put / Call Ratio 資料待接",

    optionOI:
      "TAIFEX 選擇權未平倉資料待接"

  };


  Object
    .entries(
      notes
    )
    .forEach(
      (
        [
          id,
          note
        ]
      ) => {

        if (
          readings[id]
            ?.status ===
            "unavailable"
        ) {

          readings[id] =
            unavailable(
              note
            );
        }

      }
    );
}


/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

export async function getOfficialTWIndicators(
  {
    symbol =
      null,

    ids =
      []
  } = {}
) {

  const requestedSymbol =
    textValue(
      symbol
    )
      .toUpperCase() ||
    null;


  const requestedIds =
    normalizeIds(
      ids
    );


  const readings =
    createBaseReadings();


  /*
   * Fetch only the sources required
   * for the current Indicator Center.
   */
  const [
    breadthResult,
    pulseResult,
    moneyResult,
    radarResult
  ] =
    await Promise.allSettled([

      getOfficialTWBreadth(),

      getOfficialTWMarketPulse(),

      getOfficialTWMoneyFlow(),

      getOfficialTWRadar(
        {
          market:
            "ALL",

          tier:
            "ALL",

          sort:
            "oxScore",

          limit:
            2000
        }
      )

    ]);


  const marketResults =
    [
      breadthResult,
      pulseResult,
      moneyResult,
      radarResult
    ];


  const successCount =
    marketResults.filter(
      result =>
        result.status ===
        "fulfilled"
    )
      .length;


  if (
    successCount ===
      0
  ) {

    throw new TWIndicatorProviderError(
      "All Taiwan indicator data sources failed.",
      {
        code:
          "TW_INDICATORS_ALL_SOURCES_FAILED",

        details: {

          breadth:
            resultError(
              breadthResult
            ),

          pulse:
            resultError(
              pulseResult
            ),

          moneyFlow:
            resultError(
              moneyResult
            ),

          radar:
            resultError(
              radarResult
            )

        }
      }
    );
  }


  const breadth =
    resultValue(
      breadthResult
    );


  const pulse =
    resultValue(
      pulseResult
    );


  const moneyFlow =
    resultValue(
      moneyResult
    );


  const radarPayload =
    resultValue(
      radarResult
    );


  applyBreadthIndicators(
    readings,
    breadth
  );


  applyPulseIndicators(
    readings,
    pulse
  );


  applyMoneyFlowIndicators(
    readings,
    moneyFlow
  );


  applyRadarMarketIndicators(
    readings,
    radarPayload
  );


  let candleResult =
    null;


  /*
   * Optional stock-specific mode.
   *
   * Current TW Engine asks for market
   * indicators without a symbol.
   *
   * Future stock-detail UI can pass a
   * symbol and immediately reuse this API.
   */
  if (
    requestedSymbol
  ) {

    const radarRows =
      Array.isArray(
        radarPayload
          ?.radar
      )
        ? radarPayload.radar
        : [];


    const row =
      radarRows.find(
        item =>
          textValue(
            item.symbol
          )
            .toUpperCase() ===
          requestedSymbol
      ) ||
      null;


    applySymbolSnapshot(
      readings,
      row,
      radarRows
    );


    candleResult =
      await Promise.allSettled([

        getOfficialTWCandles(
          requestedSymbol,
          {
            interval:
              "1D",

            range:
              "6M",

            limit:
              160,

            adjusted:
              false
          }
        )

      ]);


    if (
      candleResult[0]
        .status ===
        "fulfilled"
    ) {

      applyTechnicalIndicators(
        readings,
        candleResult[0]
          .value
      );
    }
  }


  applyUnavailableNotes(
    readings
  );


  const output =
    filterIndicators(
      readings,
      requestedIds
    );


  const failures =
    4 -
    successCount;


  const candleFailure =
    requestedSymbol &&
    candleResult &&
    candleResult[0]
      ?.status ===
      "rejected";


  return Object.freeze({

    indicators:
      output,

    symbol:
      requestedSymbol,

    updatedAt:
      new Date()
        .toISOString(),

    meta:
      Object.freeze({

        provider:
          "official-tw",

        methodology:
          "official-data-derived-indicators-v1",

        partial:
          failures >
            0 ||
          Boolean(
            candleFailure
          ),

        requestedIds:
          Object.freeze(
            requestedIds
          ),

        sources:
          Object.freeze({

            breadth:
              breadthResult.status,

            pulse:
              pulseResult.status,

            moneyFlow:
              moneyResult.status,

            radar:
              radarResult.status,

            candles:
              requestedSymbol
                ? candleResult?.[0]
                    ?.status ||
                  "not-requested"
                : "not-requested"

          }),

        errors:
          Object.freeze({

            breadth:
              resultError(
                breadthResult
              ),

            pulse:
              resultError(
                pulseResult
              ),

            moneyFlow:
              resultError(
                moneyResult
              ),

            radar:
              resultError(
                radarResult
              ),

            candles:
              requestedSymbol &&
              candleResult
                ? resultError(
                    candleResult[0]
                  )
                : null

          })

      })

  });
}


/* ========================================================================== */
/* Provider descriptor                                                        */
/* ========================================================================== */

export const officialTWIndicatorProvider =
  Object.freeze({

    id:
      "official-tw-indicators",

    market:
      "tw",

    realtime:
      false,

    secretRequired:
      false,

    getIndicators:
      getOfficialTWIndicators

  });
