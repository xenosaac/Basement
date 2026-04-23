# Basement

**Non-custodial prediction markets on Aptos.**
Your keys. Your positions. Your gas.

---

## What it is

A prediction market where every action is a signed, on-chain transaction. No custodial balance. No internal matching engine. No admin-held user funds. Connect an Aptos wallet, sign, trade.

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
