// Serialises the scored board, fitted model diagnostics, launch-odds report,
// LOO/ablation/calibration tables, granular 758 partition, kinship flags, and
// deposit-sized farm economics into the dashboard's z-data.js file.
//
// Size discipline: the dossier shows dashboard source in path order under a
// 65,536-byte text cap, so z-data.js stays lean and is emitted one section
// per line (one line per board row). The granular partition slug lists sit
// after the rows, so the model diagnostics and the head of the board survive
// intact before any dossier line cut.

import {
  CHAIN_FEES,
  DEFAULT_FEE_USD,
  DEFAULT_HOLDING_DAYS,
  DEFAULT_MAX_TVL_SHARE,
  DEFAULT_SANDBOX_DEPOSIT_USD,
  FAMILY_BY_CATEGORY,
  MAX_PLAN_DEPOSIT_USD,
  MIN_PLAN_DEPOSIT_USD,
  MULTI_CHAIN_STEP,
  PLAN_DEPOSIT_GRID,
  PLAN_TEMPLATES,
  SINGLE_CHAIN_STEP,
  type FarmEconomics,
} from './farm.ts';
import {
  isLaunchCandidate,
  isPreToken,
  type FittedModel,
  type Protocol,
  type ScoredProtocol,
  type Snapshot,
} from './model.ts';

export interface GranularBucket {
  id: string; label: string;
  group: 'board' | 'anchors' | 'excluded';
  count: number;
  slugs: string[];
}

export interface GranularPartition {
  total: number;
  buckets: GranularBucket[];
  counts: Record<string, number>;
}

export interface KinshipMatch {
  stem: string;
  matches: string[];
}

const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATS = new Set([
  'Liquid Staking',
  'Liquid Restaking',
  'Restaking',
  'Staking Pool',
]);
const CUSTODY_BRANDS = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];
const RELEASE_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_TOKEN_WORD = /\b(wrapped|staked|staking)\b/i;

const STEM_STOP_WORDS = new Set([
  'alpha', 'app', 'auto', 'base', 'beta', 'block', 'bridge', 'btc', 'capital', 'cash',
  'chain', 'coin', 'core', 'cross', 'crypto', 'dao', 'deep', 'defi', 'dex', 'digital',
  'eth', 'exchange', 'farm', 'farming', 'fast', 'finance', 'first', 'free', 'global',
  'high', 'hyper', 'labs', 'layer', 'lending', 'liquid', 'lite', 'market', 'markets',
  'meta', 'money', 'multi', 'network', 'next', 'omni', 'open', 'perp', 'perps', 'pool',
  'pools', 'prime', 'pro', 'protocol', 'pure', 'real', 'restaked', 'restaking', 'safe',
  'smart', 'sol', 'staked', 'staking', 'super', 'swap', 'token', 'true', 'trust',
  'usd', 'usdc', 'usdt', 'vault', 'vaults', 'world', 'wrapped', 'yield', 'zero',
]);

function roundTo4dp(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0;
}

function roundTo3dp(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}

function roundTo2dp(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

// Four significant figures: implied values carry roughly two log points of
// model error, so digits past the fourth are noise.
function sigFigs4(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 3);
  return Math.round(x / mag) * mag;
}

function verdictIndex(verdict: FarmEconomics['verdict']): number {
  if (verdict === 'FARM') return 2;
  if (verdict === 'THIN') return 1;
  return 0;
}

function compareSlugs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function splitNameWords(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\bv\d+(\.\d+)?\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/);
}

function nameStem(name: string): string {
  const words = splitNameWords(name);
  const meaningful = words.filter((w) => !STEM_STOP_WORDS.has(w));
  if (meaningful.length > 0) return meaningful.join(' ');
  return words.join(' ');
}

/**
 * M6: "kin of a token" flag (informational only, never an exclusion).
 * Flags any protocol that records no token whose normalised name stem (or
 * leading brand token) matches a tokenised protocol's name stem.
 */
export function computeKinshipMap(snapshot: Snapshot): Map<string, KinshipMatch> {
  const byStem = new Map<string, string[]>();
  const byLead = new Map<string, string[]>();

  const pushTo = (table: Map<string, string[]>, key: string, slug: string): void => {
    const list = table.get(key) ?? [];
    list.push(slug);
    table.set(key, list);
  };

  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    const stem = nameStem(p.name);
    if (stem.length >= 3 && !STEM_STOP_WORDS.has(stem)) pushTo(byStem, stem, p.slug);
    const words = splitNameWords(p.name);
    const lead = words[0] ?? '';
    if (lead.length >= 4 && !STEM_STOP_WORDS.has(lead) && words.length <= 2) {
      pushTo(byLead, lead, p.slug);
    }
  }

  for (const list of byStem.values()) list.sort(compareSlugs);
  for (const list of byLead.values()) list.sort(compareSlugs);

  const kinMap = new Map<string, KinshipMatch>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const stem = nameStem(p.name);
    const exactMatches =
      stem.length >= 3 && !STEM_STOP_WORDS.has(stem) ? byStem.get(stem) : undefined;
    if (exactMatches && exactMatches.length > 0) {
      kinMap.set(p.slug, { stem, matches: exactMatches.slice(0, 5) });
      continue;
    }

    const words = splitNameWords(p.name);
    const lead = words[0] ?? '';
    const leadMatches =
      lead.length >= 4 && !STEM_STOP_WORDS.has(lead) ? byLead.get(lead) : undefined;
    if (leadMatches && leadMatches.length > 0) {
      kinMap.set(p.slug, { stem: lead, matches: leadMatches.slice(0, 5) });
    }
  }

  return kinMap;
}

function hasExchangeName(p: Protocol): boolean {
  for (const brand of CUSTODY_BRANDS) {
    if (p.name.startsWith(brand)) return true;
  }
  return false;
}

/**
 * M6: granular partition of every protocol in the snapshot into mutually
 * exclusive named buckets whose counts sum to exactly snapshot.protocols.length.
 */
export function computeGranularPartition(
  snapshot: Snapshot,
  model: FittedModel,
): GranularPartition {
  const watch = new Set(snapshot.watchlist);
  const fitSlugSet = new Set(model.report.anchors.map((a) => a.slug));

  const bucketDefs: Array<{
    id: string;
    label: string;
    group: 'board' | 'anchors' | 'excluded';
  }> = [
    { id: 'watchlist', label: 'Watchlist (records no token, >= floor)', group: 'board' },
    { id: 'below_floor', label: 'Below-floor launch candidates (records no token)', group: 'board' },
    { id: 'fit_anchors', label: 'Fit anchors (tokenised, usable mcap & TVL)', group: 'anchors' },
    { id: 'outliers_dropped', label: 'Outlier anchors dropped (>3 robust SD)', group: 'anchors' },
    { id: 'bridges', label: 'Excluded: Bridges', group: 'excluded' },
    { id: 'exchange_custody', label: 'Excluded: Exchange custody (CEX / exchange-named)', group: 'excluded' },
    { id: 'liquid_staking', label: 'Excluded: Liquid staking / restaking wrappers', group: 'excluded' },
    { id: 'versioned_releases', label: 'Excluded: Versioned releases (V2/V3)', group: 'excluded' },
    { id: 'wrapped_staked', label: 'Excluded: Wrapped / staked by name', group: 'excluded' },
    { id: 'partial_token', label: 'Excluded: Partial-token (id/symbol present, no usable mcap)', group: 'excluded' },
  ];

  const slugsById = new Map<string, string[]>();
  for (const def of bucketDefs) slugsById.set(def.id, []);

  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) && isPreToken(p)) {
      slugsById.get('watchlist')!.push(p.slug);
    } else if (isPreToken(p)) {
      if (isLaunchCandidate(p)) {
        slugsById.get('below_floor')!.push(p.slug);
      } else if (p.category !== null && BRIDGE_CATS.has(p.category)) {
        slugsById.get('bridges')!.push(p.slug);
      } else if (p.category === 'CEX' || hasExchangeName(p)) {
        slugsById.get('exchange_custody')!.push(p.slug);
      } else if (p.category !== null && STAKING_CATS.has(p.category)) {
        slugsById.get('liquid_staking')!.push(p.slug);
      } else if (RELEASE_SUFFIX.test(p.name)) {
        slugsById.get('versioned_releases')!.push(p.slug);
      } else if (WRAPPED_TOKEN_WORD.test(p.name)) {
        slugsById.get('wrapped_staked')!.push(p.slug);
      } else {
        slugsById.get('wrapped_staked')!.push(p.slug);
      }
    } else if (fitSlugSet.has(p.slug)) {
      slugsById.get('fit_anchors')!.push(p.slug);
    } else if (
      p.tvl_usd > 0 &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.gecko_id !== null &&
      p.symbol !== null
    ) {
      slugsById.get('outliers_dropped')!.push(p.slug);
    } else {
      slugsById.get('partial_token')!.push(p.slug);
    }
  }

  const buckets: GranularBucket[] = [];
  const counts: Record<string, number> = {};
  let total = 0;

  for (const def of bucketDefs) {
    const slugs = slugsById.get(def.id)!.sort(compareSlugs);
    buckets.push({
      id: def.id,
      label: def.label,
      group: def.group,
      count: slugs.length,
      slugs,
    });
    counts[def.id] = slugs.length;
    total += slugs.length;
  }

  return { total, buckets, counts };
}

// One section per line, one line per board row: the dossier's cut keeps
// whole lines, so this layout shows the model diagnostics and the head of
// the board instead of dropping the file entirely.
function serializeData(data: Record<string, unknown>): string {
  const lines = ['const LL={'];
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const comma = i < keys.length - 1 ? ',' : '';
    if (key === 'rows' || key === 'part') {
      lines.push(`"${key}":[`);
      const items = data[key] as unknown[];
      for (let j = 0; j < items.length; j++) {
        lines.push(JSON.stringify(items[j]) + (j < items.length - 1 ? ',' : ''));
      }
      lines.push(']' + comma);
      continue;
    }
    lines.push(`${JSON.stringify(key)}:${JSON.stringify(data[key])}${comma}`);
  }
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

/**
 * Row layout (positional, in order):
 *  0 slug, 1 name, 2 category index, 3 chain indices, 4 tvl_usd,
 *  5 change_7d (null when unreported), 6 implied_value_usd (expected value),
 *  7 age in days (-1 when unknown), 8 watchlist flag (1/0), 9 base_usd,
 * 10 category factor x1000, 11 growth factor x1000, 12 age factor x1000,
 * 13 rank_low, 14 rank_high, 15 implied_low_usd (P10 EV),
 * 16 implied_high_usd (P90 EV), 17 verdict (0 SKIP / 1 THIN / 2 FARM),
 * 18 net_usd (at plan deposit, kept to the cent so the dashboard's
 *    default-view plan matches board.json exactly), 19 breakeven_usd
 *    (-1 when Infinity),
 * 20 cheapest-chain index, 21 round-trip fees_usd,
 * 22 value_if_launch_usd, 23 launch_odds x1000,
 * 24 launch_cohort [ageBand, cohortN, cohortTokenized, weight x1000],
 * 25 implied_p25_usd (P25 EV), 26 implied_p75_usd (P75 EV),
 * 27 val_p10_usd, 28 val_p25_usd, 29 val_p75_usd, 30 val_p90_usd,
 * 31 plan_deposit_usd, 32 net_per_hour_usd, 33 breakeven_label,
 * 34 kin_flag (1/0), 35 kin_matches (string[]).
 */
export function dashboardData(
  snapshot: Snapshot,
  rows: ScoredProtocol[],
  model: FittedModel,
  econBySlug: Map<string, FarmEconomics>,
): string {
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  const chains: string[] = [];
  const chainIndex = new Map<string, number>();

  const registerCat = (cat: string): void => {
    if (!catIndex.has(cat)) {
      catIndex.set(cat, categories.length);
      categories.push(cat);
    }
  };
  const registerChain = (chain: string): void => {
    if (!chainIndex.has(chain)) {
      chainIndex.set(chain, chains.length);
      chains.push(chain);
    }
  };

  for (const row of rows) {
    registerCat(row.protocol.category ?? 'Uncategorized');
    for (const chain of row.protocol.chains) registerChain(chain);
    const econ = econBySlug.get(row.protocol.slug);
    if (econ && econ.chain) registerChain(econ.chain);
  }

  const r = model.report;
  const p = model.partition;
  const catReportMap = new Map(r.categories.map((c) => [c.name, c]));
  const granular = computeGranularPartition(snapshot, model);
  const kinMap = computeKinshipMap(snapshot);

  const farmCfg = {
    defDep: DEFAULT_SANDBOX_DEPOSIT_USD,
    defDays: DEFAULT_HOLDING_DAYS,
    minDep: MIN_PLAN_DEPOSIT_USD,
    maxDep: MAX_PLAN_DEPOSIT_USD,
    tvlShare: DEFAULT_MAX_TVL_SHARE,
  };

  // Both renderings of a farm plan use only the first three templates per
  // family (deploy + two follow-ups, then the chain step and the net verdict),
  // so the fourth template is never serialised.
  const tpl: Record<string, string[]> = {};
  for (const [family, steps] of Object.entries(PLAN_TEMPLATES)) {
    tpl[family] = steps.slice(0, 3);
  }

  // Anchors arrive sorted by TVL descending; an even stride over that order
  // keeps the sample spread across the whole TVL range.
  const anch: number[][] = [];
  const stride = Math.max(1, r.anchors.length / 45);
  for (let i = 0; i < 45 && i * stride < r.anchors.length; i++) {
    const a = r.anchors[Math.floor(i * stride)]!;
    anch.push([sigFigs4(a.tvl), sigFigs4(a.actual), sigFigs4(a.predicted), sigFigs4(a.looPredicted)]);
  }

  let kinCount = 0;
  for (const row of rows) {
    if (kinMap.has(row.protocol.slug)) kinCount++;
  }

  const data: Record<string, unknown> = {
    a: snapshot.as_of,
    t: snapshot.protocols.length,
    w: snapshot.watchlist.length,
    cats: categories,
    catn: categories.map((c) => catReportMap.get(c)?.n ?? 0),
    chains,
    fees: CHAIN_FEES,
    defFee: DEFAULT_FEE_USD,
    grid: PLAN_DEPOSIT_GRID,
    farmCfg,
    fam: FAMILY_BY_CATEGORY,
    tpl,
    multi: MULTI_CHAIN_STEP,
    single: SINGLE_CHAIN_STEP,
    el: Math.round(r.elasticity * 1000),
    mdl: {
      fitN: r.fitN,
      out: r.outliersDropped,
      int: roundTo3dp(r.intercept),
      el: roundTo3dp(r.elasticity),
      gCoef: r.growthCoef === null ? null : roundTo3dp(r.growthCoef),
      aCoef: r.ageCoef === null ? null : roundTo3dp(r.ageCoef),
      cv: [roundTo3dp(r.cv.mdape), roundTo3dp(r.cv.hit2x), roundTo3dp(r.cv.spearman), r.cv.n],
      cvBig: [roundTo3dp(r.cvBig.mdape), roundTo3dp(r.cvBig.hit2x), roundTo3dp(r.cvBig.spearman), r.cvBig.n],
      base: [roundTo3dp(r.baseline.mdape), roundTo3dp(r.baseline.hit2x), roundTo3dp(r.baseline.spearman)],
      hold: [roundTo3dp(r.newestHoldout.mdape), roundTo3dp(r.newestHoldout.hit2x), r.newestHoldout.n],
      loo: [
        roundTo3dp(r.loo.mdape),
        roundTo3dp(r.loo.medianMiss),
        roundTo3dp(r.loo.hit2x),
        roundTo3dp(r.loo.hit3x),
        roundTo3dp(r.loo.spearman),
        r.loo.n,
      ],
      cal: [
        r.rangeCalibration.n,
        r.rangeCalibration.p25p75Hits,
        roundTo3dp(r.rangeCalibration.p25p75Rate),
        r.rangeCalibration.p10p90Hits,
        roundTo3dp(r.rangeCalibration.p10p90Rate),
      ],
      abl: r.ablation.map((s) => [
        s.id,
        s.label,
        s.n,
        roundTo3dp(s.mdape),
        roundTo3dp(s.medianMiss),
        roundTo3dp(s.hit2x),
        roundTo3dp(s.hit3x),
        s.selected ? 1 : 0,
        s.status,
      ]),
      lo: {
        n: r.launchOdds.total,
        tok: r.launchOdds.tokenized,
        base: roundTo3dp(r.launchOdds.baseRate),
        k: r.launchOdds.shrinkageK,
        uk: r.launchOdds.undatedShrinkageK,
        looOk: r.launchOdds.looCorrect,
        looAcc: roundTo3dp(r.launchOdds.looAccuracy),
        baseOk: r.launchOdds.baseCorrect,
        baseAcc: roundTo3dp(r.launchOdds.baseAccuracy),
        cuts: r.launchOdds.ageCutoffsDays,
        bands: r.launchOdds.ageBands.map((b) => [b.label, b.n, b.tokenized, roundTo3dp(b.rate)]),
      },
      gKept: r.growthKept ? 1 : 0,
      aKept: r.ageKept ? 1 : 0,
    },
    catf: categories.map((c) => {
      const entry = catReportMap.get(c);
      // A category with no fit anchors has no measured effect: zero, not the
      // global intercept.
      return entry
        ? [entry.n, Math.round(entry.intercept * 1000), Math.round(entry.weight * 1000)]
        : [0, 0, 0];
    }),
    anch,
    audit: [
      p.watchlist,
      p.belowFloor,
      p.anchorsFit,
      p.anchorsOutliers,
      p.excludedWrapped,
      p.excludedPartial,
      p.total,
    ],
    kinN: kinCount,
    rows: rows.map((row) => {
      const econ = econBySlug.get(row.protocol.slug);
      if (!econ) {
        throw new Error(`Missing farm economics for ${row.protocol.slug}`);
      }
      const kin = kinMap.get(row.protocol.slug);
      return [
        row.protocol.slug,
        row.protocol.name,
        catIndex.get(row.protocol.category ?? 'Uncategorized')!,
        row.protocol.chains.map((c) => chainIndex.get(c)!),
        sigFigs4(row.protocol.tvl_usd),
        row.protocol.change_7d === null ? null : roundTo3dp(row.protocol.change_7d),
        sigFigs4(row.impliedUsd),
        row.ageDays === null ? -1 : Math.round(row.ageDays),
        row.watchlist ? 1 : 0,
        sigFigs4(row.breakdown.baseUsd),
        Math.round(row.breakdown.categoryFactor * 1000),
        Math.round(row.breakdown.growthFactor * 1000),
        Math.round(row.breakdown.ageFactor * 1000),
        row.rankLow,
        row.rankHigh,
        sigFigs4(row.impliedLowUsd),
        sigFigs4(row.impliedHighUsd),
        verdictIndex(econ.verdict),
        roundTo2dp(econ.netUsd),
        Number.isFinite(econ.breakevenUsd) ? Math.round(econ.breakevenUsd) : -1,
        chainIndex.get(econ.chain)!,
        roundTo2dp(econ.feesUsd),
        sigFigs4(row.valueIfLaunchUsd),
        Math.round(row.launchOdds * 1000),
        [
          row.launchCohort.ageBand,
          row.launchCohort.cohortN,
          row.launchCohort.cohortTokenized,
          Math.round(row.launchCohort.weight * 1000),
        ],
        sigFigs4(row.impliedP25Usd),
        sigFigs4(row.impliedP75Usd),
        sigFigs4(row.valueIfLaunchP10Usd),
        sigFigs4(row.valueIfLaunchP25Usd),
        sigFigs4(row.valueIfLaunchP75Usd),
        sigFigs4(row.valueIfLaunchP90Usd),
        Math.round(econ.depositUsd),
        roundTo4dp(econ.netPerHourUsd),
        econ.breakevenLabel,
        kin ? 1 : 0,
        kin ? kin.matches : [],
      ];
    }),
    part: granular.buckets.map((b) => [b.id, b.label, b.group, b.count, b.slugs]),
  };

  return serializeData(data);
}
