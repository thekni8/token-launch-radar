// LaunchLens — token launch radar entrypoint (Node 22+, standard library only).
//
// Reads the sealed snapshot, scores every pre-token launch candidate with the
// model in lib/model.ts, and writes:
//   <output>/board.json      the ranked board (rows + a small meta block)
//   <output>/dashboard/      the page (index.html, app.css, app.js, data.js)
//   <output>/screenshots/    the three dashboard renders
//   <output>/dossier.json    buildDossier's dossier of dashboard/ + screenshots/
//
// Input:  --input <path> (default /input/snapshot.json)
// Output: MAKEFUN_OUTPUT_DIR, or --output <path> (default /output)
// Deterministic: two runs write byte-identical trees (no clocks, no randomness,
// every ordering explicit).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardData } from './lib/dashboard.ts';
import { farmPlan } from './lib/farm.ts';
import { buildBoard, calibrate, type Snapshot } from './lib/model.ts';
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
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, calibration);

  const rows = board.map((scored, i) => ({
    slug: scored.protocol.slug,
    name: scored.protocol.name,
    rank: i + 1,
    category: scored.protocol.category ?? 'Uncategorized',
    chains: scored.protocol.chains,
    tvl_usd: scored.protocol.tvl_usd,
    change_7d: scored.protocol.change_7d,
    watchlist: scored.watchlist,
    implied_value_usd: scored.impliedUsd,
    value: {
      multiple: scored.multiple,
      base_usd: scored.baseUsd,
      momentum: scored.momentum,
      age_factor: scored.age,
    },
    farm_steps: farmPlan(scored.protocol.category, scored.protocol.name, scored.protocol.chains),
  }));

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
        'implied = TVL x category median mcap/TVL (tokenised protocols, this snapshot; ' +
        'global median when a category has fewer than 3) x momentum (7d TVL change, clamped +/-30%) ' +
        'x age factor (log of days listed with no token, capped +30%). Board: every watchlist ' +
        'protocol plus every other pre-token protocol that is not a wrapped, staked or bridged ' +
        'product of a token that already trades.',
    },
    rows,
  };
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify(boardDoc, null, 2)}\n`);

  const dashboardOut = join(outputDir, 'dashboard');
  cpSync(join(REPO_ROOT, 'dashboard'), dashboardOut, { recursive: true });
  writeFileSync(join(dashboardOut, 'data.js'), dashboardData(snapshot, board, calibration));

  cpSync(join(REPO_ROOT, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

  writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: 65536 }));

  console.log(
    `LaunchLens: ${rows.length} rows (${snapshot.watchlist.length} watchlist), ` +
      `top implied $${rows[0]!.implied_value_usd.toLocaleString('en-US')}, wrote ${outputDir}`,
  );
}

main();
