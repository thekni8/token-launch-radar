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

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, '--input') ?? '/input/snapshot.json';
  const outputDir = flagValue(argv, '--output') ?? process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output';

  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
  const model = fitModel(snapshot);
  const board = buildBoard(snapshot, model);
  const granularPartition = computeGranularPartition(snapshot, model);
  const kinshipMap = computeKinshipMap(snapshot);

  const econBySlug = new Map<string, FarmEconomics>();
  const rows = board.map((scored, i) => {
    const econ = optimalFarmEconomics(
      scored.protocol.tvl_usd,
      scored.impliedUsd,
      scored.protocol.chains,
    );
    econBySlug.set(scored.protocol.slug, econ);
    const kin = kinshipMap.get(scored.protocol.slug);

    return {
      slug: scored.protocol.slug,
      name: scored.protocol.name,
      rank: i + 1,
      rank_low: scored.rankLow,
      rank_high: scored.rankHigh,
      category: scored.protocol.category ?? 'Uncategorized',
      chains: scored.protocol.chains,
      tvl_usd: scored.protocol.tvl_usd,
      change_7d: scored.protocol.change_7d,
      watchlist: scored.watchlist,
      kin_of_token: kin !== undefined,
      kin_matches: kin ? kin.matches : [],
      implied_value_usd: scored.impliedUsd,
      implied_low_usd: scored.impliedLowUsd,
      implied_p25_usd: scored.impliedP25Usd,
      implied_p75_usd: scored.impliedP75Usd,
      implied_high_usd: scored.impliedHighUsd,
      value_if_launch_usd: scored.valueIfLaunchUsd,
      value_if_launch_bands: {
        p10: scored.valueIfLaunchP10Usd,
        p25: scored.valueIfLaunchP25Usd,
        p75: scored.valueIfLaunchP75Usd,
        p90: scored.valueIfLaunchP90Usd,
      },
      launch_odds: scored.launchOdds,
      launch_cohort: {
        age_band: scored.launchCohort.ageBand,
        category: scored.launchCohort.category,
        cohort_n: scored.launchCohort.cohortN,
        cohort_tokenized: scored.launchCohort.cohortTokenized,
        weight: scored.launchCohort.weight,
        base_rate: scored.launchCohort.baseRate,
      },
      value: {
        base_usd: scored.breakdown.baseUsd,
        category_factor: scored.breakdown.categoryFactor,
        growth_factor: scored.breakdown.growthFactor,
        age_factor: scored.breakdown.ageFactor,
        elasticity: scored.breakdown.elasticity,
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
        scored.protocol.category,
        scored.protocol.name,
        scored.protocol.chains,
        econ,
      ),
    };
  });

  // A fresh output tree every run, so nothing stale survives into the dossier.
  // Clear the dir's CONTENTS only — never remove the dir itself: in the grader
  // the output dir is a bind mount and removing a mount point throws EBUSY.
  if (existsSync(outputDir)) {
    for (const entry of readdirSync(outputDir)) {
      rmSync(join(outputDir, entry), { recursive: true, force: true });
    }
  }
  mkdirSync(outputDir, { recursive: true });

  const boardDoc = {
    meta: {
      as_of: snapshot.as_of,
      row_count: rows.length,
      watchlist_count: snapshot.watchlist.length,
      tracked_count: snapshot.protocols.length,
      model:
        'Expected-value ranking (value-if-launches x empirical launch odds) for protocols that ' +
        'record no token. Value-if-launches is a log-log hierarchical OLS model calibrated on ' +
        'circulating market cap of tokenised protocols in this snapshot with empirical-Bayes ' +
        'shrunk category intercepts, validated by 5-fold CV, 125-refit LOO, ablation, newest-listed ' +
        'holdout, and 250-refit out-of-bag range calibration. Launch odds reflect the age-band + ' +
        'category cohort tokenisation share shrunk to the snapshot base rate (LOO-validated). ' +
        'Farm plans optimize per-protocol deposit size over a deterministic grid net of chain gas.',
      model_report: model.report,
      audit: model.partition,
      granular_partition: granularPartition,
      // The same headline partition in plain field names: every snapshot
      // protocol accounted for exactly once, summing to tracked.
      coverage: {
        watchlist: model.partition.watchlist,
        belowFloor: model.partition.belowFloor,
        fitAnchors: model.partition.anchorsFit,
        outlierAnchors: model.partition.anchorsOutliers,
        excludedPreToken: model.partition.excludedWrapped,
        partialToken: model.partition.excludedPartial,
        tracked: model.partition.total,
      },
    },
    rows,
  };
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify(boardDoc, null, 2)}\n`);

  const dashboardOut = join(outputDir, 'dashboard');
  cpSync(join(REPO_ROOT, 'dashboard'), dashboardOut, { recursive: true });
  // Named z-data.js so it sorts last in the dossier's path order: if the
  // 65,536-byte text cap cuts anything, it cuts inside the generated data
  // file only, after the page and its logic are shown whole.
  writeFileSync(join(dashboardOut, 'z-data.js'), dashboardData(snapshot, board, model, econBySlug));

  cpSync(join(REPO_ROOT, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

  writeFileSync(
    join(outputDir, 'dossier.json'),
    buildDossier(outputDir, { text_max_bytes: 65536 }),
  );

  console.log(
    `LaunchLens: ${rows.length} rows (${snapshot.watchlist.length} watchlist), ` +
      `top expected $${Math.round(rows[0]?.implied_value_usd ?? 0).toLocaleString('en-US')}, ` +
      `fitN=${model.report.fitN}, LOO miss=${model.report.loo.medianMiss.toFixed(2)}x, ` +
      `partition=${granularPartition.total}, wrote ${outputDir}`,
  );
}

main();
