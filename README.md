# Basement

**Prediction markets on Aptos · v0 custodial DB-AMM demo.**
Faucet vUSD · curve-priced YES/NO shares · sell anytime before resolve. v1 roadmap: switch to on-chain CaseVault CPMM (wallet-signed, non-custodial).

---

## What it is

A prediction market where 3-min BTC/ETH rounds (and longer cadences) price YES/NO shares on a **Paradigm pm-AMM** curve (`(y−x)·Φ((y−x)/L) + L·φ((y−x)/L) − y = 0`). Buys move the curve; sells let you exit before resolve and pocket the slippage. v0 keeps balances + reserves in Postgres against a faucet-issued vUSD ledger so the demo works without per-trade wallet signing — the on-chain CaseVault CPMM (`move/basement/sources/case_vault.move`) ships unchanged and is the v1 migration target.

## Architecture (v0 vs v1)

| | **v0 (current — hackathon demo)** | **v1 (roadmap)** |
|---|---|---|
| Custody | DB ledger (`user_balances_v3`) — custodial | On-chain CaseVault — non-custodial |
| Pricing | Paradigm pm-AMM in `src/lib/pm-amm.ts`, state in `cases_v3.{up,down}_shares_e8` | Same curve on-chain via `case_vault.move` CPMM |
| Trade tx | POST `/api/bet`, `/api/sell` (server-signed) | Wallet-signed `buy_yes` / `sell_yes` entry fun |
| Positions | `positions_v3` rows | On-chain FA balances (YES / NO) |
| Resolve | Pyth on-chain → `/api/cron/tick` mark-to-share | Pyth on-chain → `case_vault::resolve_oracle` |
| Identity | Aptos wallet sign-in (auth only) | Same |

**Why custodial in v0:** the on-chain CaseVault per-market state-slot deposit is ~0.04 APT/market × ~1080 markets/day at full cadence = 20–43 APT/day ($170-340) running cost. v0 ships in days; v1 batches markets into a single Resource (`Table<u64, Case>`) to bring this under $5/day, then re-enables wallet-signed trades.

## How to run

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run db:seed
npm run dev                  # → http://localhost:3000
```

Connect a supported Aptos wallet, switch to the configured network, sign in.

## Markets (categories)

The `/markets` page is organized into five tabs, driven by
`src/lib/market-groups.ts`:

| Tab | Assets | Cadence |
|---|---|---|
| **All** | union of everything live | — |
| **Crypto** | BTC, ETH (3-min rolling Quick Play) | `on-resolve`, 180 s |
| **Commodity** | XAU / gold (daily directional) | `on-resolve`, 86 400 s |
| **Stocks** | — | Coming Soon |
| **Others** | — | Coming Soon |

The **Quick Play** strip at the top of the page is reserved for the
BTC/ETH 3-minute rounds. Longer cadences (XAU 24-hour, future daily or
weekly markets) appear only in their category tab. Category, sort
order, and gate logic are all registry-driven — adding a new market is
appending a `MARKET_GROUPS` entry.

## Oracle path

Price resolution runs fully on-chain via
`basement::oracle::update_price_feeds` + `case_vault::resolve_oracle`.
Nothing is pre-computed off-chain; the admin signer is only a sender +
gas payer for scheduled cron calls, and the Move module enforces that
admin **cannot move user funds**.

`PYTH_HERMES_URL` + `PYTH_*_FEED_ID` must match the deployment chain's
Pyth / Wormhole channel:

| Chain | Hermes | Feed IDs |
|---|---|---|
| Aptos **testnet** | `https://hermes-beta.pyth.network` | beta (signed by Wormhole `guardian_set[0]`) |
| Aptos **mainnet** | `https://hermes.pyth.network` | stable (signed by Wormhole `guardian_set[5]`) |

Submitting stable-channel VAAs to Aptos testnet Wormhole aborts with
`0x1::table 0x6507` because testnet Wormhole only has `guardian_set[0]`
deployed. If you hit that abort, it is a channel mismatch, not a
protocol bug — re-read the table above. See the live
`.env.example` for the full set of values + mainnet alternates.

`ORACLE_RESOLVE_MODE` picks the resolve strategy:

- **`oracle`** — production path. Cron submits a Pyth VAA, the Move
  module verifies + reads + writes outcome.
- **`admin`** — emergency escape hatch. Backend reads stable Hermes
  off-chain, computes outcome, submits `admin_resolve(case_id, outcome)`.
  Admin still cannot move funds; only the outcome bit is trusted.

## Wallets & Faucet

VirtualUSD is a self-issued FA on Aptos testnet. The `/api/faucet`
route supports two paths depending on wallet capability:

- **Petra** — fully sponsored: admin pays gas via AIP-62 fee-payer
  authenticator. Zero-APT user experience.
- **OKX / Bitget / Nightly / Backpack** — direct claim. User pays
  their own testnet gas (~0.0001 APT). These wallets do not reliably
  honor the fee-payer authenticator; the UI also detects wallet
  network mismatch and offers a one-click switch to Aptos Testnet.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run db:push` | Apply schema |
| `npm run db:seed` | Seed markets |

## License

Business Source License 1.1 — see [LICENSE](./LICENSE).
