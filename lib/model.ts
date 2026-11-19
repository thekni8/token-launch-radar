// LaunchLens value model: Implied Circulating Market Cap.
//
// Calibrates a unified log-log hierarchical OLS model from the snapshot's own
// tokenized protocols (those recording positive TVL, positive circulating
// market cap, and both a CoinGecko id and ticker):
//   log(mcap_usd) = intercept + elasticity * log(tvl_usd) + categoryEffect
//                   + growthCoef * g(change_7d) + ageCoef * logAge
// where category effects are empirical-Bayes shrunk intercepts toward 0:
//   effect_c = w_c * meanResidual_c,  w_c = n_c / (n_c + 8).
// Growth and age covariates are included only if 5-fold cross-validation proves
// they reduce out-of-sample MdAPE. The exact fitted model that wins CV
// generates the board and is evaluated out-of-sample.
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

export interface ScoredProtocol {
  protocol: Protocol;
  impliedUsd: number;
  impliedLowUsd: number;
  impliedHighUsd: number;
  rankLow: number;
  rankHigh: number;
  watchlist: boolean;
  ageDays: number | null;
  breakdown: { baseUsd: number; categoryFactor: number; growthFactor: number; ageFactor: number; elasticity: number };
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
  categories: Array<{ name: string; n: number; intercept: number; weight: number }>;
  anchors: Array<{ slug: string; name: string; category: string; tvl: number; actual: number; predicted: number }>;
}

export interface Partition { watchlist: number; belowFloor: number; anchorsFit: number; anchorsOutliers: number; excludedWrapped: number; excludedPartial: number; total: number; }

export interface FittedModel { report: ModelReport; partition: Partition; predict(p: Protocol): number; breakdown(p: Protocol): ScoredProtocol['breakdown']; }

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

  const residualSums = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
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

  const categoryEffects = new Map<string, number>();
  const categoryWeights = new Map<string, number>();
  for (const [cat, cnt] of categoryCounts.entries()) {
    const meanRes = residualSums.get(cat)! / cnt;
    const w = cnt / (cnt + CATEGORY_SHRINKAGE_K);
    categoryWeights.set(cat, w);
    categoryEffects.set(cat, w * meanRes);
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
): { mdape: number; hit2x: number; spearman: number; n: number } {
  const n = actuals.length;
  if (n === 0) return { mdape: 0, hit2x: 0, spearman: 0, n: 0 };
  const apes = new Array<number>(n);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const a = actuals[i]!;
    const p = preds[i]!;
    apes[i] = Math.abs(p - a) / a;
    if (p <= 2 * a && a <= 2 * p) hits++;
  }
  return {
    mdape: median(apes),
    hit2x: hits / n,
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

    const foldParams = fitParams(train, asOf, useGrowth, useAge);
    const trainRatios = train.map((a) => a.mcap_usd! / a.tvl_usd);
    const globalMedianMultiple = median(trainRatios);

    for (const idx of testIdx) {
      const a = sortedAnchors[idx]!;
      actuals[idx] = a.mcap_usd!;
      modelPreds[idx] = predictRounded(a, foldParams, asOf);
      basePreds[idx] = Math.max(1, Math.round(a.tvl_usd * globalMedianMultiple));
    }
  }

  const cv = evaluateMetrics(actuals, modelPreds);
  const baseAll = evaluateMetrics(actuals, basePreds);

  const bigActuals: number[] = [];
  const bigPreds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (sortedAnchors[i]!.tvl_usd >= BIG_TVL_THRESHOLD) {
      bigActuals.push(actuals[i]!);
      bigPreds.push(modelPreds[i]!);
    }
  }
  const cvBig = evaluateMetrics(bigActuals, bigPreds);

  return {
    cv,
    cvBig,
    baseline: { mdape: baseAll.mdape, hit2x: baseAll.hit2x, spearman: baseAll.spearman },
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

  // Deterministic anchor ordering by slug ascending for 5-fold CV.
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
  const holdoutParams = fitParams(holdoutTrain, snapshot.as_of, growthKept, ageKept);
  const holdoutMetrics = evaluateMetrics(
    holdoutSet.map((a) => a.mcap_usd!),
    holdoutSet.map((a) => predictRounded(a, holdoutParams, snapshot.as_of)),
  );

  // Full fit using exact winning specification.
  const fullParams = fitParams(cvAnchors, snapshot.as_of, growthKept, ageKept);

  // Bootstrap refits (seeded mulberry32, N = 250) stored internally for buildBoard.
  const rng = mulberry32(BOOTSTRAP_SEED);
  const bootParamsList: ModelParams[] = [];
  if (cvAnchors.length > 0) {
    for (let b = 0; b < BOOTSTRAP_REPS; b++) {
      const sample = new Array<Protocol>(cvAnchors.length);
      for (let i = 0; i < cvAnchors.length; i++) {
        sample[i] = cvAnchors[Math.floor(rng() * cvAnchors.length)]!;
      }
      bootParamsList.push(fitParams(sample, snapshot.as_of, growthKept, ageKept));
    }
  }

  const categories = [...fullParams.categoryCounts.entries()]
    .map(([name, n]) => ({
      name,
      n,
      intercept: fullParams.categoryEffects.get(name) ?? 0,
      weight: fullParams.categoryWeights.get(name) ?? 0,
    }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const anchorsReport = [...cvAnchors]
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category ?? 'Uncategorized',
      tvl: a.tvl_usd,
      actual: a.mcap_usd!,
      predicted: predictRounded(a, fullParams, snapshot.as_of),
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
    categories,
    anchors: anchorsReport,
  };

  const fitted: FittedModel = {
    report,
    partition,
    predict(p: Protocol): number {
      return predictRounded(p, fullParams, snapshot.as_of);
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
 * protocol that is a genuine launch candidate, ranked by implied circulating
 * market cap descending (slug ascending breaks ties). Includes 10th/90th
 * percentile rank and implied bands across 250 deterministic bootstrap refits.
 */
export function buildBoard(snapshot: Snapshot, model: FittedModel): ScoredProtocol[] {
  const watch = new Set(snapshot.watchlist);
  const candidates: Array<{
    protocol: Protocol;
    watchlist: boolean;
    impliedUsd: number;
    ageDays: number | null;
    breakdown: ScoredProtocol['breakdown'];
  }> = [];

  for (const p of snapshot.protocols) {
    const onWatchlist = watch.has(p.slug) && isPreToken(p);
    if (!onWatchlist && !isLaunchCandidate(p)) continue;
    const breakdown = model.breakdown(p);
    const impliedUsd = model.predict(p);
    const ageDays = p.listed_at === null ? null : daysBetween(p.listed_at, snapshot.as_of);
    candidates.push({
      protocol: p,
      watchlist: onWatchlist,
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
      rankLow: idx + 1,
      rankHigh: idx + 1,
      watchlist: c.watchlist,
      ageDays: c.ageDays,
      breakdown: c.breakdown,
    }));
  }

  const impliedSamples: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const rankSamples: number[][] = Array.from({ length: m }, () => new Array<number>(B));
  const scoredBuf: Array<{ idx: number; val: number; slug: string }> = candidates.map((c, idx) => ({
    idx,
    val: 0,
    slug: c.protocol.slug,
  }));

  for (let b = 0; b < B; b++) {
    const params = boot.paramsList[b]!;
    for (let i = 0; i < m; i++) {
      const entry = scoredBuf[i]!;
      entry.idx = i;
      entry.slug = candidates[i]!.protocol.slug;
      entry.val = predictRounded(candidates[i]!.protocol, params, boot.asOf);
    }
    scoredBuf.sort((a, c) => c.val - a.val || (a.slug < c.slug ? -1 : a.slug > c.slug ? 1 : 0));
    for (let r = 0; r < m; r++) {
      const entry = scoredBuf[r]!;
      impliedSamples[entry.idx]![b] = entry.val;
      rankSamples[entry.idx]![b] = r + 1;
    }
  }

  return candidates.map((c, idx) => {
    const pointRank = idx + 1;
    const impSorted = impliedSamples[idx]!.sort((a, b) => a - b);
    const rnkSorted = rankSamples[idx]!.sort((a, b) => a - b);

    const qImpLow = Math.max(1, Math.round(quantile(impSorted, 0.1)));
    const qImpHigh = Math.max(1, Math.round(quantile(impSorted, 0.9)));
    const impliedLowUsd = Math.min(c.impliedUsd, qImpLow);
    const impliedHighUsd = Math.max(c.impliedUsd, qImpHigh);

    const qRankLow = Math.max(1, Math.round(quantile(rnkSorted, 0.1)));
    const qRankHigh = Math.min(m, Math.round(quantile(rnkSorted, 0.9)));
    const rankLow = Math.min(pointRank, qRankLow);
    const rankHigh = Math.max(pointRank, qRankHigh);

    return {
      protocol: c.protocol,
      impliedUsd: c.impliedUsd,
      impliedLowUsd,
      impliedHighUsd,
      rankLow,
      rankHigh,
      watchlist: c.watchlist,
      ageDays: c.ageDays,
      breakdown: c.breakdown,
    };
  });
}
