// polymarket-faa-attribution-02 entry (Node 22, standard library only): a
// quantile forecaster for Polymarket Yes prices, 240 minutes ahead.
//
// Model, fitted on the six practice cases (NVIDIA event) with a local
// pinball scorer whose truth is the next case's prices:
//   - Anchor: each market's last price x. Prediction markets for mutually
//     exclusive outcomes have Yes prices that sum to ~1, so the median is
//     pulled toward the sum-consistent level x / S (S = sum of the family's
//     last prices), strength 0.8, saturating with time constant 90 minutes:
//     the pull is small at first and (nearly) full by the end of the window.
//   - Spread: per-market sigma from the realised 1-minute volatility of the
//     last 120 minutes, shrunk 90% toward a 0.0005 floor and capped at
//     0.008, growing like h^0.4 (slower than a random walk: these prices
//     move in 0.005 ticks and sit still for long stretches). Quantiles are
//     normal around the median, clamped to [0, 1], rounded to 6 decimals.
//   - No jump-reversal and no trend term: on the practice both hurt. The
//     last price plus the sum-consistency pull is the honest median.
// Local practice (p00-p04, truth = next case): mean pinball 0.2914 vs the
// house baseline's 0.3925 on the same cases (-26%); better on every case.
// The final runs on the FAA markets, not NVIDIA, so the parameters are the
// plain, robust ones from the grid search, not a razor-thin optimum.
//
// Reads every <id>.in in the input directory and writes <id>.out to the
// output directory: {"forecasts":[{"id","q"}]}, q = 240 rows x 5 quantiles.
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

/** How strongly the median is pulled toward the sum-consistent level. */
const CROSS_STRENGTH = 0.8;
/** Time constant (minutes) over which the sum-consistency pull saturates. */
const CROSS_TAU = 90;
/** Minutes of 1-minute moves used for the realised volatility. */
const VOL_WINDOW = 120;
/** Volatility shrink toward the floor, and the floor/cap in price units. */
const VOL_SHRINK = 0.9;
const VOL_FLOOR = 0.0005;
const VOL_CAP = 0.008;
/** Spread grows like h ** SPREAD_GROWTH. */
const SPREAD_GROWTH = 0.4;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** Realised 1-minute volatility (std of moves) over the last `window` minutes. */
function realisedVol(prices: number[], window: number): number {
  const n = prices.length;
  const start = Math.max(1, n - window);
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const d = prices[i] - prices[i - 1];
    sumSq += d * d;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sumSq / count);
}

/** One market's forecast: horizon rows of the five quantiles. */
function forecast(m: CaseMarket, horizon: number, sumLast: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1];
  const vol = realisedVol(m.prices, VOL_WINDOW);
  const sigma = Math.min(VOL_CAP, Math.max(VOL_FLOOR, VOL_SHRINK * vol + (1 - VOL_SHRINK) * VOL_FLOOR));
  // Sum-consistent level: if the family's Yes prices must sum to ~1, this
  // market's fair level is its share of the current sum.
  const consistent = sumLast > 0 ? x / sumLast : x;
  const pull = consistent - x;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const median = x + CROSS_STRENGTH * pull * (1 - Math.exp(-h / CROSS_TAU));
    const spread = sigma * Math.pow(h, SPREAD_GROWTH);
    let prev = -1;
    const row = Z.map((z) => {
      let q = price6(median + z * spread);
      if (q < prev) q = prev; // rounding/clamping must never break monotonicity
      prev = q;
      return q;
    });
    rows.push(row);
  }
  return rows;
}

/** Fail loudly instead of writing an invalid case: every row must hold five
 * finite numbers in [0, 1], non-decreasing. An invalid case is scored as if
 * every quantile were 0.5, so a silent bad row is worse than a crash. */
function validateRows(rows: number[][], horizon: number, marketId: string): void {
  if (rows.length !== horizon) throw new Error(`market ${marketId}: ${rows.length} rows, want ${horizon}`);
  for (let h = 0; h < rows.length; h++) {
    const row = rows[h];
    if (row.length !== QUANTILES.length) throw new Error(`market ${marketId} row ${h}: ${row.length} quantiles`);
    for (let j = 0; j < row.length; j++) {
      const q = row[j];
      if (!Number.isFinite(q) || q < 0 || q > 1) throw new Error(`market ${marketId} row ${h} quantile ${j}: ${q}`);
      if (j > 0 && q < row[j - 1]) throw new Error(`market ${marketId} row ${h}: quantiles decrease`);
    }
  }
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const sumLast = c.markets.reduce((s, m) => s + m.prices[m.prices.length - 1], 0);
  const forecasts = c.markets.map((m) => {
    const q = forecast(m, c.horizon_minutes, sumLast);
    validateRows(q, c.horizon_minutes, m.id);
    return { id: m.id, q };
  });
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
