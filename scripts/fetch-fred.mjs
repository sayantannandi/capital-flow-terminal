import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.FRED_API_KEY;

if (!API_KEY) {
  console.error("FRED_API_KEY is missing.");
  process.exit(1);
}

const SERIES = [
  {
    id: "WALCL",
    name: "Federal Reserve Total Assets",
    shortName: "Fed Balance Sheet",
    units: "USD millions",
    frequency: "Weekly",
    category: "Liquidity",
    classification: "MACRO"
  },
  {
    id: "WDTGAL",
    name: "U.S. Treasury General Account",
    shortName: "Treasury General Account",
    units: "USD millions",
    frequency: "Weekly",
    category: "Liquidity",
    classification: "MACRO"
  },
  {
    id: "DFF",
    name: "Effective Federal Funds Rate",
    shortName: "Fed Funds Rate",
    units: "Percent",
    frequency: "Daily",
    category: "Rates",
    classification: "MACRO"
  },
  {
    id: "DGS2",
    name: "2-Year Treasury Constant Maturity Rate",
    shortName: "US 2Y Yield",
    units: "Percent",
    frequency: "Daily",
    category: "Rates",
    classification: "MACRO"
  },
  {
    id: "DGS10",
    name: "10-Year Treasury Constant Maturity Rate",
    shortName: "US 10Y Yield",
    units: "Percent",
    frequency: "Daily",
    category: "Rates",
    classification: "MACRO"
  },
  {
    id: "T10Y2Y",
    name: "10-Year Treasury Minus 2-Year Treasury",
    shortName: "10Y–2Y Curve",
    units: "Percentage points",
    frequency: "Daily",
    category: "Rates",
    classification: "MACRO"
  },
  {
    id: "DTWEXBGS",
    name: "Nominal Broad U.S. Dollar Index",
    shortName: "Broad USD",
    units: "Index",
    frequency: "Daily",
    category: "FX",
    classification: "MACRO"
  }
];

function getObservationStart() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 3);
  return date.toISOString().slice(0, 10);
}

async function fetchSeries(series) {
  const params = new URLSearchParams({
    series_id: series.id,
    api_key: API_KEY,
    file_type: "json",
    observation_start: getObservationStart(),
    sort_order: "asc"
  });

  const url =
    `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Capital-Flow-Terminal/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${series.id}: FRED returned ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();

  const observations = json.observations
    .filter(item => item.value !== ".")
    .map(item => ({
      date: item.date,
      value: Number(item.value)
    }))
    .filter(item => Number.isFinite(item.value));

  if (!observations.length) {
    throw new Error(`${series.id}: no valid observations returned.`);
  }

  const latest = observations.at(-1);
  const previous = observations.length > 1
    ? observations.at(-2)
    : null;

  const change = previous
    ? latest.value - previous.value
    : null;

  const pctChange =
    previous && previous.value !== 0
      ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
      : null;

  return {
    ...series,

    source: "FRED",
    sourceInstitution: "Federal Reserve",
    sourceSeriesId: series.id,

    asOf: latest.date,

    latest: latest.value,

    previous: previous?.value ?? null,

    change:
      change === null
        ? null
        : Number(change.toFixed(4)),

    pctChange:
      pctChange === null
        ? null
        : Number(pctChange.toFixed(4)),

    observations
  };
}

async function main() {
  console.log("Fetching FRED macro data...");

  const results = [];

  for (const series of SERIES) {
    console.log(`Fetching ${series.id}...`);

    try {
      const data = await fetchSeries(series);
      results.push(data);

      console.log(
        `${series.id}: ${data.latest} as of ${data.asOf}`
      );
    } catch (error) {
      console.error(error.message);

      results.push({
        ...series,
        source: "FRED",
        status: "ERROR",
        error: error.message,
        observations: []
      });
    }
  }

  const successful = results.filter(
    series => series.status !== "ERROR"
  );

  if (!successful.length) {
    throw new Error("All FRED series failed.");
  }

  const output = {
    schemaVersion: 1,

    generatedAt: new Date().toISOString(),

    terminal: "Global Capital Flow Terminal",

    dataType: "macro",

    classification: "MACRO",

    source: "FRED",

    status:
      successful.length === SERIES.length
        ? "OK"
        : "PARTIAL",

    seriesRequested: SERIES.length,

    seriesSuccessful: successful.length,

    data: results
  };

  const outputDir = path.join(
    process.cwd(),
    "public",
    "data"
  );

  await fs.mkdir(outputDir, {
    recursive: true
  });

  const outputFile = path.join(
    outputDir,
    "macro.json"
  );

  await fs.writeFile(
    outputFile,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(`Written: ${outputFile}`);
  console.log(
    `Successful series: ${successful.length}/${SERIES.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
