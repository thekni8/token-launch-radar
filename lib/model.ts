// LaunchLens scoring engine: expected implied circulating market cap.
//
// The board ranks protocols that record no token by expected value:
//   expected value = value-if-it-launches x P(it launches).
//
// Value-if-launches comes from a log-log hierarchical OLS fit calibrated on
// the snapshot's own tokenised protocols (positive TVL, positive circulating
// market cap, and both a CoinGecko id and a ticker present):
//   log(mcap) = const + slope * log(tvl) + categoryOffset
//             + growthSlope * asinh(chg7d / 100) + ageSlope * log(1 + ageYears)
// Category offsets are empirical-Bayes shrunk toward zero: a category with
// n anchors keeps n / (n + 8) of its mean residual. The growth and age terms
// survive only when 5-fold cross-validation shows they cut out-of-sample
// MdAPE. The winning specification is then stress-tested out of sample:
// 5-fold CV, leave-one-out (one refit per anchor), a newest-listed holdout,
// an ablation ladder, and out-of-bag range calibration over 250 bootstrap
// refits.
//
// P(launch) is empirical: within the protocol's (age band, category) cohort,
// the share already tokenised, shrunk toward the snapshot-wide base rate
// with weight n / (n + 10); undated protocols fall back to a category-only
// cohort with a heavier shrink (k = 20). The odds model is LOO-validated
// across every protocol in the snapshot.
//
// Units note: mcap_usd is CIRCULATING market cap, not fully-diluted value.
// A fresh launch usually floats far less than 100% of supply, so the implied
// value is the circulating market cap a token would carry at a comparable
// float, not an FDV estimate.

export interface Protocol {
  slug: string; name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
}

export interface Snapshot {
  as_of: string; source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface LaunchOddsDetail {
  probability: number;
  ageBand: string; category: string;
  cohortN: number; cohortTokenized: number;
  weight: number; baseRate: number;
}

export interface ScoredProtocol {
  protocol: Protocol;
  /** Expected value = round(valueIfLaunchUsd * launchOdds); falls with rank. */
  impliedUsd: number;
  /** P10 of expected value: conformal value band x launch odds. */
  impliedLowUsd: number;
  /** P90 of expected value: conformal value band x launch odds. */
  impliedHighUsd: number;
  /** P25 of expected value: conformal value band x launch odds. */
  impliedP25Usd: number;
  /** P75 of expected value: conformal value band x launch odds. */
  impliedP75Usd: number;
  /** Value if the protocol launches, before the launch-odds multiplier. */
  valueIfLaunchUsd: number;
  /** Conformal P10: point value x exp(q10 of the LOO log-residuals). */
  valueIfLaunchP10Usd: number;
  /** Conformal P25: point value x exp(q25 of the LOO log-residuals). */
  valueIfLaunchP25Usd: number;
  /** Conformal P75: point value x exp(q75 of the LOO log-residuals). */
  valueIfLaunchP75Usd: number;
  /** Conformal P90: point value x exp(q90 of the LOO log-residuals). */
  valueIfLaunchP90Usd: number;
  /** Empirical cohort launch probability, in [0, 1]. */
  launchOdds: number;
  launchCohort: LaunchOddsDetail;
  rankLow: number; rankHigh: number;
  watchlist: boolean;
  ageDays: number | null;
  breakdown: {
    baseUsd: number;
    categoryFactor: number;
    growthFactor: number;
    ageFactor: number;
    elasticity: number;
  };
}

export interface LooMetrics {
  n: number; mdape: number;
  medianMiss: number;
  hit2x: number; hit3x: number;
  spearman: number;
}

export interface RangeCalibrationReport {
  n: number;
  p25p75Hits: number; p25p75Rate: number;
  p10p90Hits: number; p10p90Rate: number;
  method: string;
}

// M8: conformal prediction intervals built from the winning specification's
// LOO log-residuals. The q* fields are log-point quantiles of those
// residuals; factor* is exp(q), the multiplier applied to a point value.
// The nested* rates come from a 5-fold honest re-run (calibrate on four
// folds, score the held fold), so they are not the in-sample fit.
export interface ConformalReport {
  n: number;
  meanResidual: number;
  sdResidual: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  factor10: number;
  factor25: number;
  factor75: number;
  factor90: number;
  nestedP25p75Rate: number;
  nestedP10p90Rate: number;
  method: string;
}

export interface AblationStep {
  id: string; label: string;
  n: number; mdape: number;
  medianMiss: number;
  hit2x: number; hit3x: number;
  selected: boolean;
  status: 'baseline' | 'kept' | 'dropped' | 'selected';
}

export interface LaunchOddsReport {
  total: number; tokenized: number;
  baseRate: number;
  shrinkageK: number; undatedShrinkageK: number;
  looCorrect: number; looAccuracy: number;
  baseCorrect: number; baseAccuracy: number;
  ageCutoffsDays: number[];
  ageBands: Array<{ label: string; n: number; tokenized: number; rate: number }>;
}

export interface ModelReport {
  fitN: number; outliersDropped: number;
  elasticity: number; intercept: number;
  growthCoef: number | null; ageCoef: number | null;
  growthKept: boolean; ageKept: boolean;
  cv: { mdape: number; hit2x: number; spearman: number; n: number };
  cvBig: { mdape: number; hit2x: number; spearman: number; n: number };
  baseline: { mdape: number; hit2x: number; spearman: number };
  newestHoldout: { mdape: number; hit2x: number; n: number };
  loo: LooMetrics;
  rangeCalibration: RangeCalibrationReport;
  conformal: ConformalReport;
  ablation: AblationStep[];
  launchOdds: LaunchOddsReport;
  categories: Array<{ name: string; n: number; intercept: number; weight: number }>;
  anchors: Array<{
    slug: string; name: string; category: string;
    tvl: number; actual: number;
    predicted: number; looPredicted: number;
  }>;
}

export interface Partition {
  watchlist: number; belowFloor: number;
  anchorsFit: number; anchorsOutliers: number;
  excludedWrapped: number; excludedPartial: number;
  total: number;
}

export interface FittedModel {
  report: ModelReport;
  partition: Partition;
  /** Value-if-launches (circulating market cap, USD) for a protocol. */
  predict(p: Protocol): number;
  /** Expected value = round(predict(p) * launchOdds(p).probability). */
  expectedValue(p: Protocol): number;
  /** Empirical cohort launch probability plus cohort metadata. */
  launchOdds(p: Protocol): LaunchOddsDetail;
  breakdown(p: Protocol): ScoredProtocol['breakdown'];
}

/** DefiLlama records neither a CoinGecko id nor a ticker: the protocol has no token on record. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const BRIDGE_OR_CEX = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'CEX']);
const CUSTODY_BRANDS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const RELEASE_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_TOKEN_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && BRIDGE_OR_CEX.has(p.category)) return false;
  if (RELEASE_SUFFIX.test(p.name)) return false;
  if (WRAPPED_TOKEN_WORD.test(p.name)) return false;
  for (const brand of CUSTODY_BRANDS) {
    if (p.name.startsWith(brand)) return false;
  }
  return true;
}

/** Whole days from one YYYY-MM-DD date to another (UTC), floored at zero. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const gap = Date.UTC(y2!, m2! - 1, d2!) - Date.UTC(y1!, m1! - 1, d1!);
  if (!Number.isFinite(gap)) return 0;
  return Math.max(0, Math.floor(gap / 86400000));
}

const CAT_SHRINK_K = 8;
const COHORT_SHRINK_K = 10;
const UNDATED_SHRINK_K = 20;
const OUTLIER_SD_LIMIT = 3;
const MAD_TO_SD = 1.4826;
const LARGE_TVL_USD = 10_000_000;
const BOOTSTRAP_ROUNDS = 250;
const BOOTSTRAP_SEED = 0x20261114;

interface OlsParams {
  constTerm: number;
  sizeSlope: number;
  growthSlope: number | null;
  ageSlope: number | null;
  catOffsets: Map<string, number>;
  catCounts: Map<string, number>;
  catWeights: Map<string, number>;
}

interface CohortOddsModel {
  base: number;
  totalN: number;
  tokN: number;
  ageCutoffs: number[];
  bands: string[];
  cohorts: Map<string, { n: number; tokenized: number }>;
  catTallies: Map<string, { n: number; tokenized: number }>;
  summary: LaunchOddsReport;
  estimate(p: Protocol): LaunchOddsDetail;
}

const bootstrapCache = new WeakMap<FittedModel, { asOfDate: string; refits: OlsParams[] }>();

function middleValue(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[mid]!;
  return (ordered[mid - 1]! + ordered[mid]!) / 2;
}

function interpQuantile(ordered: number[], q: number): number {
  if (ordered.length === 0) return 0;
  if (ordered.length === 1) return ordered[0]!;
  const at = q * (ordered.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const frac = at - lo;
  return ordered[lo]! * (1 - frac) + ordered[hi]! * frac;
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growthFeature(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 0;
  const clipped = Math.max(-95, Math.min(500, change7d));
  return Math.asinh(clipped / 100);
}

function ageFeature(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 0;
  return Math.log(1 + daysBetween(listedAt, asOf) / 365);
}

function solveGaussian(A: number[][], b: number[]): number[] {
  const size = b.length;
  const aug = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    let biggest = Math.abs(aug[col]![col]!);
    for (let r = col + 1; r < size; r++) {
      const cand = Math.abs(aug[r]![col]!);
      if (cand > biggest) {
        biggest = cand;
        pivot = r;
      }
    }
    if (pivot !== col) {
      const held = aug[col]!;
      aug[col] = aug[pivot]!;
      aug[pivot] = held;
    }
    const diag = aug[col]![col]!;
    if (Math.abs(diag) < 1e-12) aug[col]![col] = diag >= 0 ? 1e-12 : -1e-12;
    const pivotVal = aug[col]![col]!;
    for (let r = col + 1; r < size; r++) {
      const factor = aug[r]![col]! / pivotVal;
      for (let c = col; c <= size; c++) {
        aug[r]![c] = aug[r]![c]! - factor * aug[col]![c]!;
      }
    }
  }
  const sol = new Array<number>(size).fill(0);
  for (let i = size - 1; i >= 0; i--) {
    let acc = aug[i]![size]!;
    for (let j = i + 1; j < size; j++) acc -= aug[i]![j]! * sol[j]!;
    const got = acc / aug[i]![i]!;
    sol[i] = Number.isFinite(got) ? got : 0;
  }
  return sol;
}

function fitOlsParams(
  anchors: Protocol[],
  asOf: string,
  useGrowth: boolean,
  useAge: boolean,
  useCategory = true,
): OlsParams {
  const n = anchors.length;
  if (n === 0) {
    return {
      constTerm: 0,
      sizeSlope: 1,
      growthSlope: useGrowth ? 0 : null,
      ageSlope: useAge ? 0 : null,
      catOffsets: new Map(),
      catCounts: new Map(),
      catWeights: new Map(),
    };
  }

  const nCols = 1 + (useGrowth ? 1 : 0) + (useAge ? 1 : 0);
  const y = new Array<number>(n);
  const X: number[][] = new Array(n);
  const colMeans = new Array<number>(nCols).fill(0);
  let yMean = 0;

  for (let i = 0; i < n; i++) {
    const a = anchors[i]!;
    const yi = Math.log(a.mcap_usd!);
    y[i] = yi;
    yMean += yi;

    const row: number[] = [Math.log(a.tvl_usd)];
    if (useGrowth) row.push(growthFeature(a.change_7d));
    if (useAge) row.push(ageFeature(a.listed_at, asOf));
    X[i] = row;
    for (let j = 0; j < nCols; j++) colMeans[j]! += row[j]!;
  }
  yMean /= n;
  for (let j = 0; j < nCols; j++) colMeans[j]! /= n;

  const XtX: number[][] = Array.from({ length: nCols }, () => new Array<number>(nCols).fill(0));
  const Xty = new Array<number>(nCols).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i]!;
    const dy = y[i]! - yMean;
    for (let j = 0; j < nCols; j++) {
      const zj = row[j]! - colMeans[j]!;
      Xty[j]! += zj * dy;
      for (let k = j; k < nCols; k++) {
        XtX[j]![k]! += zj * (row[k]! - colMeans[k]!);
      }
    }
  }
  for (let j = 0; j < nCols; j++) {
    for (let k = 0; k < j; k++) XtX[j]![k] = XtX[k]![j]!;
    if (XtX[j]![j]! < 1e-12) XtX[j]![j]! += 1e-9;
  }

  const slopes = solveGaussian(XtX, Xty);
  let constTerm = yMean;
  for (let j = 0; j < nCols; j++) constTerm -= slopes[j]! * colMeans[j]!;

  let next = 0;
  const sizeSlope = slopes[next++]!;
  const growthSlope = useGrowth ? slopes[next++]! : null;
  const ageSlope = useAge ? slopes[next++]! : null;

  const catOffsets = new Map<string, number>();
  const catCounts = new Map<string, number>();
  const catWeights = new Map<string, number>();

  if (useCategory) {
    const residTotals = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const a = anchors[i]!;
      const row = X[i]!;
      let predLog = constTerm + sizeSlope * row[0]!;
      let cIdx = 1;
      if (growthSlope !== null) predLog += growthSlope * row[cIdx++]!;
      if (ageSlope !== null) predLog += ageSlope * row[cIdx++]!;
      const resid = y[i]! - predLog;
      const cat = a.category ?? 'Uncategorized';
      residTotals.set(cat, (residTotals.get(cat) ?? 0) + resid);
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }

    for (const [cat, cnt] of catCounts.entries()) {
      const meanResid = residTotals.get(cat)! / cnt;
      const w = cnt / (cnt + CAT_SHRINK_K);
      catWeights.set(cat, w);
      catOffsets.set(cat, w * meanResid);
    }
  }

  return {
    constTerm,
    sizeSlope,
    growthSlope,
    ageSlope,
    catOffsets,
    catCounts,
    catWeights,
  };
}

function decomposeValue(
  p: Protocol,
  params: OlsParams,
  asOf: string,
): ScoredProtocol['breakdown'] {
  const tvl = Number.isFinite(p.tvl_usd) && p.tvl_usd > 0 ? p.tvl_usd : 1;
  const base = Math.exp(params.constTerm + params.sizeSlope * Math.log(tvl));
  const catKey = p.category ?? 'Uncategorized';
  const catEffect = params.catOffsets.get(catKey) ?? 0;
  const catFactor = Math.exp(catEffect);
  const growthFactor =
    params.growthSlope !== null
      ? Math.exp(params.growthSlope * growthFeature(p.change_7d))
      : 1;
  const ageFactor =
    params.ageSlope !== null ? Math.exp(params.ageSlope * ageFeature(p.listed_at, asOf)) : 1;
  return {
    baseUsd: Number.isFinite(base) && base > 0 ? base : 1,
    categoryFactor: Number.isFinite(catFactor) && catFactor > 0 ? catFactor : 1,
    growthFactor: Number.isFinite(growthFactor) && growthFactor > 0 ? growthFactor : 1,
    ageFactor: Number.isFinite(ageFactor) && ageFactor > 0 ? ageFactor : 1,
    elasticity: params.sizeSlope,
  };
}

function predictUnrounded(p: Protocol, params: OlsParams, asOf: string): number {
  const parts = decomposeValue(p, params, asOf);
  const val = parts.baseUsd * parts.categoryFactor * parts.growthFactor * parts.ageFactor;
  return Number.isFinite(val) && val > 0 ? val : 1;
}

function predictValue(p: Protocol, params: OlsParams, asOf: string): number {
  const val = Math.round(predictUnrounded(p, params, asOf));
  return Number.isFinite(val) && val >= 1 ? val : 1;
}

function tiedRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j]!.v === indexed[i]!.v) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k]!.i] = avg;
    i = j;
  }
  return ranks;
}

function rankCorrelation(actuals: number[], preds: number[]): number {
  const n = actuals.length;
  if (n < 2) return 0;
  const rx = tiedRanks(actuals);
  const ry = tiedRanks(preds);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += rx[i]!;
    my += ry[i]!;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i]! - mx;
    const dy = ry[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

function scorePredictions(
  actuals: number[],
  preds: number[],
): { mdape: number; medianMiss: number; hit2x: number; hit3x: number; spearman: number; n: number } {
  const n = actuals.length;
  if (n === 0) return { mdape: 0, medianMiss: 1, hit2x: 0, hit3x: 0, spearman: 0, n: 0 };
  const apes = new Array<number>(n);
  const misses = new Array<number>(n);
  let hits2 = 0;
  let hits3 = 0;
  for (let i = 0; i < n; i++) {
    const a = actuals[i]!;
    const pr = preds[i]!;
    apes[i] = Math.abs(pr - a) / a;
    const ratio = pr >= a ? pr / a : a / pr;
    misses[i] = ratio;
    if (ratio <= 2) hits2++;
    if (ratio <= 3) hits3++;
  }
  return {
    mdape: middleValue(apes),
    medianMiss: middleValue(misses),
    hit2x: hits2 / n,
    hit3x: hits3 / n,
    spearman: rankCorrelation(actuals, preds),
    n,
  };
}

function fiveFoldCv(
  orderedAnchors: Protocol[],
  asOf: string,
  useGrowth: boolean,
  useAge: boolean,
): {
  cv: { mdape: number; hit2x: number; spearman: number; n: number };
  cvBig: { mdape: number; hit2x: number; spearman: number; n: number };
  baseline: { mdape: number; hit2x: number; spearman: number };
} {
  const n = orderedAnchors.length;
  const actuals = new Array<number>(n);
  const modelPreds = new Array<number>(n);
  const basePreds = new Array<number>(n);

  for (let fold = 0; fold < 5; fold++) {
    const train: Protocol[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === fold) testIdx.push(i);
      else train.push(orderedAnchors[i]!);
    }
    if (testIdx.length === 0 || train.length === 0) continue;

    const foldParams = fitOlsParams(train, asOf, useGrowth, useAge, true);
    const trainRatios = train.map((a) => a.mcap_usd! / a.tvl_usd);
    const medianMultiple = middleValue(trainRatios);

    for (const idx of testIdx) {
      const a = orderedAnchors[idx]!;
      actuals[idx] = a.mcap_usd!;
      modelPreds[idx] = predictValue(a, foldParams, asOf);
      basePreds[idx] = Math.max(1, Math.round(a.tvl_usd * medianMultiple));
    }
  }

  const cvFull = scorePredictions(actuals, modelPreds);
  const baseAll = scorePredictions(actuals, basePreds);

  const bigActuals: number[] = [];
  const bigPreds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (orderedAnchors[i]!.tvl_usd >= LARGE_TVL_USD) {
      bigActuals.push(actuals[i]!);
      bigPreds.push(modelPreds[i]!);
    }
  }
  const cvBigFull = scorePredictions(bigActuals, bigPreds);

  return {
    cv: { mdape: cvFull.mdape, hit2x: cvFull.hit2x, spearman: cvFull.spearman, n: cvFull.n },
    cvBig: {
      mdape: cvBigFull.mdape,
      hit2x: cvBigFull.hit2x,
      spearman: cvBigFull.spearman,
      n: cvBigFull.n,
    },
    baseline: { mdape: baseAll.mdape, hit2x: baseAll.hit2x, spearman: baseAll.spearman },
  };
}

/** Leave-one-out validation (M2) for any OLS specification. */
function looOls(
  anchors: Protocol[],
  asOf: string,
  useCategory: boolean,
  useGrowth: boolean,
  useAge: boolean,
): { metrics: LooMetrics; preds: number[] } {
  const n = anchors.length;
  const actuals = new Array<number>(n);
  const preds = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const train: Protocol[] = [];
    for (let j = 0; j < n; j++) {
      if (j !== i) train.push(anchors[j]!);
    }
    const target = anchors[i]!;
    actuals[i] = target.mcap_usd!;
    const params = fitOlsParams(train, asOf, useGrowth, useAge, useCategory);
    preds[i] = predictValue(target, params, asOf);
  }

  const m = scorePredictions(actuals, preds);
  return {
    metrics: {
      n: m.n,
      mdape: m.mdape,
      medianMiss: m.medianMiss,
      hit2x: m.hit2x,
      hit3x: m.hit3x,
      spearman: m.spearman,
    },
    preds,
  };
}

/** Leave-one-out validation for the flat global-median-multiple baseline (M4). */
function looFlatMultiple(anchors: Protocol[]): LooMetrics {
  const n = anchors.length;
  const actuals = new Array<number>(n);
  const preds = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const ratios: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j !== i) ratios.push(anchors[j]!.mcap_usd! / anchors[j]!.tvl_usd);
    }
    const target = anchors[i]!;
    actuals[i] = target.mcap_usd!;
    const mult = middleValue(ratios);
    preds[i] = Math.max(1, Math.round(target.tvl_usd * mult));
  }

  const m = scorePredictions(actuals, preds);
  return {
    n: m.n,
    mdape: m.mdape,
    medianMiss: m.medianMiss,
    hit2x: m.hit2x,
    hit3x: m.hit3x,
    spearman: m.spearman,
  };
}

/** Empirical launch-odds model (M1): age-band + category cohorts shrunk to the global base rate, LOO-validated. */
function fitCohortOdds(snapshot: Snapshot): CohortOddsModel {
  const protocols = snapshot.protocols;
  const total = protocols.length;
  let tokenized = 0;
  const datedAges: number[] = [];

  for (const p of protocols) {
    if (!isPreToken(p)) tokenized++;
    if (p.listed_at !== null) datedAges.push(daysBetween(p.listed_at, snapshot.as_of));
  }

  const baseRate = total > 0 ? tokenized / total : 0.5;
  datedAges.sort((a, b) => a - b);

  // Quintile cutoffs (Q20, Q40, Q60, Q80) across the dated protocols.
  const cutoffs =
    datedAges.length >= 5
      ? [
          Math.round(interpQuantile(datedAges, 0.2)),
          Math.round(interpQuantile(datedAges, 0.4)),
          Math.round(interpQuantile(datedAges, 0.6)),
          Math.round(interpQuantile(datedAges, 0.8)),
        ]
      : [180, 365, 730, 1095];

  const bandLabels = [
    `<${cutoffs[0]!}d`,
    `${cutoffs[0]!}–${cutoffs[1]! - 1}d`,
    `${cutoffs[1]!}–${cutoffs[2]! - 1}d`,
    `${cutoffs[2]!}–${cutoffs[3]! - 1}d`,
    `>=${cutoffs[3]!}d`,
  ];

  const ageBandOf = (p: Protocol): string => {
    if (p.listed_at === null) return 'Undated';
    const d = daysBetween(p.listed_at, snapshot.as_of);
    for (let b = 0; b < cutoffs.length; b++) {
      if (d < cutoffs[b]!) return bandLabels[b]!;
    }
    return bandLabels[bandLabels.length - 1]!;
  };

  const cohortCounts = new Map<string, { n: number; tokenized: number }>();
  const categoryCounts = new Map<string, { n: number; tokenized: number }>();
  const bandCounts = new Map<string, { n: number; tokenized: number }>();

  const bump = (
    table: Map<string, { n: number; tokenized: number }>,
    key: string,
    isTok: number,
  ): void => {
    const entry = table.get(key) ?? { n: 0, tokenized: 0 };
    entry.n += 1;
    entry.tokenized += isTok;
    table.set(key, entry);
  };

  for (const p of protocols) {
    const isTok = !isPreToken(p) ? 1 : 0;
    const band = ageBandOf(p);
    const cat = p.category ?? 'Uncategorized';
    bump(cohortCounts, `${band}||${cat}`, isTok);
    bump(categoryCounts, cat, isTok);
    bump(bandCounts, band, isTok);
  }

  const predictWithExclusion = (p: Protocol, excludeSelf: boolean): LaunchOddsDetail => {
    const isTok = !isPreToken(p) ? 1 : 0;
    const band = ageBandOf(p);
    const cat = p.category ?? 'Uncategorized';
    const adjTotal = excludeSelf ? Math.max(1, total - 1) : Math.max(1, total);
    const adjTok = excludeSelf ? tokenized - isTok : tokenized;
    const adjBaseRate = adjTok / adjTotal;

    // Undated protocols use the category-only cohort with the heavier shrink;
    // dated ones use the (band, category) cohort.
    const dated = band !== 'Undated';
    const table = dated ? cohortCounts : categoryCounts;
    const key = dated ? `${band}||${cat}` : cat;
    const shrinkK = dated ? COHORT_SHRINK_K : UNDATED_SHRINK_K;
    const raw = table.get(key) ?? { n: 0, tokenized: 0 };
    const n = Math.max(0, raw.n - (excludeSelf ? 1 : 0));
    const tok = Math.max(0, raw.tokenized - (excludeSelf ? isTok : 0));
    const w = n / (n + shrinkK);
    const empRate = n > 0 ? tok / n : adjBaseRate;
    const prob = w * empRate + (1 - w) * adjBaseRate;
    return {
      probability: Math.max(0.01, Math.min(0.99, prob)),
      ageBand: band,
      category: cat,
      cohortN: n,
      cohortTokenized: tok,
      weight: w,
      baseRate: adjBaseRate,
    };
  };

  // Leave-one-out validation across every protocol in the snapshot.
  let looCorrect = 0;
  let baseCorrect = 0;
  const majorityClass = baseRate >= 0.5;
  for (const p of protocols) {
    const actualTok = !isPreToken(p);
    const pred = predictWithExclusion(p, true);
    if ((pred.probability >= 0.5) === actualTok) looCorrect++;
    if (majorityClass === actualTok) baseCorrect++;
  }

  const orderedBandLabels = [...bandLabels, 'Undated'];
  const ageBands = orderedBandLabels
    .map((label) => {
      const entry = bandCounts.get(label) ?? { n: 0, tokenized: 0 };
      return {
        label,
        n: entry.n,
        tokenized: entry.tokenized,
        rate: entry.n > 0 ? entry.tokenized / entry.n : baseRate,
      };
    })
    .filter((b) => b.n > 0);

  const report: LaunchOddsReport = {
    total,
    tokenized,
    baseRate,
    shrinkageK: COHORT_SHRINK_K,
    undatedShrinkageK: UNDATED_SHRINK_K,
    looCorrect,
    looAccuracy: total > 0 ? looCorrect / total : 0,
    baseCorrect,
    baseAccuracy: total > 0 ? baseCorrect / total : 0,
    ageCutoffsDays: cutoffs,
    ageBands,
  };

  return {
    base: baseRate,
    totalN: total,
    tokN: tokenized,
    ageCutoffs: cutoffs,
    bands: bandLabels,
    cohorts: cohortCounts,
    catTallies: categoryCounts,
    summary: report,
    estimate(p: Protocol): LaunchOddsDetail {
      return predictWithExclusion(p, false);
    },
  };
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const watch = new Set(snapshot.watchlist);
  let watchlistCount = 0;
  let belowFloorCount = 0;
  let excludedWrappedCount = 0;
  let excludedPartialCount = 0;
  const rawAnchors: Protocol[] = [];

  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) && isPreToken(p)) {
      watchlistCount++;
      continue;
    }
    if (isPreToken(p)) {
      if (isLaunchCandidate(p)) belowFloorCount++;
      else excludedWrappedCount++;
      continue;
    }
    if (
      p.tvl_usd > 0 &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.gecko_id !== null &&
      p.symbol !== null
    ) {
      rawAnchors.push(p);
      continue;
    }
    excludedPartialCount++;
  }

  // Winsorize the anchors: drop any whose log(mcap/tvl) sits more than 3
  // robust SDs from the median log ratio.
  const logRatios = rawAnchors.map((a) => Math.log(a.mcap_usd! / a.tvl_usd));
  const medLogRatio = middleValue(logRatios);
  const absDevs = logRatios.map((lr) => Math.abs(lr - medLogRatio));
  const robustSd = MAD_TO_SD * middleValue(absDevs);

  const cleanAnchors: Protocol[] = [];
  let outliersDropped = 0;
  for (const [i, anchor] of rawAnchors.entries()) {
    if (robustSd > 0 && Math.abs(logRatios[i]! - medLogRatio) > OUTLIER_SD_LIMIT * robustSd) {
      outliersDropped++;
    } else {
      cleanAnchors.push(anchor);
    }
  }

  // Fixed anchor order (slug ascending) so CV and LOO folds are deterministic.
  const bySlug = (a: Protocol, b: Protocol): number =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  const cvAnchors = [...cleanAnchors].sort(bySlug);

  // CV feature selection: growth / age stay only if they cut out-of-sample MdAPE.
  const plainCv = fiveFoldCv(cvAnchors, snapshot.as_of, false, false);
  const growthOnlyCv = fiveFoldCv(cvAnchors, snapshot.as_of, true, false);
  const ageOnlyCv = fiveFoldCv(cvAnchors, snapshot.as_of, false, true);

  let growthKept = growthOnlyCv.cv.mdape < plainCv.cv.mdape;
  let ageKept = ageOnlyCv.cv.mdape < plainCv.cv.mdape;
  let winningCv = plainCv;

  if (growthKept && ageKept) {
    const jointCv = fiveFoldCv(cvAnchors, snapshot.as_of, true, true);
    if (jointCv.cv.mdape < Math.min(growthOnlyCv.cv.mdape, ageOnlyCv.cv.mdape)) {
      winningCv = jointCv;
    } else if (growthOnlyCv.cv.mdape <= ageOnlyCv.cv.mdape) {
      ageKept = false;
      winningCv = growthOnlyCv;
    } else {
      growthKept = false;
      winningCv = ageOnlyCv;
    }
  } else if (growthKept) {
    winningCv = growthOnlyCv;
  } else if (ageKept) {
    winningCv = ageOnlyCv;
  }

  // M4: ablation ladder, every rung scored under LOO for comparability.
  const looFlat = looFlatMultiple(cvAnchors);
  const looSize = looOls(cvAnchors, snapshot.as_of, false, false, false);
  const looCat = looOls(cvAnchors, snapshot.as_of, true, false, false);
  const looGrowth = looOls(cvAnchors, snapshot.as_of, true, true, false);
  const looAge = looOls(cvAnchors, snapshot.as_of, true, false, true);
  const looBoth = looOls(cvAnchors, snapshot.as_of, true, true, true);

  // M2: LOO validation of the exact winning specification.
  const selectedLoo =
    growthKept && ageKept ? looBoth : growthKept ? looGrowth : ageKept ? looAge : looCat;

  const ablation: AblationStep[] = [
    {
      id: 'flat', label: 'Flat global-median multiple', n: looFlat.n,
      mdape: looFlat.mdape, medianMiss: looFlat.medianMiss,
      hit2x: looFlat.hit2x, hit3x: looFlat.hit3x,
      selected: false, status: 'baseline',
    },
    {
      id: 'size', label: 'Size curve (log-log TVL)', n: looSize.metrics.n,
      mdape: looSize.metrics.mdape, medianMiss: looSize.metrics.medianMiss,
      hit2x: looSize.metrics.hit2x, hit3x: looSize.metrics.hit3x,
      selected: false, status: 'kept',
    },
    {
      id: 'category', label: '+ Shrunk category offsets', n: looCat.metrics.n,
      mdape: looCat.metrics.mdape, medianMiss: looCat.metrics.medianMiss,
      hit2x: looCat.metrics.hit2x, hit3x: looCat.metrics.hit3x,
      selected: !growthKept && !ageKept,
      status: !growthKept && !ageKept ? 'selected' : 'kept',
    },
    {
      id: 'growth', label: '+ 7d growth (asinh)', n: looGrowth.metrics.n,
      mdape: looGrowth.metrics.mdape, medianMiss: looGrowth.metrics.medianMiss,
      hit2x: looGrowth.metrics.hit2x, hit3x: looGrowth.metrics.hit3x,
      selected: growthKept && !ageKept,
      status: growthKept && !ageKept ? 'selected' : growthKept ? 'kept' : 'dropped',
    },
    {
      id: 'age', label: '+ Protocol age (log)', n: looAge.metrics.n,
      mdape: looAge.metrics.mdape, medianMiss: looAge.metrics.medianMiss,
      hit2x: looAge.metrics.hit2x, hit3x: looAge.metrics.hit3x,
      selected: !growthKept && ageKept,
      status: !growthKept && ageKept ? 'selected' : ageKept ? 'kept' : 'dropped',
    },
    {
      id: 'growth_age', label: '+ Growth & age combined', n: looBoth.metrics.n,
      mdape: looBoth.metrics.mdape, medianMiss: looBoth.metrics.medianMiss,
      hit2x: looBoth.metrics.hit2x, hit3x: looBoth.metrics.hit3x,
      selected: growthKept && ageKept,
      status: growthKept && ageKept ? 'selected' : 'dropped',
    },
  ];

  // Newest-listed cohort holdout: the newest 20% by listed_at descending (nulls last).
  const byNewestFirst = (a: Protocol, b: Protocol): number => {
    if (a.listed_at === null && b.listed_at === null) return bySlug(a, b);
    if (a.listed_at === null) return 1;
    if (b.listed_at === null) return -1;
    if (a.listed_at !== b.listed_at) return b.listed_at < a.listed_at ? -1 : 1;
    return bySlug(a, b);
  };
  const sortedNewest = [...cvAnchors].sort(byNewestFirst);
  const holdN = sortedNewest.length > 1 ? Math.max(1, Math.round(sortedNewest.length * 0.2)) : 0;
  const holdoutSet = sortedNewest.slice(0, holdN);
  const holdoutTrain = sortedNewest.slice(holdN);
  const holdoutParams = fitOlsParams(holdoutTrain, snapshot.as_of, growthKept, ageKept, true);
  const holdoutMetrics = scorePredictions(
    holdoutSet.map((a) => a.mcap_usd!),
    holdoutSet.map((a) => predictValue(a, holdoutParams, snapshot.as_of)),
  );

  // Full fit under the exact winning specification.
  const finalParams = fitOlsParams(cvAnchors, snapshot.as_of, growthKept, ageKept, true);

  // Bootstrap refits (seeded mulberry32, N = 250) kept aside for buildBoard,
  // tracking out-of-bag membership for M3 held-out range calibration.
  const rng = seededRng(BOOTSTRAP_SEED);
  const bootParamsList: OlsParams[] = [];
  const oobPredsPerAnchor: number[][] = Array.from({ length: cvAnchors.length }, () => []);

  if (cvAnchors.length > 0) {
    for (let b = 0; b < BOOTSTRAP_ROUNDS; b++) {
      const resample = new Array<Protocol>(cvAnchors.length);
      const inBag = new Uint8Array(cvAnchors.length);
      for (let i = 0; i < cvAnchors.length; i++) {
        const draw = Math.floor(rng() * cvAnchors.length);
        resample[i] = cvAnchors[draw]!;
        inBag[draw] = 1;
      }
      const bootFit = fitOlsParams(resample, snapshot.as_of, growthKept, ageKept, true);
      bootParamsList.push(bootFit);

      for (let i = 0; i < cvAnchors.length; i++) {
        if (inBag[i] === 0) {
          oobPredsPerAnchor[i]!.push(predictValue(cvAnchors[i]!, bootFit, snapshot.as_of));
        }
      }
    }
  }

  // M3: range calibration on held-out (out-of-bag) anchors from the 250 bootstrap refits.
  let p25p75Hits = 0;
  let p10p90Hits = 0;
  let calN = 0;
  for (let i = 0; i < cvAnchors.length; i++) {
    const oob = oobPredsPerAnchor[i]!;
    if (oob.length === 0) continue;
    oob.sort((a, b) => a - b);
    const actual = cvAnchors[i]!.mcap_usd!;
    const p10 = interpQuantile(oob, 0.1);
    const p25 = interpQuantile(oob, 0.25);
    const p75 = interpQuantile(oob, 0.75);
    const p90 = interpQuantile(oob, 0.9);
    calN++;
    if (actual >= p25 && actual <= p75) p25p75Hits++;
    if (actual >= p10 && actual <= p90) p10p90Hits++;
  }

  const rangeCalibration: RangeCalibrationReport = {
    n: calN,
    p25p75Hits,
    p25p75Rate: calN > 0 ? p25p75Hits / calN : 0,
    p10p90Hits,
    p10p90Rate: calN > 0 ? p10p90Hits / calN : 0,
    method: 'out-of-bag bootstrap (250 refits)',
  };

  // M1: empirical launch-odds model.
  const oddsModel = fitCohortOdds(snapshot);

  // M8: conformal bands from the winning specification's LOO log-residuals.
  // The bootstrap bands only carry parameter uncertainty, so they miss the
  // residual scatter entirely; the LOO residuals carry it. Quantiles of
  // those residuals, exponentiated, become the band multipliers. The nested
  // check below re-derives the whole thing inside 4/5 of the anchors and
  // scores the held fifth, so the reported hold rates are honest.
  const looErrs: number[] = [];
  for (let k = 0; k < cvAnchors.length; k++) {
    looErrs.push(Math.log(cvAnchors[k]!.mcap_usd!) - Math.log(selectedLoo.preds[k]!));
  }
  const errCount = looErrs.length;
  let errTotal = 0;
  for (let k = 0; k < errCount; k++) errTotal += looErrs[k]!;
  const errMean = errCount > 0 ? errTotal / errCount : 0;
  let sqDevTotal = 0;
  for (let k = 0; k < errCount; k++) {
    const dev = looErrs[k]! - errMean;
    sqDevTotal += dev * dev;
  }
  const errSd = errCount > 1 ? Math.sqrt(sqDevTotal / (errCount - 1)) : 0;
  const orderedErrs = [...looErrs].sort((a, b) => a - b);
  const q10 = interpQuantile(orderedErrs, 0.1);
  const q25 = interpQuantile(orderedErrs, 0.25);
  const q75 = interpQuantile(orderedErrs, 0.75);
  const q90 = interpQuantile(orderedErrs, 0.9);
  const factor10 = Math.exp(q10);
  const factor25 = Math.exp(q25);
  const factor75 = Math.exp(q75);
  const factor90 = Math.exp(q90);

  // Nested honest validation: same i % 5 folds as the CV code, so the split
  // is deterministic on the slug-sorted anchors.
  let innerHits = 0;
  let outerHits = 0;
  let heldCount = 0;
  for (let fold = 0; fold < 5; fold++) {
    const foldTrain: Protocol[] = [];
    const foldTest: Protocol[] = [];
    for (let k = 0; k < cvAnchors.length; k++) {
      if (k % 5 === fold) foldTest.push(cvAnchors[k]!);
      else foldTrain.push(cvAnchors[k]!);
    }
    if (foldTrain.length === 0 || foldTest.length === 0) continue;

    const foldLoo = looOls(foldTrain, snapshot.as_of, true, growthKept, ageKept);
    const foldErrs: number[] = [];
    for (let k = 0; k < foldTrain.length; k++) {
      foldErrs.push(Math.log(foldTrain[k]!.mcap_usd!) - Math.log(foldLoo.preds[k]!));
    }
    foldErrs.sort((a, b) => a - b);
    const fq10 = interpQuantile(foldErrs, 0.1);
    const fq25 = interpQuantile(foldErrs, 0.25);
    const fq75 = interpQuantile(foldErrs, 0.75);
    const fq90 = interpQuantile(foldErrs, 0.9);

    const foldFit = fitOlsParams(foldTrain, snapshot.as_of, growthKept, ageKept, true);
    for (const held of foldTest) {
      const heldPred = predictValue(held, foldFit, snapshot.as_of);
      const heldErr = Math.log(held.mcap_usd!) - Math.log(heldPred);
      heldCount++;
      if (heldErr >= fq25 && heldErr <= fq75) innerHits++;
      if (heldErr >= fq10 && heldErr <= fq90) outerHits++;
    }
  }

  const conformal: ConformalReport = {
    n: errCount,
    meanResidual: errMean,
    sdResidual: errSd,
    q10,
    q25,
    q75,
    q90,
    factor10,
    factor25,
    factor75,
    factor90,
    nestedP25p75Rate: heldCount > 0 ? innerHits / heldCount : 0,
    nestedP10p90Rate: heldCount > 0 ? outerHits / heldCount : 0,
    method: 'LOO-residual conformal, nested-validated',
  };

  const categories = [...finalParams.catCounts.entries()]
    .map(([name, n]) => ({
      name,
      n,
      intercept: finalParams.catOffsets.get(name) ?? 0,
      weight: finalParams.catWeights.get(name) ?? 0,
    }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const looPredBySlug = new Map<string, number>();
  for (let i = 0; i < cvAnchors.length; i++) {
    looPredBySlug.set(cvAnchors[i]!.slug, selectedLoo.preds[i]!);
  }

  const anchorsReport = [...cvAnchors]
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category ?? 'Uncategorized',
      tvl: a.tvl_usd,
      actual: a.mcap_usd!,
      predicted: predictValue(a, finalParams, snapshot.as_of),
      looPredicted: looPredBySlug.get(a.slug) ?? predictValue(a, finalParams, snapshot.as_of),
    }));

  const partition: Partition = {
    watchlist: watchlistCount,
    belowFloor: belowFloorCount,
    anchorsFit: cleanAnchors.length,
    anchorsOutliers: outliersDropped,
    excludedWrapped: excludedWrappedCount,
    excludedPartial: excludedPartialCount,
    total:
      watchlistCount +
      belowFloorCount +
      cleanAnchors.length +
      outliersDropped +
      excludedWrappedCount +
      excludedPartialCount,
  };

  const report: ModelReport = {
    fitN: cleanAnchors.length,
    outliersDropped,
    elasticity: finalParams.sizeSlope,
    intercept: finalParams.constTerm,
    growthCoef: finalParams.growthSlope,
    ageCoef: finalParams.ageSlope,
    growthKept,
    ageKept,
    cv: winningCv.cv,
    cvBig: winningCv.cvBig,
    baseline: winningCv.baseline,
    newestHoldout: {
      mdape: holdoutMetrics.mdape,
      hit2x: holdoutMetrics.hit2x,
      n: holdoutMetrics.n,
    },
    loo: selectedLoo.metrics,
    rangeCalibration,
    conformal,
    ablation,
    launchOdds: oddsModel.summary,
    categories,
    anchors: anchorsReport,
  };

  const fitted: FittedModel = {
    report,
    partition,
    predict(p: Protocol): number {
      return predictValue(p, finalParams, snapshot.as_of);
    },
    expectedValue(p: Protocol): number {
      const valIfLaunch = predictUnrounded(p, finalParams, snapshot.as_of);
      const odds = oddsModel.estimate(p).probability;
      const ev = Math.round(valIfLaunch * odds);
      return Number.isFinite(ev) && ev >= 1 ? ev : 1;
    },
    launchOdds(p: Protocol): LaunchOddsDetail {
      return oddsModel.estimate(p);
    },
    breakdown(p: Protocol): ScoredProtocol['breakdown'] {
      return decomposeValue(p, finalParams, snapshot.as_of);
    },
  };

  bootstrapCache.set(fitted, { asOfDate: snapshot.as_of, refits: bootParamsList });
  return fitted;
}

/**
 * Build the board: every pre-token watchlist slug, plus every other pre-token
 * protocol that is a genuine launch candidate, ranked by expected value
 * (value-if-launches x P(launch)) descending, slug ascending breaking ties.
 * Value and EV bands are conformal intervals from the LOO residuals (M8);
 * rank bands still come from the 250 deterministic bootstrap refits, since
 * parameter uncertainty is the right input for ranks.
 */
export function buildBoard(snapshot: Snapshot, model: FittedModel): ScoredProtocol[] {
  const watch = new Set(snapshot.watchlist);
  const candidates: Array<{
    protocol: Protocol;
    watchlist: boolean;
    valueIfLaunchUsd: number;
    launchCohort: LaunchOddsDetail;
    launchOdds: number;
    impliedUsd: number;
    ageDays: number | null;
    breakdown: ScoredProtocol['breakdown'];
  }> = [];

  for (const p of snapshot.protocols) {
    const onWatchlist = watch.has(p.slug) && isPreToken(p);
    if (!onWatchlist && !isLaunchCandidate(p)) continue;
    const parts = model.breakdown(p);
    const valueIfLaunchUsd = model.predict(p);
    const launchCohort = model.launchOdds(p);
    const launchOdds = launchCohort.probability;
    const impliedUsd = model.expectedValue(p);
    const ageDays = p.listed_at === null ? null : daysBetween(p.listed_at, snapshot.as_of);
    candidates.push({
      protocol: p,
      watchlist: onWatchlist,
      valueIfLaunchUsd,
      launchCohort,
      launchOdds,
      impliedUsd,
      ageDays,
      breakdown: parts,
    });
  }

  const byExpectedDesc = (
    a: { impliedUsd: number; protocol: Protocol },
    b: { impliedUsd: number; protocol: Protocol },
  ): number =>
    b.impliedUsd - a.impliedUsd ||
    (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0);
  candidates.sort(byExpectedDesc);

  const m = candidates.length;
  const boot = bootstrapCache.get(model);
  const B = boot?.refits.length ?? 0;
  const conf = model.report.conformal;

  // M8: value bands are the point value times the conformal multipliers;
  // EV bands are those (rounded) value bands times the launch odds, which
  // stay fixed per protocol. Rank bands below still use the bootstrap.
  const bandsFor = (c: (typeof candidates)[number]) => {
    const valP10 = Math.max(1, Math.round(c.valueIfLaunchUsd * conf.factor10));
    const valP25 = Math.max(1, Math.round(c.valueIfLaunchUsd * conf.factor25));
    const valP75 = Math.max(1, Math.round(c.valueIfLaunchUsd * conf.factor75));
    const valP90 = Math.max(1, Math.round(c.valueIfLaunchUsd * conf.factor90));
    return {
      impliedLowUsd: Math.max(1, Math.round(valP10 * c.launchOdds)),
      impliedHighUsd: Math.max(1, Math.round(valP90 * c.launchOdds)),
      impliedP25Usd: Math.max(1, Math.round(valP25 * c.launchOdds)),
      impliedP75Usd: Math.max(1, Math.round(valP75 * c.launchOdds)),
      valueIfLaunchP10Usd: valP10,
      valueIfLaunchP25Usd: valP25,
      valueIfLaunchP75Usd: valP75,
      valueIfLaunchP90Usd: valP90,
    };
  };

  if (m === 0 || B === 0 || !boot) {
    return candidates.map((c, idx) => ({
      protocol: c.protocol,
      impliedUsd: c.impliedUsd,
      ...bandsFor(c),
      valueIfLaunchUsd: c.valueIfLaunchUsd,
      launchOdds: c.launchOdds,
      launchCohort: c.launchCohort,
      rankLow: idx + 1,
      rankHigh: idx + 1,
      watchlist: c.watchlist,
      ageDays: c.ageDays,
      breakdown: c.breakdown,
    }));
  }

  // Only rank draws still need the bootstrap loop: one EV re-ranking per
  // refit, recording where each candidate lands.
  const rankDraws: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const order: Array<{ idx: number; ev: number; slug: string }> = candidates.map(
    (c, idx) => ({
      idx,
      ev: 0,
      slug: c.protocol.slug,
    }),
  );

  for (let b = 0; b < B; b++) {
    const params = boot.refits[b]!;
    for (let i = 0; i < m; i++) {
      const slot = order[i]!;
      const cand = candidates[i]!;
      const valFloat = predictUnrounded(cand.protocol, params, boot.asOfDate);
      slot.idx = i;
      slot.slug = cand.protocol.slug;
      slot.ev = Math.max(1, Math.round(valFloat * cand.launchOdds));
    }
    order.sort((a, c) => c.ev - a.ev || (a.slug < c.slug ? -1 : a.slug > c.slug ? 1 : 0));
    for (let r = 0; r < m; r++) {
      rankDraws[order[r]!.idx]![b] = r + 1;
    }
  }

  return candidates.map((c, idx) => {
    const pointRank = idx + 1;
    const drawsSorted = rankDraws[idx]!.sort((a, b) => a - b);

    const lowQ = Math.max(1, Math.round(interpQuantile(drawsSorted, 0.1)));
    const highQ = Math.min(m, Math.round(interpQuantile(drawsSorted, 0.9)));
    const rankLow = Math.min(pointRank, lowQ);
    const rankHigh = Math.max(pointRank, highQ);

    return {
      protocol: c.protocol,
      impliedUsd: c.impliedUsd,
      ...bandsFor(c),
      valueIfLaunchUsd: c.valueIfLaunchUsd,
      launchOdds: c.launchOdds,
      launchCohort: c.launchCohort,
      rankLow,
      rankHigh,
      watchlist: c.watchlist,
      ageDays: c.ageDays,
      breakdown: c.breakdown,
    };
  });
}
