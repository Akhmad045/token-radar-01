# Token Radar — pre-token protocols ranked by implied value

![model](https://img.shields.io/badge/model-radar--2-2dd4bf)
![board](https://img.shields.io/badge/board-200%20rows-2dd4bf)
![watchlist](https://img.shields.io/badge/watchlist-40%2F40%20covered-f5b942)
![node](https://img.shields.io/badge/node-22%20stdlib%20only-339933)
![license](https://img.shields.io/badge/license-MIT-blue)

A token launch radar for the make.fun `token-radar-01` bounty. It reads a sealed,
frozen DefiLlama snapshot (758 protocols, 2026-11-14), finds the protocols that
record no token, and ranks 200 of them by an **implied value** the program
computes itself — then hands in a static dashboard with the board, a detail view
for every protocol, filters, a live model sandbox, and a farm plan for each row.

## The model (radar-2)

Implied value follows only from the snapshot's own figures — TVL, seven-day
growth, age with no token, and chain breadth. No protocol name is special-cased.

```
implied = round( tvl_usd × multiple × growthMul × maturity × breadth )

multiple  = clamp(0.30 × (100,000,000 / tvl_usd)^0.12, 0.08, 0.45)
            — a token's plausible value is a multiple of TVL, and the multiple
              falls as a protocol grows: a $50M protocol can trade at a third
              of its TVL, a $2.7B one cannot keep that multiple.
growthMul = 1 + clamp(change_7d, −50, +150) / 100 × 0.6
            — the snapshot's fastest week is +4,448%; clamped, growth can lift
              a row, never make it.
maturity  = 0.45 + 0.55 × (1 − e^(−age_days / 365))
            — age is the time since DefiLlama first listed the protocol, the
              best record of how long it has run with no token. It saturates:
              a year with no token is nearly as seasoned as three.
breadth   = 1 + 0.03 × min(chains − 1, 9)
            — a protocol counted on more chains has more places a launch can land.
```

The board covers all **40 watchlist** protocols (TVL ≥ $50M, no token on record)
plus **160 early finds** below the floor, chosen by TVL. Protocols whose token
already trades are set aside in a separate Live view with their market caps —
the board never ranks a launch that already happened.

## Farm plans

Every row carries a seven-step plan derived from the protocol's own record
(category, main chain, TVL, age): a main action and a second qualifying action
specific to its category, a weekly cadence, a hold window (30–90 days by age),
and a cost and time on every step. Gas follows the main chain — Ethereum costs
real money, Solana almost nothing. The detail view totals the plan's cost.

## The dashboard

- **Board** — sortable by rank, name, TVL, 7-day growth, age and implied value;
  search, category and chain filters, watchlist-only toggle.
- **Detail view** — click any row: the model factor by factor (with a recompute
  check against `board.json`), the seven-step farm plan, and the plan's all-in cost.
- **Model sandbox** — two sliders re-rank the whole board live from the same
  formula, so a reader can test the model instead of taking it on trust.
- **Category bars** — where the implied value sits, by category.
- **Live token view** — the protocols that already trade, kept apart.

The page renders with no network: `data.js` beside it holds the whole dataset,
and the page recomputes every row from the snapshot figures.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The program runs twice byte-identical: no
timestamps, no randomness, fixed sort orders everywhere.

## Layout

```
main.ts                 entry point: snapshot in, board.json + data.js + dashboard + screenshots + dossier.json out
lib/model.ts            the radar-2 model, farm plans, snapshot parsing, board validation
vendor/makefun-board.ts the kit's dossier library, unchanged
dashboard/              index.html + app.css + app.js (static, no network)
screenshots/            1-board.jpg, 2-detail.jpg, 3-filtered.jpg (real browser renders, 1440×900)
```

## Honesty notes

- "No token" means **records no token** in DefiLlama's data — not proof it has
  none. Wrapped, staked and bridged products of tokens that already trade are
  off the watchlist by the same rule.
- Implied value is this entry's own claim: what a token would be worth if the
  protocol's record stayed as it is. It does not predict whether or when a
  token is issued, and it is not a price or financial advice.
