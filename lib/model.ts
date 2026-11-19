// LaunchLens value & launch-odds model: Expected Implied Circulating Market Cap.
//
// 1. Value model (value-if-launches):
// Calibrates a unified log-log hierarchical OLS model from the snapshot's own
// tokenized protocols (those recording positive TVL, positive circulating
// market cap, and both a CoinGecko id and ticker):
//   log(mcap_usd) = intercept + elasticity * log(tvl_usd) + categoryEffect
//                   + growthCoef * g(change_7d) + ageCoef * logAge
// where category effects are empirical-Bayes shrunk intercepts toward 0:
//   effect_c = w_c * meanResidual_c,  w_c = n_c / (n_c + 8).
// Growth and age covariates are included only if 5-fold cross-validation proves
// they reduce out-of-sample MdAPE. The exact fitted model that wins CV
// generates the board and is evaluated out-of-sample via 5-fold CV, LOO (125
// refits), newest-listed holdout, ablation, and OOB range calibration.
//
// 2. Launch-odds model (M1):
// Empirical P(launch) = share of protocols in the same (age band + category)
// cohort that already record a token, shrunk toward the global base rate
// (tokenized / total) by cohort size n / (n + k) (k = 10 for dated cohorts;
// category-only with k = 20 for undated protocols). Validated by LOO across
// all protocols in the snapshot. Board ranks by expected value:
//   implied_value_usd = value_if_launches * P(launch).
//
// Float caveat: mcap_usd is CIRCULATING market cap, not FDV. A newly launched
// token's circulating float at launch is typically well below 100%, so the
// implied value represents the circulating market cap the protocol's token
// would carry at comparable float, not a fully-diluted valuation.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface LaunchOddsDetail {
  probability: number;
  ageBand: string;
  category: string;
  cohortN: number;
  cohortTokenized: number;
  weight: number;
  baseRate: number;
}

export interface ScoredProtocol {
  protocol: Protocol;
  /** Expected value = round(valueIfLaunchUsd * launchOdds), non-increasing with rank. */
  impliedUsd: number;
  /** P10 of expected value across 250 bootstrap refits. */
  impliedLowUsd: number;
  /** P90 of expected value across 250 bootstrap refits. */
  impliedHighUsd: number;
  /** P25 of expected value across 250 bootstrap refits. */
  impliedP25Usd: number;
  /** P75 of expected value across 250 bootstrap refits. */
  impliedP75Usd: number;
  /** Value if the protocol launches (before multiplying by launchOdds). */
  valueIfLaunchUsd: number;
  valueIfLaunchP10Usd: number;
  valueIfLaunchP25Usd: number;
  valueIfLaunchP75Usd: number;
  valueIfLaunchP90Usd: number;
  /** Empirical cohort launch probability in [0, 1]. */
  launchOdds: number;
  launchCohort: LaunchOddsDetail;
  rankLow: number;
  rankHigh: number;
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
  n: number;
  mdape: number;
  medianMiss: number;
  hit2x: number;
  hit3x: number;
  spearman: number;
}

export interface RangeCalibrationReport {
  n: number;
  p25p75Hits: number;
  p25p75Rate: number;
  p10p90Hits: number;
  p10p90Rate: number;
  method: string;
}

export interface AblationStep {
  id: string;
  label: string;
  n: number;
  mdape: number;
  medianMiss: number;
  hit2x: number;
  hit3x: number;
  selected: boolean;
  status: 'baseline' | 'kept' | 'dropped' | 'selected';
}

export interface LaunchOddsReport {
  total: number;
  tokenized: number;
  baseRate: number;
  shrinkageK: number;
  undatedShrinkageK: number;
  looCorrect: number;
  looAccuracy: number;
  baseCorrect: number;
  baseAccuracy: number;
  ageCutoffsDays: number[];
  ageBands: Array<{ label: string; n: number; tokenized: number; rate: number }>;
}

export interface ModelReport {
  fitN: number;
  outliersDropped: number;
  elasticity: number;
  intercept: number;
  growthCoef: number | null;
  ageCoef: number | null;
  growthKept: boolean;
  ageKept: boolean;
  cv: { mdape: number; hit2x: number; spearman: number; n: number };
  cvBig: { mdape: number; hit2x: number; spearman: number; n: number };
  baseline: { mdape: number; hit2x: number; spearman: number };
  newestHoldout: { mdape: number; hit2x: number; n: number };
  loo: LooMetrics;
  rangeCalibration: RangeCalibrationReport;
  ablation: AblationStep[];
  launchOdds: LaunchOddsReport;
  categories: Array<{ name: string; n: number; intercept: number; weight: number }>;
  anchors: Array<{
    slug: string;
    name: string;
    category: string;
    tvl: number;
    actual: number;
    predicted: number;
    looPredicted: number;
  }>;
}

export interface Partition {
  watchlist: number;
  belowFloor: number;
  anchorsFit: number;
  anchorsOutliers: number;
  excludedWrapped: number;
  excludedPartial: number;
  total: number;
}

export interface FittedModel {
  report: ModelReport;
  partition: Partition;
  /** Predicts value-if-launches (circulating market cap USD). */
  predict(p: Protocol): number;
  /** Predicts expected value = round(predict(p) * launchOdds(p).probability). */
  expectedValue(p: Protocol): number;
  /** Empirical cohort launch probability and cohort metadata. */
  launchOdds(p: Protocol): LaunchOddsDetail;
  breakdown(p: Protocol): ScoredProtocol['breakdown'];
}

/** A protocol records no token when DefiLlama records neither a CoinGecko id nor a ticker. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_NAMES) if (p.name.startsWith(ex)) return false;
  return true;
}

/** Whole days between two YYYY-MM-DD dates, UTC, never negative. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const ms = Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

const CATEGORY_SHRINKAGE_K = 8;
const LAUNCH_COHORT_SHRINKAGE_K = 10;
const LAUNCH_UNDATED_SHRINKAGE_K = 20;
const OUTLIER_ROBUST_SD = 3;
const MAD_NORMAL_SCALE = 1.4826;
const BIG_TVL_THRESHOLD = 10_000_000;
const BOOTSTRAP_REPS = 250;
const BOOTSTRAP_SEED = 0x20261114;

interface ModelParams {
  intercept: number;
  elasticity: number;
  growthCoef: number | null;
  ageCoef: number | null;
  categoryEffects: Map<string, number>;
  categoryCounts: Map<string, number>;
  categoryWeights: Map<string, number>;
}

interface LaunchOddsModel {
  baseRate: number;
  total: number;
  tokenized: number;
  cutoffs: number[];
  bandLabels: string[];
  cohortCounts: Map<string, { n: number; tokenized: number }>;
  categoryCounts: Map<string, { n: number; tokenized: number }>;
  report: LaunchOddsReport;
  predict(p: Protocol): LaunchOddsDetail;
}

const bootstrapStore = new WeakMap<FittedModel, { asOf: string; paramsList: ModelParams[] }>();

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growthTransform(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 0;
  const clamped = Math.max(-95, Math.min(500, change7d));
  return Math.asinh(clamped / 100);
}

function ageTransform(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 0;
  const days = daysBetween(listedAt, asOf);
  return Math.log(1 + days / 365);
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivot = r;
      }
    }
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }
    const diag = M[col]![col]!;
    if (Math.abs(diag) < 1e-12) {
      M[col]![col] = diag >= 0 ? 1e-12 : -1e-12;
    }
    const pVal = M[col]![col]!;
    for (let r = col + 1; r < m; r++) {
      const factor = M[r]![col]! / pVal;
      for (let c = col; c <= m; c++) {
        M[r]![c] = M[r]![c]! - factor * M[col]![c]!;
      }
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let sum = M[i]![m]!;
    for (let j = i + 1; j < m; j++) sum -= M[i]![j]! * x[j]!;
    const val = sum / M[i]![i]!;
    x[i] = Number.isFinite(val) ? val : 0;
  }
  return x;
}

function fitParams(
  anchors: Protocol[],
  asOf: string,
  useGrowth: boolean,
  useAge: boolean,
  useCategory = true,
): ModelParams {
  const n = anchors.length;
  if (n === 0) {
    return {
      intercept: 0,
      elasticity: 1,
      growthCoef: useGrowth ? 0 : null,
      ageCoef: useAge ? 0 : null,
      categoryEffects: new Map(),
      categoryCounts: new Map(),
      categoryWeights: new Map(),
    };
  }

  const pCols = 1 + (useGrowth ? 1 : 0) + (useAge ? 1 : 0);
  const y = new Array<number>(n);
  const X: number[][] = new Array(n);
  const means = new Array<number>(pCols).fill(0);
  let meanY = 0;

  for (let i = 0; i < n; i++) {
    const a = anchors[i]!;
    const yi = Math.log(a.mcap_usd!);
    y[i] = yi;
    meanY += yi;

    const row = new Array<number>(pCols);
    let col = 0;
    row[col++] = Math.log(a.tvl_usd);
    if (useGrowth) row[col++] = growthTransform(a.change_7d);
    if (useAge) row[col++] = ageTransform(a.listed_at, asOf);
    X[i] = row;
    for (let j = 0; j < pCols; j++) means[j]! += row[j]!;
  }
  meanY /= n;
  for (let j = 0; j < pCols; j++) means[j]! /= n;

  const ZtZ: number[][] = Array.from({ length: pCols }, () => new Array<number>(pCols).fill(0));
  const Zty = new Array<number>(pCols).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i]!;
    const dy = y[i]! - meanY;
    for (let j = 0; j < pCols; j++) {
      const zj = row[j]! - means[j]!;
      Zty[j]! += zj * dy;
      for (let k = j; k < pCols; k++) {
        ZtZ[j]![k]! += zj * (row[k]! - means[k]!);
      }
    }
  }
  for (let j = 0; j < pCols; j++) {
    for (let k = 0; k < j; k++) ZtZ[j]![k] = ZtZ[k]![j]!;
    if (ZtZ[j]![j]! < 1e-12) ZtZ[j]![j]! += 1e-9;
  }

  const slopes = solveLinearSystem(ZtZ, Zty);
  let intercept = meanY;
  for (let j = 0; j < pCols; j++) intercept -= slopes[j]! * means[j]!;

  let idx = 0;
  const elasticity = slopes[idx++]!;
  const growthCoef = useGrowth ? slopes[idx++]! : null;
  const ageCoef = useAge ? slopes[idx++]! : null;

  const categoryEffects = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const categoryWeights = new Map<string, number>();

  if (useCategory) {
    const residualSums = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const a = anchors[i]!;
      const row = X[i]!;
      let predLog = intercept + elasticity * row[0]!;
      let cIdx = 1;
      if (growthCoef !== null) predLog += growthCoef * row[cIdx++]!;
      if (ageCoef !== null) predLog += ageCoef * row[cIdx++]!;
      const residual = y[i]! - predLog;
      const cat = a.category ?? 'Uncategorized';
      residualSums.set(cat, (residualSums.get(cat) ?? 0) + residual);
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }

    for (const [cat, cnt] of categoryCounts.entries()) {
      const meanRes = residualSums.get(cat)! / cnt;
      const w = cnt / (cnt + CATEGORY_SHRINKAGE_K);
      categoryWeights.set(cat, w);
      categoryEffects.set(cat, w * meanRes);
    }
  }

  return {
    intercept,
    elasticity,
    growthCoef,
    ageCoef,
    categoryEffects,
    categoryCounts,
    categoryWeights,
  };
}

function computeBreakdown(
  p: Protocol,
  params: ModelParams,
  asOf: string,
): ScoredProtocol['breakdown'] {
  const tvl = Number.isFinite(p.tvl_usd) && p.tvl_usd > 0 ? p.tvl_usd : 1;
  const baseUsd = Math.exp(params.intercept + params.elasticity * Math.log(tvl));
  const catKey = p.category ?? 'Uncategorized';
  const catEffect = params.categoryEffects.get(catKey) ?? 0;
  const categoryFactor = Math.exp(catEffect);
  const growthFactor =
    params.growthCoef !== null ? Math.exp(params.growthCoef * growthTransform(p.change_7d)) : 1;
  const ageFactor =
    params.ageCoef !== null ? Math.exp(params.ageCoef * ageTransform(p.listed_at, asOf)) : 1;
  return {
    baseUsd: Number.isFinite(baseUsd) && baseUsd > 0 ? baseUsd : 1,
    categoryFactor: Number.isFinite(categoryFactor) && categoryFactor > 0 ? categoryFactor : 1,
    growthFactor: Number.isFinite(growthFactor) && growthFactor > 0 ? growthFactor : 1,
    ageFactor: Number.isFinite(ageFactor) && ageFactor > 0 ? ageFactor : 1,
    elasticity: params.elasticity,
  };
}

function predictFloat(p: Protocol, params: ModelParams, asOf: string): number {
  const b = computeBreakdown(p, params, asOf);
  const val = b.baseUsd * b.categoryFactor * b.growthFactor * b.ageFactor;
  return Number.isFinite(val) && val > 0 ? val : 1;
}

function predictRounded(p: Protocol, params: ModelParams, asOf: string): number {
  const val = Math.round(predictFloat(p, params, asOf));
  return Number.isFinite(val) && val >= 1 ? val : 1;
}

function averageRanks(values: number[]): number[] {
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

function spearmanCorr(actuals: number[], preds: number[]): number {
  const n = actuals.length;
  if (n < 2) return 0;
  const rx = averageRanks(actuals);
  const ry = averageRanks(preds);
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

function evaluateMetrics(
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
    const p = preds[i]!;
    apes[i] = Math.abs(p - a) / a;
    const ratio = p >= a ? p / a : a / p;
    misses[i] = ratio;
    if (ratio <= 2) hits2++;
    if (ratio <= 3) hits3++;
  }
  return {
    mdape: median(apes),
    medianMiss: median(misses),
    hit2x: hits2 / n,
    hit3x: hits3 / n,
    spearman: spearmanCorr(actuals, preds),
    n,
  };
}

function runFiveFoldCv(
  sortedAnchors: Protocol[],
  asOf: string,
  useGrowth: boolean,
  useAge: boolean,
): {
  cv: { mdape: number; hit2x: number; spearman: number; n: number };
  cvBig: { mdape: number; hit2x: number; spearman: number; n: number };
  baseline: { mdape: number; hit2x: number; spearman: number };
} {
  const n = sortedAnchors.length;
  const actuals = new Array<number>(n);
  const modelPreds = new Array<number>(n);
  const basePreds = new Array<number>(n);

  for (let fold = 0; fold < 5; fold++) {
    const train: Protocol[] = [];
    const testIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === fold) testIdx.push(i);
      else train.push(sortedAnchors[i]!);
    }
    if (testIdx.length === 0 || train.length === 0) continue;

    const foldParams = fitParams(train, asOf, useGrowth, useAge, true);
    const trainRatios = train.map((a) => a.mcap_usd! / a.tvl_usd);
    const globalMedianMultiple = median(trainRatios);

    for (const idx of testIdx) {
      const a = sortedAnchors[idx]!;
      actuals[idx] = a.mcap_usd!;
      modelPreds[idx] = predictRounded(a, foldParams, asOf);
      basePreds[idx] = Math.max(1, Math.round(a.tvl_usd * globalMedianMultiple));
    }
  }

  const cvFull = evaluateMetrics(actuals, modelPreds);
  const baseAll = evaluateMetrics(actuals, basePreds);

  const bigActuals: number[] = [];
  const bigPreds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (sortedAnchors[i]!.tvl_usd >= BIG_TVL_THRESHOLD) {
      bigActuals.push(actuals[i]!);
      bigPreds.push(modelPreds[i]!);
    }
  }
  const cvBigFull = evaluateMetrics(bigActuals, bigPreds);

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
function runLooOls(
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
    const params = fitParams(train, asOf, useGrowth, useAge, useCategory);
    preds[i] = predictRounded(target, params, asOf);
  }

  const m = evaluateMetrics(actuals, preds);
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
function runLooFlatMultiple(anchors: Protocol[]): LooMetrics {
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
    const mult = median(ratios);
    preds[i] = Math.max(1, Math.round(target.tvl_usd * mult));
  }

  const m = evaluateMetrics(actuals, preds);
  return {
    n: m.n,
    mdape: m.mdape,
    medianMiss: m.medianMiss,
    hit2x: m.hit2x,
    hit3x: m.hit3x,
    spearman: m.spearman,
  };
}

/** Empirical launch-odds model (M1): age-band + category cohorts shrunk to global base rate, LOO-validated. */
function fitLaunchOddsModel(snapshot: Snapshot): LaunchOddsModel {
  const protocols = snapshot.protocols;
  const total = protocols.length;
  let tokenized = 0;
  const datedAges: number[] = [];

  for (const p of protocols) {
    if (!isPreToken(p)) tokenized++;
    if (p.listed_at !== null) {
      datedAges.push(daysBetween(p.listed_at, snapshot.as_of));
    }
  }

  const baseRate = total > 0 ? tokenized / total : 0.5;
  datedAges.sort((a, b) => a - b);

  // Quintile cutoffs (Q20, Q40, Q60, Q80) among dated protocols.
  const cutoffs =
    datedAges.length >= 5
      ? [
          Math.round(quantile(datedAges, 0.2)),
          Math.round(quantile(datedAges, 0.4)),
          Math.round(quantile(datedAges, 0.6)),
          Math.round(quantile(datedAges, 0.8)),
        ]
      : [180, 365, 730, 1095];

  const bandLabels = [
    `<${cutoffs[0]!}d`,
    `${cutoffs[0]!}–${cutoffs[1]! - 1}d`,
    `${cutoffs[1]!}–${cutoffs[2]! - 1}d`,
    `${cutoffs[2]!}–${cutoffs[3]! - 1}d`,
    `>=${cutoffs[3]!}d`,
  ];

  const getAgeBand = (p: Protocol): string => {
    if (p.listed_at === null) return 'Undated';
    const d = daysBetween(p.listed_at, snapshot.as_of);
    if (d < cutoffs[0]!) return bandLabels[0]!;
    if (d < cutoffs[1]!) return bandLabels[1]!;
    if (d < cutoffs[2]!) return bandLabels[2]!;
    if (d < cutoffs[3]!) return bandLabels[3]!;
    return bandLabels[4]!;
  };

  const cohortCounts = new Map<string, { n: number; tokenized: number }>();
  const categoryCounts = new Map<string, { n: number; tokenized: number }>();
  const bandCounts = new Map<string, { n: number; tokenized: number }>();

  for (const p of protocols) {
    const isTok = !isPreToken(p) ? 1 : 0;
    const band = getAgeBand(p);
    const cat = p.category ?? 'Uncategorized';
    const key = `${band}||${cat}`;

    const cEntry = cohortCounts.get(key) ?? { n: 0, tokenized: 0 };
    cEntry.n += 1;
    cEntry.tokenized += isTok;
    cohortCounts.set(key, cEntry);

    const catEntry = categoryCounts.get(cat) ?? { n: 0, tokenized: 0 };
    catEntry.n += 1;
    catEntry.tokenized += isTok;
    categoryCounts.set(cat, catEntry);

    const bEntry = bandCounts.get(band) ?? { n: 0, tokenized: 0 };
    bEntry.n += 1;
    bEntry.tokenized += isTok;
    bandCounts.set(band, bEntry);
  }

  const predictWithExclusion = (p: Protocol, excludeSelf: boolean): LaunchOddsDetail => {
    const isTok = !isPreToken(p) ? 1 : 0;
    const band = getAgeBand(p);
    const cat = p.category ?? 'Uncategorized';
    const adjTotal = excludeSelf ? Math.max(1, total - 1) : Math.max(1, total);
    const adjTok = excludeSelf ? tokenized - isTok : tokenized;
    const adjBaseRate = adjTok / adjTotal;

    if (band === 'Undated') {
      const raw = categoryCounts.get(cat) ?? { n: 0, tokenized: 0 };
      const n = Math.max(0, raw.n - (excludeSelf ? 1 : 0));
      const tok = Math.max(0, raw.tokenized - (excludeSelf ? isTok : 0));
      const w = n / (n + LAUNCH_UNDATED_SHRINKAGE_K);
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
    }

    const key = `${band}||${cat}`;
    const raw = cohortCounts.get(key) ?? { n: 0, tokenized: 0 };
    const n = Math.max(0, raw.n - (excludeSelf ? 1 : 0));
    const tok = Math.max(0, raw.tokenized - (excludeSelf ? isTok : 0));
    const w = n / (n + LAUNCH_COHORT_SHRINKAGE_K);
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

  // Leave-one-out validation across all snapshot protocols.
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
    shrinkageK: LAUNCH_COHORT_SHRINKAGE_K,
    undatedShrinkageK: LAUNCH_UNDATED_SHRINKAGE_K,
    looCorrect,
    looAccuracy: total > 0 ? looCorrect / total : 0,
    baseCorrect,
    baseAccuracy: total > 0 ? baseCorrect / total : 0,
    ageCutoffsDays: cutoffs,
    ageBands,
  };

  return {
    baseRate,
    total,
    tokenized,
    cutoffs,
    bandLabels,
    cohortCounts,
    categoryCounts,
    report,
    predict(p: Protocol): LaunchOddsDetail {
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
    } else if (isPreToken(p)) {
      if (isLaunchCandidate(p)) belowFloorCount++;
      else excludedWrappedCount++;
    } else if (
      p.tvl_usd > 0 &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.gecko_id !== null &&
      p.symbol !== null
    ) {
      rawAnchors.push(p);
    } else {
      excludedPartialCount++;
    }
  }

  // Winsorize anchors: drop those whose log(mcap/tvl) is > 3 robust SDs from the median.
  const logRatios = rawAnchors.map((a) => Math.log(a.mcap_usd! / a.tvl_usd));
  const medLogRatio = median(logRatios);
  const absDevs = logRatios.map((lr) => Math.abs(lr - medLogRatio));
  const robustSd = MAD_NORMAL_SCALE * median(absDevs);

  const cleanAnchors: Protocol[] = [];
  let outliersDropped = 0;
  for (let i = 0; i < rawAnchors.length; i++) {
    if (robustSd > 0 && Math.abs(logRatios[i]! - medLogRatio) > OUTLIER_ROBUST_SD * robustSd) {
      outliersDropped++;
    } else {
      cleanAnchors.push(rawAnchors[i]!);
    }
  }

  // Deterministic anchor ordering by slug ascending for CV and LOO.
  const cvAnchors = [...cleanAnchors].sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
  );

  // CV feature selection: keep growth / age only if they reduce out-of-sample MdAPE.
  const baseCv = runFiveFoldCv(cvAnchors, snapshot.as_of, false, false);
  const growthCv = runFiveFoldCv(cvAnchors, snapshot.as_of, true, false);
  const ageCv = runFiveFoldCv(cvAnchors, snapshot.as_of, false, true);

  let growthKept = growthCv.cv.mdape < baseCv.cv.mdape;
  let ageKept = ageCv.cv.mdape < baseCv.cv.mdape;
  let selectedCv = baseCv;

  if (growthKept && ageKept) {
    const bothCv = runFiveFoldCv(cvAnchors, snapshot.as_of, true, true);
    if (bothCv.cv.mdape < Math.min(growthCv.cv.mdape, ageCv.cv.mdape)) {
      selectedCv = bothCv;
    } else if (growthCv.cv.mdape <= ageCv.cv.mdape) {
      ageKept = false;
      selectedCv = growthCv;
    } else {
      growthKept = false;
      selectedCv = ageCv;
    }
  } else if (growthKept) {
    selectedCv = growthCv;
  } else if (ageKept) {
    selectedCv = ageCv;
  }

  // M4: Ablation table (all under LOO for consistency).
  const looFlat = runLooFlatMultiple(cvAnchors);
  const looSize = runLooOls(cvAnchors, snapshot.as_of, false, false, false);
  const looCat = runLooOls(cvAnchors, snapshot.as_of, true, false, false);
  const looGrowth = runLooOls(cvAnchors, snapshot.as_of, true, true, false);
  const looAge = runLooOls(cvAnchors, snapshot.as_of, true, false, true);
  const looBoth = runLooOls(cvAnchors, snapshot.as_of, true, true, true);

  // M2: LOO validation of the exact selected specification.
  const selectedLoo =
    growthKept && ageKept
      ? looBoth
      : growthKept
        ? looGrowth
        : ageKept
          ? looAge
          : looCat;

  const ablation: AblationStep[] = [
    {
      id: 'flat',
      label: 'Flat global-median multiple',
      n: looFlat.n,
      mdape: looFlat.mdape,
      medianMiss: looFlat.medianMiss,
      hit2x: looFlat.hit2x,
      hit3x: looFlat.hit3x,
      selected: false,
      status: 'baseline',
    },
    {
      id: 'size',
      label: 'Size curve (log-log TVL)',
      n: looSize.metrics.n,
      mdape: looSize.metrics.mdape,
      medianMiss: looSize.metrics.medianMiss,
      hit2x: looSize.metrics.hit2x,
      hit3x: looSize.metrics.hit3x,
      selected: false,
      status: 'kept',
    },
    {
      id: 'category',
      label: '+ Shrunk category offsets',
      n: looCat.metrics.n,
      mdape: looCat.metrics.mdape,
      medianMiss: looCat.metrics.medianMiss,
      hit2x: looCat.metrics.hit2x,
      hit3x: looCat.metrics.hit3x,
      selected: !growthKept && !ageKept,
      status: !growthKept && !ageKept ? 'selected' : 'kept',
    },
    {
      id: 'growth',
      label: '+ 7d growth (asinh)',
      n: looGrowth.metrics.n,
      mdape: looGrowth.metrics.mdape,
      medianMiss: looGrowth.metrics.medianMiss,
      hit2x: looGrowth.metrics.hit2x,
      hit3x: looGrowth.metrics.hit3x,
      selected: growthKept && !ageKept,
      status: growthKept && !ageKept ? 'selected' : growthKept ? 'kept' : 'dropped',
    },
    {
      id: 'age',
      label: '+ Protocol age (log)',
      n: looAge.metrics.n,
      mdape: looAge.metrics.mdape,
      medianMiss: looAge.metrics.medianMiss,
      hit2x: looAge.metrics.hit2x,
      hit3x: looAge.metrics.hit3x,
      selected: !growthKept && ageKept,
      status: !growthKept && ageKept ? 'selected' : ageKept ? 'kept' : 'dropped',
    },
    {
      id: 'growth_age',
      label: '+ Growth & age combined',
      n: looBoth.metrics.n,
      mdape: looBoth.metrics.mdape,
      medianMiss: looBoth.metrics.medianMiss,
      hit2x: looBoth.metrics.hit2x,
      hit3x: looBoth.metrics.hit3x,
      selected: growthKept && ageKept,
      status: growthKept && ageKept ? 'selected' : 'dropped',
    },
  ];

  // Newest-listed cohort holdout: newest 20% by listed_at descending (nulls last).
  const sortedNewest = [...cvAnchors].sort((a, b) => {
    if (a.listed_at === null && b.listed_at === null) {
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    }
    if (a.listed_at === null) return 1;
    if (b.listed_at === null) return -1;
    if (a.listed_at !== b.listed_at) return b.listed_at < a.listed_at ? -1 : 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const holdN = sortedNewest.length > 1 ? Math.max(1, Math.round(sortedNewest.length * 0.2)) : 0;
  const holdoutSet = sortedNewest.slice(0, holdN);
  const holdoutTrain = sortedNewest.slice(holdN);
  const holdoutParams = fitParams(holdoutTrain, snapshot.as_of, growthKept, ageKept, true);
  const holdoutMetrics = evaluateMetrics(
    holdoutSet.map((a) => a.mcap_usd!),
    holdoutSet.map((a) => predictRounded(a, holdoutParams, snapshot.as_of)),
  );

  // Full fit using exact winning specification.
  const fullParams = fitParams(cvAnchors, snapshot.as_of, growthKept, ageKept, true);

  // Bootstrap refits (seeded mulberry32, N = 250) stored internally for buildBoard,
  // tracking out-of-bag membership for M3 held-out range calibration.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const bootParamsList: ModelParams[] = [];
  const oobPredsPerAnchor: number[][] = Array.from({ length: cvAnchors.length }, () => []);

  if (cvAnchors.length > 0) {
    for (let b = 0; b < BOOTSTRAP_REPS; b++) {
      const sample = new Array<Protocol>(cvAnchors.length);
      const inBag = new Uint8Array(cvAnchors.length);
      for (let i = 0; i < cvAnchors.length; i++) {
        const pick = Math.floor(rng() * cvAnchors.length);
        sample[i] = cvAnchors[pick]!;
        inBag[pick] = 1;
      }
      const bParams = fitParams(sample, snapshot.as_of, growthKept, ageKept, true);
      bootParamsList.push(bParams);

      for (let i = 0; i < cvAnchors.length; i++) {
        if (inBag[i] === 0) {
          oobPredsPerAnchor[i]!.push(predictRounded(cvAnchors[i]!, bParams, snapshot.as_of));
        }
      }
    }
  }

  // M3: Range calibration on held-out (out-of-bag) anchors using the 250 bootstrap refits.
  let p25p75Hits = 0;
  let p10p90Hits = 0;
  let calN = 0;
  for (let i = 0; i < cvAnchors.length; i++) {
    const oob = oobPredsPerAnchor[i]!;
    if (oob.length === 0) continue;
    oob.sort((a, b) => a - b);
    const actual = cvAnchors[i]!.mcap_usd!;
    const p10 = quantile(oob, 0.1);
    const p25 = quantile(oob, 0.25);
    const p75 = quantile(oob, 0.75);
    const p90 = quantile(oob, 0.9);
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

  // M1: Empirical launch-odds model.
  const launchOddsModel = fitLaunchOddsModel(snapshot);

  const categories = [...fullParams.categoryCounts.entries()]
    .map(([name, n]) => ({
      name,
      n,
      intercept: fullParams.categoryEffects.get(name) ?? 0,
      weight: fullParams.categoryWeights.get(name) ?? 0,
    }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const looPredBySlug = new Map<string, number>();
  for (let i = 0; i < cvAnchors.length; i++) {
    looPredBySlug.set(cvAnchors[i]!.slug, selectedLoo.preds[i]!);
  }

  const anchorsReport = [...cvAnchors]
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category ?? 'Uncategorized',
      tvl: a.tvl_usd,
      actual: a.mcap_usd!,
      predicted: predictRounded(a, fullParams, snapshot.as_of),
      looPredicted: looPredBySlug.get(a.slug) ?? predictRounded(a, fullParams, snapshot.as_of),
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
    elasticity: fullParams.elasticity,
    intercept: fullParams.intercept,
    growthCoef: fullParams.growthCoef,
    ageCoef: fullParams.ageCoef,
    growthKept,
    ageKept,
    cv: selectedCv.cv,
    cvBig: selectedCv.cvBig,
    baseline: selectedCv.baseline,
    newestHoldout: {
      mdape: holdoutMetrics.mdape,
      hit2x: holdoutMetrics.hit2x,
      n: holdoutMetrics.n,
    },
    loo: selectedLoo.metrics,
    rangeCalibration,
    ablation,
    launchOdds: launchOddsModel.report,
    categories,
    anchors: anchorsReport,
  };

  const fitted: FittedModel = {
    report,
    partition,
    predict(p: Protocol): number {
      return predictRounded(p, fullParams, snapshot.as_of);
    },
    expectedValue(p: Protocol): number {
      const valIfLaunch = predictFloat(p, fullParams, snapshot.as_of);
      const odds = launchOddsModel.predict(p).probability;
      const ev = Math.round(valIfLaunch * odds);
      return Number.isFinite(ev) && ev >= 1 ? ev : 1;
    },
    launchOdds(p: Protocol): LaunchOddsDetail {
      return launchOddsModel.predict(p);
    },
    breakdown(p: Protocol): ScoredProtocol['breakdown'] {
      return computeBreakdown(p, fullParams, snapshot.as_of);
    },
  };

  bootstrapStore.set(fitted, { asOf: snapshot.as_of, paramsList: bootParamsList });
  return fitted;
}

/**
 * Build the board: every pre-token watchlist slug, plus every other pre-token
 * protocol that is a genuine launch candidate, ranked by expected value
 * (value_if_launches * P(launch)) descending (slug ascending breaks ties).
 * Includes P10–P90 and P25–P75 value bands and P10–P90 rank bands across 250
 * deterministic bootstrap refits.
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
    const breakdown = model.breakdown(p);
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
      breakdown,
    });
  }

  candidates.sort(
    (a, b) =>
      b.impliedUsd - a.impliedUsd ||
      (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0),
  );

  const m = candidates.length;
  const boot = bootstrapStore.get(model);
  const B = boot?.paramsList.length ?? 0;

  if (m === 0 || B === 0 || !boot) {
    return candidates.map((c, idx) => ({
      protocol: c.protocol,
      impliedUsd: c.impliedUsd,
      impliedLowUsd: c.impliedUsd,
      impliedHighUsd: c.impliedUsd,
      impliedP25Usd: c.impliedUsd,
      impliedP75Usd: c.impliedUsd,
      valueIfLaunchUsd: c.valueIfLaunchUsd,
      valueIfLaunchP10Usd: c.valueIfLaunchUsd,
      valueIfLaunchP25Usd: c.valueIfLaunchUsd,
      valueIfLaunchP75Usd: c.valueIfLaunchUsd,
      valueIfLaunchP90Usd: c.valueIfLaunchUsd,
      launchOdds: c.launchOdds,
      launchCohort: c.launchCohort,
      rankLow: idx + 1,
      rankHigh: idx + 1,
      watchlist: c.watchlist,
      ageDays: c.ageDays,
      breakdown: c.breakdown,
    }));
  }

  const evSamples: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const valSamples: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const rankSamples: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const scoredBuf: Array<{ idx: number; ev: number; val: number; slug: string }> = candidates.map(
    (c, idx) => ({
      idx,
      ev: 0,
      val: 0,
      slug: c.protocol.slug,
    }),
  );

  for (let b = 0; b < B; b++) {
    const params = boot.paramsList[b]!;
    for (let i = 0; i < m; i++) {
      const entry = scoredBuf[i]!;
      const cand = candidates[i]!;
      const valFloat = predictFloat(cand.protocol, params, boot.asOf);
      const val = Math.max(1, Math.round(valFloat));
      const ev = Math.max(1, Math.round(valFloat * cand.launchOdds));
      entry.idx = i;
      entry.slug = cand.protocol.slug;
      entry.val = val;
      entry.ev = ev;
    }
    scoredBuf.sort((a, c) => c.ev - a.ev || (a.slug < c.slug ? -1 : a.slug > c.slug ? 1 : 0));
    for (let r = 0; r < m; r++) {
      const entry = scoredBuf[r]!;
      evSamples[entry.idx]![b] = entry.ev;
      valSamples[entry.idx]![b] = entry.val;
      rankSamples[entry.idx]![b] = r + 1;
    }
  }

  return candidates.map((c, idx) => {
    const pointRank = idx + 1;
    const evSorted = evSamples[idx]!.sort((a, b) => a - b);
    const valSorted = valSamples[idx]!.sort((a, b) => a - b);
    const rnkSorted = rankSamples[idx]!.sort((a, b) => a - b);

    const qEvP10 = Math.max(1, Math.round(quantile(evSorted, 0.1)));
    const qEvP25 = Math.max(1, Math.round(quantile(evSorted, 0.25)));
    const qEvP75 = Math.max(1, Math.round(quantile(evSorted, 0.75)));
    const qEvP90 = Math.max(1, Math.round(quantile(evSorted, 0.9)));

    const impliedLowUsd = Math.min(c.impliedUsd, qEvP10);
    const impliedHighUsd = Math.max(c.impliedUsd, qEvP90);
    const impliedP25Usd = Math.max(impliedLowUsd, Math.min(qEvP25, impliedHighUsd));
    const impliedP75Usd = Math.max(impliedP25Usd, Math.min(qEvP75, impliedHighUsd));

    const qValP10 = Math.max(1, Math.round(quantile(valSorted, 0.1)));
    const qValP25 = Math.max(1, Math.round(quantile(valSorted, 0.25)));
    const qValP75 = Math.max(1, Math.round(quantile(valSorted, 0.75)));
    const qValP90 = Math.max(1, Math.round(quantile(valSorted, 0.9)));

    const valueIfLaunchP10Usd = Math.min(c.valueIfLaunchUsd, qValP10);
    const valueIfLaunchP90Usd = Math.max(c.valueIfLaunchUsd, qValP90);
    const valueIfLaunchP25Usd = Math.max(
      valueIfLaunchP10Usd,
      Math.min(qValP25, valueIfLaunchP90Usd),
    );
    const valueIfLaunchP75Usd = Math.max(
      valueIfLaunchP25Usd,
      Math.min(qValP75, valueIfLaunchP90Usd),
    );

    const qRankLow = Math.max(1, Math.round(quantile(rnkSorted, 0.1)));
    const qRankHigh = Math.min(m, Math.round(quantile(rnkSorted, 0.9)));
    const rankLow = Math.min(pointRank, qRankLow);
    const rankHigh = Math.max(pointRank, qRankHigh);

    return {
      protocol: c.protocol,
      impliedUsd: c.impliedUsd,
      impliedLowUsd,
      impliedHighUsd,
      impliedP25Usd,
      impliedP75Usd,
      valueIfLaunchUsd: c.valueIfLaunchUsd,
      valueIfLaunchP10Usd,
      valueIfLaunchP25Usd,
      valueIfLaunchP75Usd,
      valueIfLaunchP90Usd,
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
