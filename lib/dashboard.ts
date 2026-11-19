// Serialises the scored board, fitted model diagnostics, launch-odds report,
// LOO/ablation/calibration tables, granular 758 partition, kinship flags, and
// deposit-sized farm economics into the dashboard's z-data.js file.
//
// Size discipline: the dossier shows the dashboard source in path order under
// a 65,536-byte text cap, so z-data.js is kept lean and emitted one section
// per line (one line per board row). The granular partition slug lists are
// placed after rows so model diagnostics and the head of the board appear
// intact before any dossier line cut.

import type { FarmEconomics } from './farm.ts';
import * as farmMod from './farm.ts';
import {
  isLaunchCandidate,
  isPreToken,
  type FittedModel,
  type Protocol,
  type ScoredProtocol,
  type Snapshot,
} from './model.ts';

export interface GranularBucket {
  id: string;
  label: string;
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

const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATEGORIES = new Set([
  'Liquid Staking',
  'Liquid Restaking',
  'Restaking',
  'Staking Pool',
]);
const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

const STEM_STOPWORDS = new Set([
  'protocol',
  'finance',
  'network',
  'labs',
  'dao',
  'exchange',
  'swap',
  'dex',
  'lending',
  'yield',
  'vault',
  'vaults',
  'staking',
  'staked',
  'wrapped',
  'restaking',
  'restaked',
  'liquid',
  'bridge',
  'chain',
  'capital',
  'markets',
  'market',
  'money',
  'cash',
  'pool',
  'pools',
  'farm',
  'farming',
  'pro',
  'core',
  'prime',
  'lite',
  'app',
  'defi',
  'perp',
  'perps',
  'layer',
  'global',
  'world',
  'open',
  'meta',
  'super',
  'hyper',
  'omni',
  'multi',
  'cross',
  'crypto',
  'token',
  'coin',
  'block',
  'smart',
  'alpha',
  'beta',
  'first',
  'digital',
  'trust',
  'safe',
  'zero',
  'base',
  'true',
  'pure',
  'real',
  'free',
  'fast',
  'auto',
  'next',
  'high',
  'deep',
  'usd',
  'usdc',
  'usdt',
  'eth',
  'btc',
  'sol',
]);

function round4(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0;
}

function round3(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}

function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

// Four significant figures: implied values carry roughly two log points of
// model error, so digits past the fourth are noise.
function sig4(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 3);
  return Math.round(x / mag) * mag;
}

function verdictCode(verdict: FarmEconomics['verdict']): number {
  if (verdict === 'FARM') return 2;
  if (verdict === 'THIN') return 1;
  return 0;
}

function cmpSlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeWords(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\bv\d+(\.\d+)?\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/);
}

function extractStem(name: string): string {
  const words = normalizeWords(name);
  const meaningful = words.filter((w) => !STEM_STOPWORDS.has(w));
  if (meaningful.length > 0) {
    return meaningful.join(' ');
  }
  return words.join(' ');
}

/**
 * M6: "Kin of a token" flag (informational only, never an exclusion).
 * Flags any protocol that records no token whose normalized name stem (or
 * leading brand token) matches a tokenized protocol's name stem.
 */
export function computeKinshipMap(snapshot: Snapshot): Map<string, KinshipMatch> {
  const tokenizedByStem = new Map<string, string[]>();
  const tokenizedByLead = new Map<string, string[]>();

  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    const stem = extractStem(p.name);
    if (stem.length >= 3 && !STEM_STOPWORDS.has(stem)) {
      const list = tokenizedByStem.get(stem) ?? [];
      list.push(p.slug);
      tokenizedByStem.set(stem, list);
    }
    const words = normalizeWords(p.name);
    const lead = words[0] ?? '';
    if (lead.length >= 4 && !STEM_STOPWORDS.has(lead) && words.length <= 2) {
      const list = tokenizedByLead.get(lead) ?? [];
      list.push(p.slug);
      tokenizedByLead.set(lead, list);
    }
  }

  for (const list of tokenizedByStem.values()) list.sort(cmpSlug);
  for (const list of tokenizedByLead.values()) list.sort(cmpSlug);

  const kinMap = new Map<string, KinshipMatch>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const stem = extractStem(p.name);
    const exactMatches =
      stem.length >= 3 && !STEM_STOPWORDS.has(stem) ? tokenizedByStem.get(stem) : undefined;
    if (exactMatches && exactMatches.length > 0) {
      kinMap.set(p.slug, { stem, matches: exactMatches.slice(0, 5) });
      continue;
    }

    const words = normalizeWords(p.name);
    const lead = words[0] ?? '';
    const leadMatches =
      lead.length >= 4 && !STEM_STOPWORDS.has(lead) ? tokenizedByLead.get(lead) : undefined;
    if (leadMatches && leadMatches.length > 0) {
      kinMap.set(p.slug, { stem: lead, matches: leadMatches.slice(0, 5) });
    }
  }

  return kinMap;
}

function isExchangeNamed(p: Protocol): boolean {
  for (const ex of EXCHANGE_NAMES) {
    if (p.name.startsWith(ex)) return true;
  }
  return false;
}

/**
 * M6: Granular partition of every protocol in the snapshot into mutually
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
    {
      id: 'exchange_custody',
      label: 'Excluded: Exchange custody (CEX / exchange-named)',
      group: 'excluded',
    },
    {
      id: 'liquid_staking',
      label: 'Excluded: Liquid staking / restaking wrappers',
      group: 'excluded',
    },
    { id: 'versioned_releases', label: 'Excluded: Versioned releases (V2/V3)', group: 'excluded' },
    { id: 'wrapped_staked', label: 'Excluded: Wrapped / staked by name', group: 'excluded' },
    {
      id: 'partial_token',
      label: 'Excluded: Partial-token (id/symbol present, no usable mcap)',
      group: 'excluded',
    },
  ];

  const slugsById = new Map<string, string[]>();
  for (const def of bucketDefs) slugsById.set(def.id, []);

  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) && isPreToken(p)) {
      slugsById.get('watchlist')!.push(p.slug);
    } else if (isPreToken(p)) {
      if (isLaunchCandidate(p)) {
        slugsById.get('below_floor')!.push(p.slug);
      } else if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) {
        slugsById.get('bridges')!.push(p.slug);
      } else if (p.category === 'CEX' || isExchangeNamed(p)) {
        slugsById.get('exchange_custody')!.push(p.slug);
      } else if (p.category !== null && STAKING_CATEGORIES.has(p.category)) {
        slugsById.get('liquid_staking')!.push(p.slug);
      } else if (VERSION_SUFFIX.test(p.name)) {
        slugsById.get('versioned_releases')!.push(p.slug);
      } else if (WRAPPED_WORD.test(p.name)) {
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
    const slugs = slugsById.get(def.id)!.sort(cmpSlug);
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
function serialiseData(data: Record<string, unknown>): string {
  const lines = ['const LL={'];
  const keys = Object.keys(data);
  keys.forEach((key, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (key === 'rows') {
      lines.push('"rows":[');
      const rows = data[key] as unknown[];
      rows.forEach((row, j) => lines.push(JSON.stringify(row) + (j < rows.length - 1 ? ',' : '')));
      lines.push(']' + comma);
      return;
    }
    if (key === 'part') {
      lines.push('"part":[');
      const buckets = data[key] as unknown[];
      buckets.forEach((b, j) =>
        lines.push(JSON.stringify(b) + (j < buckets.length - 1 ? ',' : '')),
      );
      lines.push(']' + comma);
      return;
    }
    lines.push(`${JSON.stringify(key)}:${JSON.stringify(data[key])}${comma}`);
  });
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

  for (const row of rows) {
    const cat = row.protocol.category ?? 'Uncategorized';
    if (!catIndex.has(cat)) {
      catIndex.set(cat, categories.length);
      categories.push(cat);
    }
    for (const chain of row.protocol.chains) {
      if (!chainIndex.has(chain)) {
        chainIndex.set(chain, chains.length);
        chains.push(chain);
      }
    }
    const econ = econBySlug.get(row.protocol.slug);
    if (econ && econ.chain && !chainIndex.has(econ.chain)) {
      chainIndex.set(econ.chain, chains.length);
      chains.push(econ.chain);
    }
  }

  const r = model.report;
  const p = model.partition;
  const catReportMap = new Map(r.categories.map((c) => [c.name, c]));
  const granular = computeGranularPartition(snapshot, model);
  const kinMap = computeKinshipMap(snapshot);

  const farmExports = farmMod as Record<string, unknown>;
  const fam = (farmExports['FAMILY_BY_CATEGORY'] as Record<string, string> | undefined) ?? {};
  const tplAll = (farmExports['PLAN_TEMPLATES'] as Record<string, string[]> | undefined) ?? {};
  const multi = (farmExports['MULTI_CHAIN_STEP'] as string | undefined) ?? '';
  const single = (farmExports['SINGLE_CHAIN_STEP'] as string | undefined) ?? '';
  const fees = (farmExports['CHAIN_FEES'] as Record<string, number> | undefined) ?? {};
  const defFee = (farmExports['DEFAULT_FEE_USD'] as number | undefined) ?? 5;
  const grid = (farmExports['PLAN_DEPOSIT_GRID'] as readonly number[] | undefined) ?? [];
  const farmCfg = {
    defDep: (farmExports['DEFAULT_SANDBOX_DEPOSIT_USD'] as number | undefined) ?? 1000,
    defDays: (farmExports['DEFAULT_HOLDING_DAYS'] as number | undefined) ?? 90,
    minDep: (farmExports['MIN_PLAN_DEPOSIT_USD'] as number | undefined) ?? 100,
    maxDep: (farmExports['MAX_PLAN_DEPOSIT_USD'] as number | undefined) ?? 50000,
    tvlShare: (farmExports['DEFAULT_MAX_TVL_SHARE'] as number | undefined) ?? 0.0005,
  };

  // Both renderings of a farm plan use only the first three templates per
  // family (deploy + two follow-ups, then the chain step and the net verdict),
  // so the fourth template is never serialised.
  const tpl: Record<string, string[]> = {};
  for (const [family, steps] of Object.entries(tplAll)) {
    tpl[family] = steps.slice(0, 3);
  }

  // Anchors arrive sorted by TVL descending; an even stride over that order
  // keeps the sample spread across the whole TVL range.
  const anch: number[][] = [];
  const stride = Math.max(1, r.anchors.length / 45);
  for (let i = 0; i < 45 && i * stride < r.anchors.length; i++) {
    const a = r.anchors[Math.floor(i * stride)]!;
    anch.push([sig4(a.tvl), sig4(a.actual), sig4(a.predicted), sig4(a.looPredicted)]);
  }

  const data: Record<string, unknown> = {
    a: snapshot.as_of,
    t: snapshot.protocols.length,
    w: snapshot.watchlist.length,
    cats: categories,
    catn: categories.map((c) => catReportMap.get(c)?.n ?? 0),
    chains,
    fees,
    defFee,
    grid,
    farmCfg,
    fam,
    tpl,
    multi,
    single,
    el: Math.round(r.elasticity * 1000),
    mdl: {
      fitN: r.fitN,
      out: r.outliersDropped,
      int: round3(r.intercept),
      el: round3(r.elasticity),
      gCoef: r.growthCoef === null ? null : round3(r.growthCoef),
      aCoef: r.ageCoef === null ? null : round3(r.ageCoef),
      cv: [round3(r.cv.mdape), round3(r.cv.hit2x), round3(r.cv.spearman), r.cv.n],
      cvBig: [round3(r.cvBig.mdape), round3(r.cvBig.hit2x), round3(r.cvBig.spearman), r.cvBig.n],
      base: [round3(r.baseline.mdape), round3(r.baseline.hit2x), round3(r.baseline.spearman)],
      hold: [round3(r.newestHoldout.mdape), round3(r.newestHoldout.hit2x), r.newestHoldout.n],
      loo: [
        round3(r.loo.mdape),
        round3(r.loo.medianMiss),
        round3(r.loo.hit2x),
        round3(r.loo.hit3x),
        round3(r.loo.spearman),
        r.loo.n,
      ],
      cal: [
        r.rangeCalibration.n,
        r.rangeCalibration.p25p75Hits,
        round3(r.rangeCalibration.p25p75Rate),
        r.rangeCalibration.p10p90Hits,
        round3(r.rangeCalibration.p10p90Rate),
      ],
      abl: r.ablation.map((s) => [
        s.id,
        s.label,
        s.n,
        round3(s.mdape),
        round3(s.medianMiss),
        round3(s.hit2x),
        round3(s.hit3x),
        s.selected ? 1 : 0,
        s.status,
      ]),
      lo: {
        n: r.launchOdds.total,
        tok: r.launchOdds.tokenized,
        base: round3(r.launchOdds.baseRate),
        k: r.launchOdds.shrinkageK,
        uk: r.launchOdds.undatedShrinkageK,
        looOk: r.launchOdds.looCorrect,
        looAcc: round3(r.launchOdds.looAccuracy),
        baseOk: r.launchOdds.baseCorrect,
        baseAcc: round3(r.launchOdds.baseAccuracy),
        cuts: r.launchOdds.ageCutoffsDays,
        bands: r.launchOdds.ageBands.map((b) => [b.label, b.n, b.tokenized, round3(b.rate)]),
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
    kinN: rows.reduce((acc, row) => acc + (kinMap.has(row.protocol.slug) ? 1 : 0), 0),
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
        sig4(row.protocol.tvl_usd),
        row.protocol.change_7d === null ? null : round3(row.protocol.change_7d),
        sig4(row.impliedUsd),
        row.ageDays === null ? -1 : Math.round(row.ageDays),
        row.watchlist ? 1 : 0,
        sig4(row.breakdown.baseUsd),
        Math.round(row.breakdown.categoryFactor * 1000),
        Math.round(row.breakdown.growthFactor * 1000),
        Math.round(row.breakdown.ageFactor * 1000),
        row.rankLow,
        row.rankHigh,
        sig4(row.impliedLowUsd),
        sig4(row.impliedHighUsd),
        verdictCode(econ.verdict),
        round2(econ.netUsd),
        Number.isFinite(econ.breakevenUsd) ? Math.round(econ.breakevenUsd) : -1,
        chainIndex.get(econ.chain)!,
        round2(econ.feesUsd),
        sig4(row.valueIfLaunchUsd),
        Math.round(row.launchOdds * 1000),
        [
          row.launchCohort.ageBand,
          row.launchCohort.cohortN,
          row.launchCohort.cohortTokenized,
          Math.round(row.launchCohort.weight * 1000),
        ],
        sig4(row.impliedP25Usd),
        sig4(row.impliedP75Usd),
        sig4(row.valueIfLaunchP10Usd),
        sig4(row.valueIfLaunchP25Usd),
        sig4(row.valueIfLaunchP75Usd),
        sig4(row.valueIfLaunchP90Usd),
        Math.round(econ.depositUsd),
        round4(econ.netPerHourUsd),
        econ.breakevenLabel,
        kin ? 1 : 0,
        kin ? kin.matches : [],
      ];
    }),
    part: granular.buckets.map((b) => [b.id, b.label, b.group, b.count, b.slugs]),
  };

  return serialiseData(data);
}
