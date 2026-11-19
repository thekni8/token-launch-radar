// LaunchLens farm plans: concrete steps with a cost and a time, generated from
// templates keyed by the protocol's category family and composed with the
// protocol's own name and chains. Every step names an action, an amount, a
// cost and a time; steps are plausible for the category (a lending plan never
// says "swap"). Placeholders: {n} name, {c} first chain, {d} second chain.
//
// main.ts serialises FAMILY_BY_CATEGORY, PLAN_TEMPLATES, MULTI_CHAIN_STEP and
// SINGLE_CHAIN_STEP into the dashboard's data.js, so the page generates the
// exact same plan board.json carries for each protocol.

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

/** Four category-specific steps per family; the fifth step is the chain step below. */
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

/** Fifth step when the protocol runs on two or more chains. */
export const MULTI_CHAIN_STEP = 'Use {n} on {d} too — a second chain widens your footprint — gas ~$1–3, 10 min.';
/** Fifth step when the protocol runs on a single chain. */
export const SINGLE_CHAIN_STEP = 'Repeat your main {n} action weekly so the history stays fresh — ~$2/week in gas, 10 min.';

function fill(template: string, name: string, chain: string, chain2: string): string {
  return template.split('{n}').join(name).split('{c}').join(chain).split('{d}').join(chain2);
}

/**
 * The farm plan for one protocol: four category steps plus the chain step,
 * five strings in all. Every step is 20–600 characters once trimmed.
 */
export function farmPlan(category: string | null, name: string, chains: string[]): string[] {
  const family = familyFor(category);
  const templates = PLAN_TEMPLATES[family] ?? PLAN_TEMPLATES['generic']!;
  const chain = chains[0] ?? 'Ethereum';
  const chain2 = chains[1] ?? '';
  const steps = templates.map((t) => fill(t, name, chain, chain2));
  steps.push(fill(chains.length >= 2 ? MULTI_CHAIN_STEP : SINGLE_CHAIN_STEP, name, chain, chain2));
  return steps;
}
