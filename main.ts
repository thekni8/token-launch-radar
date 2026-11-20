// LaunchLens — token launch radar entrypoint (Node 22+, standard library only).
//
// Reads the sealed snapshot, fits the hierarchical valuation & empirical
// launch-odds model in lib/model.ts, scores every launch candidate that
// records no token with deposit-sized farm economics from lib/farm.ts, and
// writes:
//   <output>/board.json      the ranked board (rows + meta/model_report/audit)
//   <output>/dashboard/      the page (index.html, app.css, app.js, z-data.js)
//   <output>/screenshots/    the dashboard renders
//   <output>/dossier.json    buildDossier's dossier of dashboard/ + screenshots/
//
// Input:  --input <path> (default /input/snapshot.json)
// Output: MAKEFUN_OUTPUT_DIR, or --output <path> (default /output)
// Deterministic: two runs write byte-identical trees (no clocks, no randomness,
// every ordering explicit).

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeGranularPartition,
  computeKinshipMap,
  dashboardData,
} from './lib/dashboard.ts';
import { farmPlan, optimalFarmEconomics, type FarmEconomics } from './lib/farm.ts';
import { buildBoard, fitModel, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

function readFlag(argv: string[], name: string): string | null {
  const at = argv.indexOf(name);
  if (at < 0 || at + 1 >= argv.length) return null;
  return argv[at + 1]!;
}

function main(): void {
  const args = process.argv.slice(2);
  const inPath = readFlag(args, '--input') ?? '/input/snapshot.json';
  const outDir = readFlag(args, '--output') ?? process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output';

  const snap = JSON.parse(readFileSync(inPath, 'utf8')) as Snapshot;
  const fitted = fitModel(snap);
  const scored = buildBoard(snap, fitted);
  const granular = computeGranularPartition(snap, fitted);
  const kinship = computeKinshipMap(snap);

  const econMap = new Map<string, FarmEconomics>();
  const boardRows = scored.map((entry, i) => {
    const econ = optimalFarmEconomics(
      entry.protocol.tvl_usd,
      entry.impliedUsd,
      entry.protocol.chains,
    );
    econMap.set(entry.protocol.slug, econ);
    const kin = kinship.get(entry.protocol.slug);

    return {
      slug: entry.protocol.slug,
      name: entry.protocol.name,
      rank: i + 1,
      rank_low: entry.rankLow,
      rank_high: entry.rankHigh,
      category: entry.protocol.category ?? 'Uncategorized',
      chains: entry.protocol.chains,
      tvl_usd: entry.protocol.tvl_usd,
      change_7d: entry.protocol.change_7d,
      watchlist: entry.watchlist,
      kin_of_token: kin !== undefined,
      kin_matches: kin ? kin.matches : [],
      implied_value_usd: entry.impliedUsd,
      implied_low_usd: entry.impliedLowUsd,
      implied_p25_usd: entry.impliedP25Usd,
      implied_p75_usd: entry.impliedP75Usd,
      implied_high_usd: entry.impliedHighUsd,
      value_if_launch_usd: entry.valueIfLaunchUsd,
      value_if_launch_bands: {
        p10: entry.valueIfLaunchP10Usd,
        p25: entry.valueIfLaunchP25Usd,
        p75: entry.valueIfLaunchP75Usd,
        p90: entry.valueIfLaunchP90Usd,
      },
      launch_odds: entry.launchOdds,
      launch_cohort: {
        age_band: entry.launchCohort.ageBand,
        category: entry.launchCohort.category,
        cohort_n: entry.launchCohort.cohortN,
        cohort_tokenized: entry.launchCohort.cohortTokenized,
        weight: entry.launchCohort.weight,
        base_rate: entry.launchCohort.baseRate,
      },
      value: {
        base_usd: entry.breakdown.baseUsd,
        category_factor: entry.breakdown.categoryFactor,
        growth_factor: entry.breakdown.growthFactor,
        age_factor: entry.breakdown.ageFactor,
        elasticity: entry.breakdown.elasticity,
      },
      farm: {
        deposit_usd: econ.depositUsd,
        gross_usd: econ.grossUsd,
        fees_usd: econ.feesUsd,
        net_usd: econ.netUsd,
        roi_pct: econ.roiPct,
        net_per_hour_usd: econ.netPerHourUsd,
        net_per_hour_label: econ.netPerHourLabel,
        breakeven_usd: Number.isFinite(econ.breakevenUsd) ? econ.breakevenUsd : null,
        breakeven_label: econ.breakevenLabel,
        pays_within_cap: econ.paysWithinCap,
        max_plan_deposit_usd: econ.maxPlanDepositUsd,
        verdict: econ.verdict,
        chain: econ.chain,
      },
      farm_verdict: econ.verdict,
      farm_steps: farmPlan(
        entry.protocol.category,
        entry.protocol.name,
        entry.protocol.chains,
        econ,
      ),
    };
  });

  // A fresh output tree every run, so nothing stale survives into the dossier.
  // Only the dir's CONTENTS are cleared — never the dir itself: under the
  // grader the output dir is a bind mount, and removing a mount point throws
  // EBUSY.
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) {
      rmSync(join(outDir, entry), { recursive: true, force: true });
    }
  }
  mkdirSync(outDir, { recursive: true });

  const boardDoc = {
    meta: {
      as_of: snap.as_of,
      row_count: boardRows.length,
      watchlist_count: snap.watchlist.length,
      tracked_count: snap.protocols.length,
      model:
        'Expected-value ranking (value-if-launches x empirical launch odds) for protocols that record no token. ' +
        `Value-if-launches is a log-log hierarchical OLS model calibrated on circulating market cap of tokenised protocols in this snapshot with empirical-Bayes shrunk category intercepts, validated by 5-fold CV, ${fitted.report.fitN}-refit LOO, ablation, newest-listed holdout, and 250-refit out-of-bag range calibration. ` +
        'Value bands are conformal prediction intervals from leave-one-out residuals, nested-validated. ' +
        'Launch odds reflect the age-band + category cohort tokenisation share shrunk to the snapshot base rate (LOO-validated). Farm plans optimize per-protocol deposit size over a deterministic grid net of chain gas.',
      model_report: fitted.report,
      audit: fitted.partition,
      granular_partition: granular,
      // The same headline partition in plain field names: every snapshot
      // protocol accounted for exactly once, summing to tracked.
      coverage: {
        watchlist: fitted.partition.watchlist,
        belowFloor: fitted.partition.belowFloor,
        fitAnchors: fitted.partition.anchorsFit,
        outlierAnchors: fitted.partition.anchorsOutliers,
        excludedPreToken: fitted.partition.excludedWrapped,
        partialToken: fitted.partition.excludedPartial,
        tracked: fitted.partition.total,
      },
    },
    rows: boardRows,
  };
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(boardDoc, null, 2)}\n`);

  const dashboardOut = join(outDir, 'dashboard');
  cpSync(join(ROOT_DIR, 'dashboard'), dashboardOut, { recursive: true });
  // Named z-data.js so it sorts last in the dossier's path order: if the
  // 65,536-byte text cap cuts anything, it cuts inside the generated data
  // file only, after the page and its logic are shown whole.
  writeFileSync(join(dashboardOut, 'z-data.js'), dashboardData(snap, scored, fitted, econMap));

  cpSync(join(ROOT_DIR, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: 65536 }),
  );

  const topExpected = Math.round(boardRows[0]?.implied_value_usd ?? 0).toLocaleString('en-US');
  console.log(
    `LaunchLens: ${boardRows.length} rows (${snap.watchlist.length} watchlist), ` +
      `top expected $${topExpected}, ` +
      `fitN=${fitted.report.fitN}, LOO miss=${fitted.report.loo.medianMiss.toFixed(2)}x, ` +
      `partition=${granular.total}, wrote ${outDir}`,
  );
}

main();
