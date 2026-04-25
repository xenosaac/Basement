#!/usr/bin/env tsx
// One-shot indexer backfill. Runs runIndexerPass in a loop until a pass
// returns 0 new events. Useful after a fresh `db:push` or after changing
// cursor state. Respects `APTOS_INDEXER_URL` from .env.

import "dotenv/config";

import { runIndexerPass } from "../src/lib/vault-indexer";

async function main(): Promise<void> {
  let round = 0;
  while (true) {
    round++;
    const start = Date.now();
    const result = await runIndexerPass({
      batchSize: 500,
      softTimeoutMs: 120_000,
    });
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[round ${round}] events=${result.eventsProcessed}  errors=${result.errors.length}  timeout=${result.timeout}  ${elapsedSec}s`,
    );
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.warn(`  [${e.stage}] ${e.message}`);
      }
    }
    if (result.eventsProcessed === 0 && !result.timeout) {
      console.log("backfill caught up.");
      break;
    }
    if (round > 200) {
      console.warn("backfill aborted: exceeded 200 rounds");
      break;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
