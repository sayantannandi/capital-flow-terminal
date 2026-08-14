import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

if (!API_KEY) {
  console.error("ALPHA_VANTAGE_API_KEY is missing.");
  process.exit(1);
}

/*
  EQUITY MARKET STRUCTURE V1

  17 API calls:
  - 3 market-cap ETFs
  - 3 style/breadth ETFs
  - 11 sector ETFs

  Classification:
  INFERRED ROTATION / MARKET STRUCTURE

  This is NOT confirmed capital flow.
*/

const UNIVERSE = [
  // MARKET CAP
  {
    ticker: "SPY",
    name: "S&P 500",
    group: "marketCap",
    bucket: "Large Cap",
    benchmark: true
  },
  {
    ticker: "MDY",
    name: "S&P MidCap 400",
    group: "marketCap",
    bucket: "Mid Cap"
  },
  {
    ticker: "IWM",
    name: "Russell 2000",
    group: "marketCap",
    bucket: "Small Cap"
  },

  // STYLE / BREADTH
  {
    ticker: "VUG",
    name: "Vanguard Growth",
    group: "style",
    bucket: "Growth"
  },
  {
    ticker: "VTV",
    name: "Vanguard Value",
    group: "style",
    bucket: "Value"
  },
  {
    ticker: "RSP",
    name: "S&P 500 Equal Weight",
    group: "style",
    bucket: "Equal Weight"
  },

  // GICS SECTORS
  {
    ticker: "XLK",
    name: "Technology",
    group: "sector",
    bucket: "Information Technology"
  },
  {
    ticker: "XLC",
    name: "Communication Services",
    group: "sector",
    bucket: "Communication Services"
  },
  {
    ticker: "XLY",
    name: "Consumer Discretionary",
    group: "sector",
    bucket: "Consumer Discretionary"
  },
  {
    ticker: "XLP",
    name: "Consumer Staples",
    group: "sector",
    bucket: "Consumer Staples"
  },
  {
    ticker: "XLF",
    name: "Financials",
    group: "sector",
    bucket: "Financials"
  },
  {
    ticker: "XLV",
    name: "Health Care",
    group: "sector",
    bucket: "Health Care"
  },
  {
    ticker: "XLI",
    name: "Industrials",
    group: "sector",
    bucket: "Industrials"
  },
  {
    ticker: "XLE",
    name: "Energy",
    group: "sector",
    bucket: "Energy"
  },
  {
    ticker: "XLB",
    name: "Materials",
    group: "sector",
    bucket: "Materials"
  },
  {
    ticker: "XLU",
    name: "Utilities",
    group: "sector",
    bucket: "Utilities"
  },
  {
    ticker: "XLRE",
    name: "Real Estate",
    group: "sector",
    bucket: "Real Estate"
  }
];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) return null;

  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);

  if (!valid.length) return null;

  return valid.reduce((sum, value) => sum + value, 0)
    / valid.length;
}

function stdDev(values) {
  const valid = values.filter(Number.isFinite);

  if (valid.length < 2) return 0;

  const avg = mean(valid);

  const variance =
    valid.reduce(
      (sum, value) =>
        sum + ((value - avg) ** 2),
      0
    ) / valid.length;

  return Math.sqrt(variance);
}

function calculateReturn(rows, periods) {
  if (rows.length <= periods) return null;

  const latest = rows.at(-1).close;
  const previous = rows.at(-(periods + 1)).close;

  if (!previous) return null;

  return ((latest / previous) - 1) * 100;
}

function sma(rows, periods) {
  if (rows.length < periods) return null;

  const subset = rows.slice(-periods);

  return mean(subset.map(row => row.close));
}

function averageVolume(rows, periods = 20) {
  if (rows.length < periods + 1) return null;

  /*
    Exclude today's volume so today's reading
    is compared with the preceding period.
  */
  const subset =
    rows.slice(-(periods + 1), -1);

  return mean(
    subset.map(row => row.volume)
  );
}

async function fetchTicker(asset) {
  const params = new URLSearchParams({
    function: "TIME_SERIES_DAILY",
    symbol: asset.ticker,
    outputsize: "compact",
    apikey: API_KEY
  });

  const url =
    `https://www.alphavantage.co/query?${params.toString()}`;

  console.log(`Fetching ${asset.ticker}...`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Capital-Flow-Terminal/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${asset.ticker}: HTTP ${response.status}`
    );
  }

  const json = await response.json();

  if (json.Note) {
    throw new Error(
      `${asset.ticker}: ${json.Note}`
    );
  }

  if (json.Information) {
    throw new Error(
      `${asset.ticker}: ${json.Information}`
    );
  }

  if (json["Error Message"]) {
    throw new Error(
      `${asset.ticker}: ${json["Error Message"]}`
    );
  }

  const timeSeries =
    json["Time Series (Daily)"];

  if (!timeSeries) {
    throw new Error(
      `${asset.ticker}: no daily time series returned`
    );
  }

  const rows =
    Object.entries(timeSeries)
      .map(([date, values]) => ({
        date,
        open: Number(values["1. open"]),
        high: Number(values["2. high"]),
        low: Number(values["3. low"]),
        close: Number(values["4. close"]),
        volume: Number(values["5. volume"])
      }))
      .filter(row =>
        Number.isFinite(row.close)
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date)
      );

  if (rows.length < 61) {
    throw new Error(
      `${asset.ticker}: insufficient history (${rows.length} observations)`
    );
  }

  const latest = rows.at(-1);

  const sma20 = sma(rows, 20);
  const sma50 = sma(rows, 50);
  const avgVolume20 =
    averageVolume(rows, 20);

  const volumeRatio20 =
    avgVolume20 && avgVolume20 > 0
      ? latest.volume / avgVolume20
      : null;

  return {
    ...asset,

    source: "Alpha Vantage",

    classification:
      "INFERRED ROTATION",

    asOf: latest.date,

    close: round(latest.close, 4),

    volume: latest.volume,

    returns: {
      "1D": round(
        calculateReturn(rows, 1)
      ),
      "5D": round(
        calculateReturn(rows, 5)
      ),
      "20D": round(
        calculateReturn(rows, 20)
      ),
      "60D": round(
        calculateReturn(rows, 60)
      )
    },

    trend: {
      sma20: round(sma20, 4),
      sma50: round(sma50, 4),

      vs20DMA:
        sma20
          ? round(
              ((latest.close / sma20) - 1)
              * 100
            )
          : null,

      vs50DMA:
        sma50
          ? round(
              ((latest.close / sma50) - 1)
              * 100
            )
          : null
    },

    volume: {
      latest: latest.volume,
      average20D:
        avgVolume20
          ? Math.round(avgVolume20)
          : null,
      ratio20D:
        round(volumeRatio20)
    },

    history:
      rows.slice(-65)
  };
}

function calculateZScores(data, getter) {
  const values =
    data
      .map(item => ({
        ticker: item.ticker,
        value: getter(item)
      }))
      .filter(item =>
        Number.isFinite(item.value)
      );

  const avg =
    mean(values.map(item => item.value));

  const sd =
    stdDev(
      values.map(item => item.value)
    );

  const map = new Map();

  values.forEach(item => {
    const z =
      sd === 0
        ? 0
        : (item.value - avg) / sd;

    map.set(
      item.ticker,
      z
    );
  });

  return map;
}

function scoreLabel(score) {
  if (score >= 60)
    return "Strong Leadership";

  if (score >= 25)
    return "Leadership";

  if (score > -25)
    return "Neutral";

  if (score > -60)
    return "Lagging";

  return "Strong Lagging";
}

async function main() {
  console.log(
    "Fetching Equity Market Structure V1..."
  );

  console.log(
    `Universe: ${UNIVERSE.length} ETFs`
  );

  const data = [];
  const errors = [];

  for (
    let index = 0;
    index < UNIVERSE.length;
    index++
  ) {
    const asset =
      UNIVERSE[index];

    try {
      const result =
        await fetchTicker(asset);

      data.push(result);

      console.log(
        `${asset.ticker}: ${result.close} as of ${result.asOf}`
      );
    } catch (error) {
      console.error(error.message);

      errors.push({
        ticker: asset.ticker,
        error: error.message
      });
    }

    /*
      Deliberately slow the requests.

      This makes the free API workflow
      conservative and avoids hammering
      the provider.
    */
    if (
      index <
      UNIVERSE.length - 1
    ) {
      await sleep(15000);
    }
  }

  if (data.length < 10) {
    throw new Error(
      `Only ${data.length}/${UNIVERSE.length} ETFs succeeded. Aborting.`
    );
  }

  const benchmark =
    data.find(
      item =>
        item.ticker === "SPY"
    );

  if (!benchmark) {
    throw new Error(
      "SPY benchmark missing."
    );
  }

  /*
    Calculate relative returns vs SPY.
  */

  data.forEach(item => {
    item.relative = {};

    for (
      const horizon of
      ["1D", "5D", "20D", "60D"]
    ) {
      const value =
        item.returns[horizon];

      const benchmarkValue =
        benchmark.returns[horizon];

      item.relative[horizon] =
        Number.isFinite(value) &&
        Number.isFinite(benchmarkValue)
          ? round(
              value - benchmarkValue
            )
          : null;
    }
  });

  /*
    Rotation Score

    This is an INFERRED market-structure
    score, not confirmed capital flow.

    Components:

    35% 20D relative strength
    25% 60D relative strength
    20% distance from 50DMA
    20% abnormal volume
  */

  const zRel20 =
    calculateZScores(
      data,
      item =>
        item.relative["20D"]
    );

  const zRel60 =
    calculateZScores(
      data,
      item =>
        item.relative["60D"]
    );

  const zTrend50 =
    calculateZScores(
      data,
      item =>
        item.trend.vs50DMA
    );

  const zVolume =
    calculateZScores(
      data,
      item => {
        const ratio =
          item.volume.ratio20D;

        return ratio && ratio > 0
          ? Math.log(ratio)
          : 0;
      }
    );

  data.forEach(item => {
    const raw =
      0.35 *
        (zRel20.get(item.ticker) ?? 0)
      +
      0.25 *
        (zRel60.get(item.ticker) ?? 0)
      +
      0.20 *
        (zTrend50.get(item.ticker) ?? 0)
      +
      0.20 *
        (zVolume.get(item.ticker) ?? 0);

    /*
      tanh prevents extreme outliers
      dominating the -100/+100 scale.
    */

    const score =
      Math.round(
        100 *
        Math.tanh(raw / 2)
      );

    item.rotationScore =
      Math.max(
        -100,
        Math.min(100, score)
      );

    item.rotationState =
      scoreLabel(
        item.rotationScore
      );
  });

  const sectors =
    data.filter(
      item =>
        item.group === "sector"
    );

  const breadth = {};

  for (
    const horizon of
    ["1D", "5D", "20D", "60D"]
  ) {
    const positive =
      sectors.filter(
        item =>
          item.returns[horizon] > 0
      ).length;

    const outperforming =
      sectors.filter(
        item =>
          item.relative[horizon] > 0
      ).length;

    breadth[horizon] = {
      positiveSectors: positive,
      totalSectors: sectors.length,

      positivePct:
        round(
          (positive /
            sectors.length)
          * 100,
          1
        ),

      outperformingSPY:
        outperforming,

      outperformingPct:
        round(
          (outperforming /
            sectors.length)
          * 100,
          1
        )
    };
  }

  const output = {
    schemaVersion: 1,

    generatedAt:
      new Date().toISOString(),

    terminal:
      "Global Capital Flow Terminal",

    dataType:
      "equity-market-structure",

    classification:
      "INFERRED ROTATION",

    source:
      "Alpha Vantage",

    frequency:
      "Daily / End of Day",

    benchmark:
      "SPY",

    methodology: {
      actualFlow: false,

      warning:
        "Price, relative strength, trend and volume do not prove actual capital inflows or outflows.",

      rotationScore: {
        relativeStrength20D: 0.35,
        relativeStrength60D: 0.25,
        trendVs50DMA: 0.20,
        abnormalVolume: 0.20
      }
    },

    status:
      errors.length === 0
        ? "OK"
        : "PARTIAL",

    universeRequested:
      UNIVERSE.length,

    universeSuccessful:
      data.length,

    errors,

    breadth,

    data
  };

  const outputDir =
    path.join(
      process.cwd(),
      "public",
      "data"
    );

  await fs.mkdir(
    outputDir,
    {
      recursive: true
    }
  );

  const outputFile =
    path.join(
      outputDir,
      "equity-market.json"
    );

  await fs.writeFile(
    outputFile,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `Written: ${outputFile}`
  );

  console.log(
    `Successful ETFs: ${data.length}/${UNIVERSE.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
