// LaunchLens value model: every number is calibrated from the snapshot itself.
//
// The implied value of a pre-token protocol is:
//   implied = TVL x category multiple x momentum x age factor
// where the category multiple is the median mcap/TVL of the tokenised protocols
// in that category, measured from this snapshot at run time. Nothing is typed
// in by hand: a category with too few tokenised protocols falls back to the
// global median multiple. Momentum comes from the 7-day TVL change (clamped to
// +/-30%); the age factor rewards long operation at scale with no token, on a
// log scale with diminishing returns (capped at +30%).

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

/** A protocol records no token when DefiLlama records neither a CoinGecko id nor a ticker. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// A wrapped, staked or bridged product of a token that already trades is not
// a launch waiting to happen (WBTC is Bitcoin on Ethereum; an exchange's
// staked-ETH product is ETH in a staking wrapper). The board leaves those out,
// using the same rule the snapshot's watchlist was built with, minus the
// parent-protocol field the snapshot does not carry.
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

/** Median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Categories need this many tokenised protocols before their own median is trusted. */
const MIN_CATEGORY_N = 3;

export interface Calibration {
  /** Median mcap/TVL across every tokenised protocol in the snapshot. */
  globalMultiple: number;
  /** Per-category median mcap/TVL, for categories with at least MIN_CATEGORY_N tokenised protocols. */
  categoryMultiples: Map<string, number>;
  /** How many tokenised protocols calibrated each category (0 when it fell back to the global median). */
  categoryN: Map<string, number>;
}

/**
 * Calibrate the FDV/TVL multiples from the snapshot's own tokenised protocols:
 * each protocol that records a market cap contributes mcap_usd / tvl_usd.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    // A $0 market cap is missing data, not a price: only a positive cap calibrates.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const multiple = p.mcap_usd / p.tvl_usd;
    all.push(multiple);
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key);
    if (list) list.push(multiple);
    else byCategory.set(key, [multiple]);
  }
  const globalMultiple = median(all);
  const categoryMultiples = new Map<string, number>();
  const categoryN = new Map<string, number>();
  for (const [category, values] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    categoryN.set(category, values.length);
    if (values.length >= MIN_CATEGORY_N) categoryMultiples.set(category, median(values));
  }
  return { globalMultiple, categoryMultiples, categoryN };
}

export function multipleFor(p: Protocol, cal: Calibration): number {
  const key = p.category ?? 'Uncategorized';
  return cal.categoryMultiples.get(key) ?? cal.globalMultiple;
}

/** Whole days between two YYYY-MM-DD dates, UTC, never negative. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Momentum from the 7-day TVL change, clamped to +/-30%. Null change is neutral. */
export function momentumFactor(p: Protocol): number {
  if (p.change_7d === null) return 1;
  return Math.min(1.3, Math.max(0.7, 1 + p.change_7d / 100));
}

/**
 * Age factor from the listing date: longer at scale with no token means more
 * pent-up launch value, with diminishing returns (log scale, capped at +30%).
 * An unlisted date is neutral.
 */
export function ageFactor(p: Protocol, asOf: string): number {
  if (p.listed_at === null) return 1;
  const days = daysBetween(p.listed_at, asOf);
  return Math.min(1.3, 1 + 0.15 * Math.log(1 + days / 365));
}

export interface ScoredProtocol {
  protocol: Protocol;
  multiple: number;
  baseUsd: number;
  momentum: number;
  age: number;
  ageDays: number | null;
  impliedUsd: number;
  watchlist: boolean;
}

/** Score one protocol: base x momentum x age, rounded to whole dollars. */
export function scoreProtocol(p: Protocol, cal: Calibration, asOf: string, watchlist: boolean): ScoredProtocol {
  const multiple = multipleFor(p, cal);
  const baseUsd = Math.round(p.tvl_usd * multiple);
  const momentum = momentumFactor(p);
  const age = ageFactor(p, asOf);
  const ageDays = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const impliedUsd = Math.max(1, Math.round(baseUsd * momentum * age));
  return { protocol: p, multiple, baseUsd, momentum, age, ageDays, impliedUsd, watchlist };
}

/**
 * Build the board: every watchlist slug, plus every other pre-token protocol
 * that is a genuine launch candidate, ranked by implied value descending
 * (slug ascending breaks ties, so the order is deterministic).
 */
export function buildBoard(snapshot: Snapshot, cal: Calibration): ScoredProtocol[] {
  const watch = new Set(snapshot.watchlist);
  const rows: ScoredProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug)) {
      rows.push(scoreProtocol(p, cal, snapshot.as_of, true));
    } else if (isLaunchCandidate(p)) {
      rows.push(scoreProtocol(p, cal, snapshot.as_of, false));
    }
  }
  rows.sort((a, b) => b.impliedUsd - a.impliedUsd || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  return rows;
}
