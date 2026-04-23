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
