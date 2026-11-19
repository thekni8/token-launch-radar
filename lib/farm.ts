// LaunchLens farm plans & economics: transparent per-chain round-trip fee
// assumptions, pro-rata airdrop return estimates, FARM/THIN/SKIP verdicts,
// and concrete category-tailored execution steps.
//
// main.ts serialises FAMILY_BY_CATEGORY, PLAN_TEMPLATES, MULTI_CHAIN_STEP,
// SINGLE_CHAIN_STEP, and CHAIN_FEES into the dashboard's data.js.

/** Fallback round-trip USD fee assumption for chains not listed in CHAIN_FEES. */
export const DEFAULT_FEE_USD = 5;

/**
 * Estimated round-trip cost in USD (entry + exit gas + one swap/bridge
 * allowance) per chain. Planning assumptions (typical 2026 fees), not live quotes.
 */
export const CHAIN_FEES: Record<string, number> = {
  Ethereum: 25,
  Bitcoin: 15,
  Tron: 4,
  Linea: 3,
  Arbitrum: 2.5,
  Optimism: 2.5,
  'zkSync Era': 2.5,
  Blast: 2.5,
  Scroll: 2.5,
  Base: 2,
  Starknet: 2,
  Mode: 2,
  Cardano: 2,
  Binance: 1.5,
  Avalanche: 1,
  Polygon: 1,
  Berachain: 1,
  Mantle: 1,
  TON: 1,
  Metis: 1,
  Solana: 0.5,
  'Hyperliquid L1': 0.5,
  Monad: 0.5,
  Sui: 0.5,
  Gnosis: 0.5,
  Fantom: 0.5,
  Celo: 0.5,
  Aptos: 0.5,
  Sonic: 0.5,
  Sei: 0.5,
  Near: 0.5,
  Kava: 0.5,
};

export interface FarmEconomics {
  depositUsd: number;
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  roiPct: number;
  breakevenUsd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  chain: string;
  poolPct: number;
  holdingDays: number;
  campaignDays: number;
}

export interface FarmOptions {
  depositUsd?: number;
  holdingDays?: number;
  poolPct?: number;
  campaignDays?: number;
}

function feeForChain(chain: string): number {
  return CHAIN_FEES[chain] ?? DEFAULT_FEE_USD;
}

/**
 * Pick the lowest-fee chain from the protocol's own chains array (ties: first
 * in the array). A protocol with no chains defaults to Ethereum.
 */
export function cheapestChain(chains: string[]): { chain: string; feeUsd: number } {
  if (!chains || chains.length === 0) {
    return { chain: 'Ethereum', feeUsd: feeForChain('Ethereum') };
  }
  let bestChain = chains[0]!;
  let bestFee = feeForChain(bestChain);
  for (let i = 1; i < chains.length; i++) {
    const candidate = chains[i]!;
    const fee = feeForChain(candidate);
    if (fee < bestFee) {
      bestChain = candidate;
      bestFee = fee;
    }
  }
  return { chain: bestChain, feeUsd: bestFee };
}

/** Verdict thresholds: FARM if net >= $50 and ROI >= 5%, THIN if net > 0, else SKIP. */
export function verdictFor(netUsd: number, roiPct: number): 'FARM' | 'THIN' | 'SKIP' {
  if (netUsd >= 50 && roiPct >= 5) return 'FARM';
  if (netUsd > 0) return 'THIN';
  return 'SKIP';
}

/**
 * Pro-rata farm economics bridging implied circulating value to user dollars:
 *   grossUsd = impliedUsd * (poolPct / 100) * (depositUsd / (tvlUsd + depositUsd)) * (holdingDays / campaignDays)
 *   netUsd   = grossUsd - feesUsd
 *   roiPct   = (netUsd / depositUsd) * 100
 *   breakevenUsd = feesUsd * tvlUsd / max(1e-9, impliedUsd * (poolPct / 100) * (holdingDays / campaignDays) - feesUsd)
 */
export function farmEconomics(
  tvlUsd: number,
  impliedUsd: number,
  chains: string[],
  opts?: FarmOptions,
): FarmEconomics {
  const depositUsd =
    opts?.depositUsd !== undefined && Number.isFinite(opts.depositUsd) && opts.depositUsd > 0
      ? opts.depositUsd
      : 1000;
  const holdingDays =
    opts?.holdingDays !== undefined && Number.isFinite(opts.holdingDays) && opts.holdingDays > 0
      ? opts.holdingDays
      : 90;
  const campaignDays =
    opts?.campaignDays !== undefined && Number.isFinite(opts.campaignDays) && opts.campaignDays > 0
      ? opts.campaignDays
      : 90;
  const poolPct =
    opts?.poolPct !== undefined && Number.isFinite(opts.poolPct) && opts.poolPct >= 0
      ? opts.poolPct
      : 8;

  const effTvl = Number.isFinite(tvlUsd) && tvlUsd > 0 ? tvlUsd : 1;
  const effImplied = Number.isFinite(impliedUsd) && impliedUsd > 0 ? impliedUsd : 0;

  const { chain, feeUsd: feesUsd } = cheapestChain(chains);
  const timeRatio = holdingDays / campaignDays;
  const poolShare = poolPct / 100;

  const grossUsd =
    effImplied <= 0
      ? 0
      : effImplied * poolShare * (depositUsd / (effTvl + depositUsd)) * timeRatio;

  const netUsd = grossUsd - feesUsd;
  const roiPct = (netUsd / depositUsd) * 100;

  const denom = effImplied * poolShare * timeRatio - feesUsd;
  const breakevenUsd =
    effImplied <= 0 || denom <= 0 ? Infinity : (feesUsd * effTvl) / Math.max(1e-9, denom);

  const verdict = effImplied <= 0 ? 'SKIP' : verdictFor(netUsd, roiPct);

  return {
    depositUsd,
    grossUsd,
    feesUsd,
    netUsd,
    roiPct,
    breakevenUsd,
    verdict,
    chain,
    poolPct,
    holdingDays,
    campaignDays,
  };
}

/** Category -> plan family. Categories not listed here use the generic family. */
export const FAMILY_BY_CATEGORY: Record<string, string> = {
  Dexs: 'dex',
  Lending: 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  CDP: 'cdp',
  'CDP Manager': 'cdp',
  Derivatives: 'deriv',
  'Interest Rate Derivatives': 'deriv',
  'Options Vault': 'deriv',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  Farm: 'yield',
  'Leveraged Farming': 'yield',
  'Liquid Staking': 'stake',
  'Liquid Restaking': 'stake',
  Restaking: 'stake',
  'Staking Pool': 'stake',
  'Restaked BTC': 'stake',
  'Anchor BTC': 'stake',
  'Decentralized BTC': 'stake',
  'Risk Curators': 'vault',
  'Onchain Capital Allocator': 'vault',
  'Liquidity Manager': 'vault',
  RWA: 'rwa',
  'Basis Trading': 'basis',
  Chain: 'chain',
  'Stablecoin Wrapper': 'stable',
  'Dual-Token Stablecoin': 'stable',
  'Prediction Market': 'predict',
  Payments: 'payments',
  Privacy: 'privacy',
  Indexes: 'indexes',
  Insurance: 'insurance',
  'Governance Incentives': 'governance',
};

export function familyFor(category: string | null): string {
  return (category !== null && FAMILY_BY_CATEGORY[category]) || 'generic';
}

/** Four category-specific steps per family; supplemented with economics & chain steps. */
export const PLAN_TEMPLATES: Record<string, string[]> = {
  dex: [
    'Swap $100+ on {n} ({c}) to start a volume history — gas ~$1–3, 5 min.',
    'Add $500+ liquidity to the top {n} pool on {c} — gas ~$3–8, 15 min; hold 30+ days.',
    'Swap weekly to build a steady volume record — ~$2/week in gas, 5 min each time.',
    'Provide liquidity in a second {n} pool to widen your footprint — gas ~$3–8, 15 min.',
  ],
  lending: [
    'Supply $500+ USDC to {n} on {c} — gas ~$2–5, 10 min; keep it supplied 30+ days.',
    'Borrow up to 30% LTV against your supply to show both sides — interest ~3–6% APR, 10 min.',
    'Top up your supply weekly and keep the loan healthy — ~$2/week in gas, 5 min each.',
    'Supply a second asset on {n} to diversify your position — gas ~$2–5, 10 min.',
  ],
  cdp: [
    'Lock $500+ of collateral in {n} on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Mint stablecoins against it at under 50% LTV — mint fee ~0–0.5%, 10 min.',
    'Keep the position over-collateralised and top up after dips — ~$2/week in gas, 5 min.',
    'Repay part of the mint monthly to show active management — gas ~$2–5, 10 min.',
  ],
  deriv: [
    'Open a $200+ position on {n} ({c}) — fees ~0.05%, 10 min.',
    'Hold the position 14+ days and roll it once to show duration — fees ~0.05%, 10 min.',
    'Trade $100+ a week to build a volume record — ~0.05% per trade, 10 min each.',
    'Try a second market on {n} to widen your footprint — fees ~0.05%, 10 min.',
  ],
  yield: [
    'Deposit $500+ into the top {n} vault on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Claim and restake rewards weekly to compound — gas ~$1–3 each time, 5 min.',
    'Add $100+ a week to build a deposit history — ~$2/week in gas, 5 min each.',
    'Try a second {n} vault with a different strategy — gas ~$2–5, 10 min.',
  ],
  stake: [
    'Stake $500+ with {n} on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Use the receipt token in a {c} DeFi pool for extra yield — gas ~$2–5, 15 min.',
    'Restake or top up $100+ weekly to grow the position — ~$2/week in gas, 5 min.',
    'Hold through reward snapshots and claim monthly — gas ~$1–3, 5 min.',
  ],
  vault: [
    'Deposit $500+ into the top {n} vault on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Split a second $250+ across another {n} vault — gas ~$2–5, 10 min.',
    'Top up $100+ weekly and review vault performance — ~$2/week in gas, 10 min.',
    'Hold through monthly rebalances without withdrawing — free, 10 min a month.',
  ],
  rwa: [
    'Invest $500+ in a {n} tokenised asset on {c} — gas ~$2–5, 15 min; hold 30+ days.',
    'Complete any {n} verification or onboarding steps — free, 15–30 min one-off.',
    'Reinvest distributions monthly to compound — gas ~$1–3, 10 min each.',
    'Add a second {n} asset class to diversify — gas ~$2–5, 15 min.',
  ],
  basis: [
    'Deposit $500+ into the {n} basis strategy on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Hold through at least one funding cycle (7+ days) — free, 10 min to check in.',
    'Top up $100+ weekly to grow the position — ~$2/week in gas, 5 min each.',
    'Claim yield monthly and restake it — gas ~$1–3, 10 min.',
  ],
  chain: [
    'Bridge $100+ to {n} and hold native gas funds — bridge fee ~$1–5, 15 min.',
    'Use a {n} app weekly — a swap or a deposit — to build on-chain history — ~$1/week, 10 min.',
    'Stake $200+ with a {n} validator if staking is live — gas ~$1–3, 10 min; hold 30+ days.',
    'Try a second {n} app to widen your footprint — gas ~$1–3, 10 min.',
  ],
  stable: [
    'Mint or buy $500+ of the {n} stable asset on {c} — gas ~$1–3, 10 min; hold 30+ days.',
    'Deposit it into a {c} lending pool to earn yield — gas ~$2–5, 10 min.',
    'Use it for a payment or swap weekly to show circulation — ~$1/week in gas, 5 min.',
    'Hold a second tranche through reward snapshots — free, 10 min a week.',
  ],
  predict: [
    'Place a $50+ prediction on {n} ({c}) — fees ~1–2%, 10 min.',
    'Trade a second market to widen your footprint — fees ~1–2%, 10 min.',
    'Hold positions through resolution and claim winnings — gas ~$1–3, 5 min.',
    'Bet $20+ weekly to build a trading record — ~$1/week in fees, 10 min each.',
  ],
  payments: [
    'Send a $50+ payment through {n} on {c} — fees ~0.1–1%, 5 min.',
    'Receive a payment or invoice through {n} to show both sides — free, 10 min.',
    'Use {n} weekly for a real payment — ~$1/week in fees, 5 min each.',
    'Hold a $100+ balance in {n} between payments — free, 5 min to check.',
  ],
  privacy: [
    'Deposit $100+ through {n} on {c} — gas ~$2–5, 10 min.',
    'Withdraw to a fresh address after a delay to complete the cycle — gas ~$2–5, 10 min.',
    'Repeat monthly to build a usage history — ~$4/month in gas, 10 min each.',
    'Use {n} from a second wallet to show repeat use — gas ~$2–5, 10 min.',
  ],
  indexes: [
    'Buy $200+ of the {n} index on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Dollar-cost-average $50+ weekly into the index — ~$2/week in gas, 5 min each.',
    'Hold through the monthly rebalance — free, 10 min to review.',
    'Try a second {n} index product — gas ~$2–5, 10 min.',
  ],
  insurance: [
    'Buy $200+ of cover on {n} ({c}) — premium ~1–3% of cover, 15 min.',
    'Provide $200+ to a {n} cover pool to earn premiums — gas ~$2–5, 15 min; hold 30+ days.',
    'Renew cover before it lapses to keep history continuous — premium ~1–3%, 10 min.',
    'Cover a second protocol through {n} — premium ~1–3%, 10 min.',
  ],
  governance: [
    'Lock $200+ in {n} governance on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    'Vote on an active {n} proposal — gas ~$1–3, 10 min.',
    'Vote in every proposal for a month to build a record — ~$1–3 per vote, 10 min each.',
    'Delegate part of your position to an active voter — gas ~$1–3, 10 min.',
  ],
  generic: [
    'Deposit $500+ into {n} on {c} — gas ~$2–5, 10 min; hold 30+ days.',
    "Use the protocol's main feature weekly to build a history — ~$2/week in gas, 10 min each.",
    'Top up $100+ weekly to grow your position — ~$2/week in gas, 5 min each.',
    'Hold through snapshots and claim any rewards monthly — gas ~$1–3, 5 min.',
  ],
};

/** Step when the protocol runs on two or more chains. */
export const MULTI_CHAIN_STEP = 'Use {n} on {d} too — a second chain widens your footprint — gas ~$1–3, 10 min.';
/** Step when the protocol runs on a single chain. */
export const SINGLE_CHAIN_STEP = 'Repeat your main {n} action weekly so the history stays fresh — ~$2/week in gas, 10 min.';

function fill(template: string, name: string, chain: string, chain2: string): string {
  return template.split('{n}').join(name).split('{c}').join(chain).split('{d}').join(chain2);
}

function formatDollars(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 100) {
    const rounded = Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}$${rounded}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

function clampStep(step: string): string {
  const trimmed = step.trim();
  if (trimmed.length <= 600) return trimmed;
  return trimmed.slice(0, 597).trimEnd() + '...';
}

/**
 * The farm plan for one protocol: 5 strings, each 20–600 characters once trimmed.
 * Step 1 states the deposit, cheapest chain, and round-trip fee alongside the
 * primary category action; steps 2–4 cover follow-through and chain breadth;
 * step 5 states the net dollar verdict (FARM / THIN / SKIP).
 */
export function farmPlan(
  category: string | null,
  name: string,
  chains: string[],
  econ: FarmEconomics,
): string[] {
  const family = familyFor(category);
  const templates = PLAN_TEMPLATES[family] ?? PLAN_TEMPLATES['generic']!;
  const chain = econ.chain || cheapestChain(chains).chain;
  const secondary = chains.find((c) => c !== chain) ?? chains[1] ?? '';

  const step1 = clampStep(
    `Deploy ${formatDollars(econ.depositUsd)} via ${chain} (~${formatDollars(econ.feesUsd)} round-trip fees): ${fill(templates[0]!, name, chain, secondary)}`,
  );
  const step2 = clampStep(fill(templates[1]!, name, chain, secondary));
  const step3 = clampStep(fill(templates[2]!, name, chain, secondary));
  const step4 = clampStep(
    fill(chains.length >= 2 && secondary ? MULTI_CHAIN_STEP : SINGLE_CHAIN_STEP, name, chain, secondary),
  );
  const step5 = clampStep(
    `Net at ${formatDollars(econ.depositUsd)} for ${econ.holdingDays} days: ${formatDollars(econ.netUsd)} after ~${formatDollars(econ.feesUsd)} fees (${econ.roiPct.toFixed(1)}% ROI) — verdict ${econ.verdict}.`,
  );

  return [step1, step2, step3, step4, step5];
}
