// Serialises the scored board, fitted model diagnostics, and farm economics
// into the dashboard's data file: one compact positional array per row plus
// the dictionaries, model summary, and plan templates the page needs.
//
// Size discipline: the dossier shows the dashboard source in path order under
// a 65,536-byte text cap, so this file is kept lean — anchors are a TVL-spread
// sample (full identities live in board.json's model_report), big integers
// are rounded to 4 significant figures, and only the three plan templates
// each rendering actually uses are serialised. The file is emitted one
// section per line (one line per board row): the dossier cuts at line
// boundaries, so a single-line file would be left out whole instead of
// showing its head.

import type { FarmEconomics } from './farm.ts';
import * as farmMod from './farm.ts';
import type { FittedModel, ScoredProtocol, Snapshot } from './model.ts';

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
    lines.push(`${JSON.stringify(key)}:${JSON.stringify(data[key])}${comma}`);
  });
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

/**
 * Row layout (positional, in order):
 * 0 slug, 1 name, 2 category index, 3 chain indices, 4 tvl_usd, 5 change_7d
 * (null when unreported), 6 implied_value_usd, 7 age in days (-1 when unknown),
 * 8 watchlist flag (1/0), 9 base_usd, 10 category factor x1000,
 * 11 growth factor x1000, 12 age factor x1000, 13 rank_low, 14 rank_high,
 * 15 implied_low_usd, 16 implied_high_usd, 17 verdict (0 SKIP / 1 THIN / 2 FARM),
 * 18 net_usd, 19 breakeven_usd (-1 when Infinity), 20 cheapest-chain index,
 * 21 round-trip fees_usd.
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

  const farmExports = farmMod as Record<string, unknown>;
  const fam = (farmExports['FAMILY_BY_CATEGORY'] as Record<string, string> | undefined) ?? {};
  const tplAll = (farmExports['PLAN_TEMPLATES'] as Record<string, string[]> | undefined) ?? {};
  const multi = (farmExports['MULTI_CHAIN_STEP'] as string | undefined) ?? '';
  const single = (farmExports['SINGLE_CHAIN_STEP'] as string | undefined) ?? '';

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
    anch.push([sig4(a.tvl), sig4(a.actual), sig4(a.predicted)]);
  }

  const data: Record<string, unknown> = {
    a: snapshot.as_of,
    t: snapshot.protocols.length,
    w: snapshot.watchlist.length,
    cats: categories,
    catn: categories.map((c) => catReportMap.get(c)?.n ?? 0),
    chains,
    fam,
    tpl,
    multi,
    single,
    el: Math.round(r.elasticity * 1000),
    mdl: {
      fitN: r.fitN,
      out: r.outliersDropped,
      cv: [round3(r.cv.mdape), round3(r.cv.hit2x), round3(r.cv.spearman), r.cv.n],
      cvBig: [round3(r.cvBig.mdape), round3(r.cvBig.hit2x), round3(r.cvBig.spearman), r.cvBig.n],
      base: [round3(r.baseline.mdape), round3(r.baseline.hit2x), round3(r.baseline.spearman)],
      hold: [round3(r.newestHoldout.mdape), round3(r.newestHoldout.hit2x), r.newestHoldout.n],
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
    rows: rows.map((row) => {
      const econ = econBySlug.get(row.protocol.slug);
      if (!econ) {
        throw new Error(`Missing farm economics for ${row.protocol.slug}`);
      }
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
        Math.round(econ.netUsd),
        Number.isFinite(econ.breakevenUsd) ? Math.round(econ.breakevenUsd) : -1,
        chainIndex.get(econ.chain)!,
        round2(econ.feesUsd),
      ];
    }),
  };

  return serialiseData(data);
}
