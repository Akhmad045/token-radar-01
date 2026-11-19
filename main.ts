// Token Launch Radar v2 — entrypoint (Node 22, standard library only, authored for token-radar-01).
//
// What this program does, end to end:
//   1. Reads the sealed DefiLlama snapshot (--input <file|dir>, default /input/snapshot.json).
//   2. Learns how the market prices TVL from the snapshot itself: for every category, the median
//      market-cap / TVL ratio of the protocols in that category whose token already trades.
//   3. Scores every genuine pre-token candidate with those peer multiples plus three more
//      snapshot-only signals (7-day momentum, time tracked with no token recorded, chain breadth).
//   4. Writes /output/board.json (the ranked board), /output/data.js (the dashboard's dataset),
//      copies dashboard/ and screenshots/ into /output, and writes /output/dossier.json last,
//      with buildDossier from vendor/makefun-board.ts.
//
// Language the rules require: a protocol on this board "records no token" in its DefiLlama record.
// That is a statement about the record, never proof that no token exists anywhere.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

/* ------------------------------------------------------------------ types */

interface Protocol {
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

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface Breakdown {
  peer_multiple: number;
  peer_count: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'records-no-token';
  implied_value_usd: number;
  model: Breakdown;
  farm_steps: string[];
}

/* ------------------------------------------------------- model constants */
/*
 * The implied-value model (version radar-2). One function scores every row; no name is special-cased.
 *
 *   implied = TVL x peerMultiple(category) x momentum x maturity x breadth
 *
 * peerMultiple  The market's own price of a dollar of TVL in this category: the median mcap/TVL of
 *               the category's already-trading protocols in this same snapshot, shrunk toward the
 *               global median with a prior weight of 6 peers, then clamped to [0.08, 1.20] so a
 *               thin or frothy category cannot dominate the board. Individual peer ratios are
 *               winsorised at 3.0 first, so one micro-cap outlier cannot price a whole category.
 * momentum      1 + 0.55 x clamp(change_7d, -45, +60) / 100. A protocol gaining TVL is gaining the
 *               users a launch would be priced on; a shrinking one is discounted, never zeroed.
 * maturity      0.78 + 0.44 x min(age_days, 1460) / 1460, where age is days from listed_at to the
 *               snapshot's as_of. Four years tracked with no token recorded earns the full premium:
 *               the protocol has had every chance to launch and built TVL anyway. Unknown listing
 *               dates use a neutral 540 days.
 * breadth       1 + 0.05 x ln(chain count), capped at 1.12. Multi-chain reach is distribution a
 *               new token would inherit on day one.
 */
const MODEL_VERSION = 'radar-2';
const PRIOR_WEIGHT = 6;
const RATIO_WINSOR = 3.0;
const MULT_FLOOR = 0.08;
const MULT_CAP = 1.2;
const MOMENTUM_WEIGHT = 0.55;
const MOMENTUM_MIN = -45;
const MOMENTUM_MAX = 60;
const MATURITY_BASE = 0.78;
const MATURITY_SPAN = 0.44;
const MATURITY_DAYS = 1460;
const UNKNOWN_AGE_DAYS = 540;
const BREADTH_WEIGHT = 0.05;
const BREADTH_CAP = 1.12;
const LIVE_ROWS = 24;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------ snapshot in */

function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.source !== 'string') throw new Error('snapshot lacks as_of/source');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new Error('snapshot lacks floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot lacks protocols/watchlist');
  const protocols: Protocol[] = o.protocols.map((v, i) => {
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`protocol ${i} lacks slug, name or tvl_usd`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

/* ------------------------------------------------------------- the model */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Category peer multiples learned from the snapshot's own trading protocols. */
function peerMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, RATIO_WINSOR);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of ratios) {
    const shrunk = (list.length * median(list) + PRIOR_WEIGHT * global) / (list.length + PRIOR_WEIGHT);
    byCategory.set(category, { multiple: clamp(shrunk, MULT_FLOOR, MULT_CAP), peers: list.length });
  }
  return { byCategory, global };
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four factors and the implied value for one protocol. Pure: same inputs, same outputs. */
function scoreProtocol(
  p: Protocol,
  asOf: string,
  peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; breakdown: Breakdown } {
  const peer = peers.byCategory.get(p.category ?? 'Uncategorised');
  const peerMultiple = peer ? peer.multiple : clamp(peers.global, MULT_FLOOR, MULT_CAP);
  const growth = clamp(p.change_7d ?? 0, MOMENTUM_MIN, MOMENTUM_MAX);
  const momentum = 1 + MOMENTUM_WEIGHT * (growth / 100);
  const age = ageDays(asOf, p.listed_at);
  const maturity = MATURITY_BASE + (Math.min(age ?? UNKNOWN_AGE_DAYS, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_SPAN;
  const breadth = Math.min(BREADTH_CAP, 1 + BREADTH_WEIGHT * Math.log(Math.max(1, p.chains.length)));
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * momentum * maturity * breadth));
  return {
    implied,
    breakdown: {
      peer_multiple: round4(peerMultiple),
      peer_count: peer ? peer.peers : 0,
      momentum_multiplier: round4(momentum),
      maturity_multiplier: round4(maturity),
      breadth_multiplier: round4(breadth),
      age_days: age,
    },
  };
}

/* ------------------------------------------------------- who gets ranked */

/** Records no token in the snapshot: no market cap, no CoinGecko id, no symbol. */
function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * A genuine launch candidate: records no token and is not a wrapped, staked, bridged or exchange
 * product of something that already trades — the same exclusions the house's watchlist rule uses,
 * applied at every TVL, so the radar's early rows are held to the watchlist's own standard.
 */
function isCandidate(p: Protocol): boolean {
  return (
    recordsNoToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED_NAME.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/* -------------------------------------------------------------- farm plan */
/*
 * Farm plans are derived from the protocol's own record — category, first chain, TVL tier and age —
 * never from a hand-written list of names. Every step states its action, its cost and its time.
 * dashboard/app.js carries the same derivation so the page and board.json cannot drift apart.
 */

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function gasFor(chain: string): { first: string; weekly: string } {
  return chain === 'Ethereum'
    ? { first: 'about $8 of Ethereum gas', weekly: 'about $6 of gas a week' }
    : { first: 'about $2 of gas', weekly: 'about $1 of gas a week' };
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The two protocol-specific actions for a category: open the position, then deepen it. */
function actionsFor(p: Protocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp'))
    return [
      `Supply $${capital} of USDC as collateral in ${n} on ${chain} and leave the deposit open.`,
      `Borrow a small amount (under 40% of the collateral value) against the position in ${n}, then repay it a week later to record a full lend-and-borrow cycle.`,
    ];
  if (c.includes('dex'))
    return [
      `Swap $${capital} of USDC into the main pair on ${n} (${chain}) and add the proceeds as liquidity to its largest pool.`,
      `Make one further swap of about $25 through ${n} each visit and keep the LP position open instead of withdrawing after the first trade.`,
    ];
  if (c.includes('deriv') || c.includes('perpetual'))
    return [
      `Deposit $${capital} of USDC as margin on ${n} and open one small position (under 2x leverage) that you close the same day.`,
      `Return weekly to open and close one small hedged trade on ${n} so volume builds across several weeks, not in a single day.`,
    ];
  if (c.includes('bridge') || c.includes('cross chain'))
    return [
      `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n} and hold the bridged funds in the destination wallet.`,
      `Use the bridged funds in one app on ${chain} (a swap or a deposit) so the trip ends in real activity, not an empty wallet.`,
    ];
  if (c.includes('restak') || c.includes('staking'))
    return [
      `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the staking receipt token in the same wallet.`,
      `Claim or compound any staking rewards inside ${n} once a month rather than moving the receipt to another protocol.`,
    ];
  if (c.includes('rwa'))
    return [
      `Complete ${n}'s onboarding or allowlist step if it asks for one, then mint $${capital} of its yield-bearing asset on ${chain}.`,
      `Hold the minted asset in the farming wallet and make one small additional mint of about $25 after the first month.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund the wallet with $${capital} and take one small position in a liquid market on ${n}, sized under $25.`,
      `Settle or roll that position when its market resolves and take one new position, so the account shows repeat participation.`,
    ];
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager'))
    return [
      `Deposit $${capital} of USDC into an active ${n} vault on ${chain} and keep the vault shares in the wallet.`,
      `Add about $25 to the same vault after two weeks instead of opening a second vault, so the position reads as one committed allocation.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy $${capital} of cover (or supply $${capital} to a cover pool) on ${n} for the shortest term it offers.`,
      `Renew or extend the cover once before it lapses so the wallet shows continuous, not one-off, participation.`,
    ];
  if (c.includes('chain'))
    return [
      `Bridge $${capital} of USDC onto ${n}'s network and make the farming wallet your active wallet on that chain.`,
      `Use two native apps on the chain each week (one swap, one deposit) so activity is spread across the ecosystem.`,
    ];
  if (c.includes('yield') || c.includes('farm') || c.includes('basis'))
    return [
      `Deposit $${capital} of USDC into ${n}'s main vault or pool on ${chain} and keep the position open.`,
      `Harvest or compound the position's yield inside ${n} once a week rather than withdrawing it to another protocol.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open.`,
    `Repeat one small action in ${n} (a deposit, a swap or a vote) after two weeks so the wallet shows continuing use.`,
  ];
}

function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const [open, deepen] = actionsFor(p, capital, chain);
  const raw = [
    `Set up a fresh wallet that holds only the funds for this farm and store its seed phrase offline, never in a screenshot or a cloud note. Cost: ${gas.first} for the first funding transaction. Time: 10 minutes.`,
    `${open} Cost: $${capital} of capital plus ${gas.first}. Time: 15 minutes to set up.`,
    `${deepen} Cost: about $25 of capital movement plus ${gas.weekly.replace(' a week', '')}. Time: 10 minutes.`,
    `Repeat one qualifying action in ${p.name} every week (a deposit, a swap, a borrow or a vote) so the wallet builds a multi-week history. Cost: ${gas.weekly}. Time: 10 minutes a week.`,
    `Hold the main position for at least ${hold} days so the activity spans more than one weekly snapshot of the protocol. Cost: the $${capital} stays committed for the full ${hold} days. Time: ${hold} days.`,
    `Each week, check ${p.name}'s own points or rewards page from the link in its app and claim only there — never pay a fee to claim. Keep a log of wallet, dates and transaction hashes. Cost: nothing to check; never pay to claim. Time: 10 minutes a week.`,
  ];
  return raw.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/* ------------------------------------------------------------ build board */

function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; peers: ReturnType<typeof peerMultiples>; early: number } {
  const peers = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, Protocol>();
  for (const p of snapshot.protocols) if (isCandidate(p)) chosen.set(p.slug, p);
  // The watchlist is the floor: every watchlist slug is ranked even if the candidate filter above
  // would have left it out — coverage is never gambled on a filter.
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((x) => x.slug === slug);
    if (p) chosen.set(slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, peers);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.age_days,
    watchlist: watch.has(s.p.slug),
    token_status: 'records-no-token',
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
  return { rows, peers, early: rows.filter((r) => !r.watchlist).length };
}

/** The already-trading set, shown apart from the board with the market's own values. */
function liveRows(snapshot: Snapshot) {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Refuse to write a board the gate would refuse: coverage, ranks, order, farm-step shape. */
function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100) return `only ${rows.length} rows`;
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has a bad implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step outside 20..600 chars`;
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/* ------------------------------------------------------------------- main */

function cliArg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const inputArg = cliArg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile} — pass --input <snapshot.json|dir>\n`);
  process.exit(2);
}
const outDir = cliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { rows, peers, early } = buildBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: refusing to write an invalid board: ${issue}\n`);
  process.exit(1);
}
const live = liveRows(snapshot);

const radarData = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: MODEL_VERSION,
  watchlist_size: snapshot.watchlist.length,
  board_size: rows.length,
  early_size: early,
  live_size: live.length,
  global_peer_multiple: round4(clamp(peers.global, MULT_FLOOR, MULT_CAP)),
  rows,
  live,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(radarData)};\n`);

function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images; 3 are required\n`);
  process.exit(1);
}

// The dossier goes last: the scorer rebuilds it from /output and compares byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar ${MODEL_VERSION}: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} watchlist, ` +
    `${rows.length} ranked (${early} early below the floor), ${live.length} already-trading shown apart\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length}) and dossier.json to ${outDir}\n`,
);
