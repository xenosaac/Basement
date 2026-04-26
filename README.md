# Basement

**Prediction market built on Aptos.**

Markets price binary outcomes on Paradigm's pm-AMM curve. Trades settle in VirtualUSD against on-chain Pyth feeds; positions can be sold back to the curve at any point before resolve. The market catalog is registry-driven — assets, cadences, and strike kinds all live in `src/lib/market-groups.ts`.

---

## Markets

Recurring breakout/breakdown markets dynamically pick a strike at round-open such that YES has ~30% historical probability (vol-derived; see `src/lib/quant/barrier-strike.ts`).

| Tab | Assets | Cadence |
|---|---|---|
| Crypto | BTC, ETH, SOL, HYPE, MATIC, APT | rolling 3-min / 15-min / hourly |
| Commodity | XAU, XAG, XPT, Brent | hourly / daily |
| Stocks | NASDAQ100 (QQQ ETF) + NVIDIA (NVDA), NYSE RTH only | daily |
| Others | EUR/USD, USD/JPY, USD/CNH | hourly (FX 24/5) |
| Macro | CPI, Core PCE, Unemployment, GDP | per scheduled release |

Quick Play at the top of the page is reserved for the BTC/ETH 3-minute rounds. Longer cadences appear in their category tab.

---

## How to run

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run db:seed
npm run dev                  # → http://localhost:3000
```

Connect a supported Aptos wallet, switch to the configured network, sign in. Faucet a starting VirtualUSD balance from the in-app banner.

---

## Oracle / Pyth setup

Price resolution runs on-chain via `basement::oracle::update_price_feeds` + `case_vault::resolve_oracle`. `PYTH_HERMES_URL` + `PYTH_*_FEED_ID` must match the deployment chain's Pyth / Wormhole channel:

| Chain | Hermes | Feed channel |
|---|---|---|
| Aptos **testnet** | `https://hermes-beta.pyth.network` | beta (signed by Wormhole `guardian_set[0]`) |
| Aptos **mainnet** | `https://hermes.pyth.network` | stable (signed by Wormhole `guardian_set[5]`) |

Submitting stable-channel VAAs to Aptos testnet aborts with `0x1::table 0x6507` because testnet Wormhole only has `guardian_set[0]` deployed. That's a channel mismatch, not a protocol bug.

`ORACLE_RESOLVE_MODE` picks the resolve strategy:
- `oracle` — production path. The Move module verifies the Pyth VAA, reads the price, and writes the outcome.
- `admin` — escape hatch. Backend reads Hermes off-chain and submits `admin_resolve(case_id, outcome)`. Admin still cannot move funds; only the outcome bit is trusted.

---

## Wallets & faucet

VirtualUSD is a self-issued FA on Aptos testnet. `/api/faucet` supports two paths:

- **Petra** — fully sponsored. Admin pays gas via AIP-62 fee-payer authenticator; zero-APT user experience.
- **OKX / Bitget / Nightly / Backpack** — direct claim. User pays their own testnet gas (~0.0001 APT). These wallets don't reliably honor the fee-payer authenticator; the UI also detects network mismatch and offers a one-click switch to Aptos Testnet.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run db:push` | Apply schema |
| `npm run db:seed` | Seed markets |
| `npx vitest run` | Test suite |

---

## License

Business Source License 1.1 — see [LICENSE](./LICENSE).
