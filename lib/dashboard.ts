// Serialises the scored board into the dashboard's data.js: one compact
// positional array per row plus the small dictionaries the page needs.
// Categories and chains are stored once and referenced by index; the farm-plan
// templates ride along so the page generates the exact plan board.json carries.

import { FAMILY_BY_CATEGORY, MULTI_CHAIN_STEP, PLAN_TEMPLATES, SINGLE_CHAIN_STEP } from './farm.ts';
import type { Calibration, ScoredProtocol, Snapshot } from './model.ts';

/**
 * Row layout (positional, in order):
 * 0 slug, 1 name, 2 category index, 3 chain indices, 4 tvl_usd, 5 change_7d
 * (null when unreported), 6 implied_value_usd, 7 age in days (-1 when the
 * listing date is unknown), 8 watchlist flag (1/0), 9 base_usd,
 * 10 momentum x1000, 11 age factor x1000.
 */
export function dashboardData(snapshot: Snapshot, rows: ScoredProtocol[], cal: Calibration): string {
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
  }
  const data = {
    a: snapshot.as_of,
    t: snapshot.protocols.length,
    w: snapshot.watchlist.length,
    cats: categories,
    // Tokenised protocols calibrating each category (0 when the category fell back to the global median).
    catn: categories.map((c) => cal.categoryN.get(c) ?? 0),
    chains,
    fam: FAMILY_BY_CATEGORY,
    tpl: PLAN_TEMPLATES,
    multi: MULTI_CHAIN_STEP,
    single: SINGLE_CHAIN_STEP,
    rows: rows.map((row) => [
      row.protocol.slug,
      row.protocol.name,
      catIndex.get(row.protocol.category ?? 'Uncategorized'),
      row.protocol.chains.map((c) => chainIndex.get(c)),
      row.protocol.tvl_usd,
      row.protocol.change_7d,
      row.impliedUsd,
      row.ageDays === null ? -1 : row.ageDays,
      row.watchlist ? 1 : 0,
      row.baseUsd,
      Math.round(row.momentum * 1000),
      Math.round(row.age * 1000),
    ]),
  };
  return `const LL=${JSON.stringify(data)};\n`;
}
