#!/usr/bin/env tsx
// One-shot: clear leftover `active_by_group` table entries on the Move
// module. Safe to re-run — `clear_active_group` is a no-op when the key
// is absent. Usage: `npx tsx scripts/clear-zombies.ts [groupId ...]`.
// Defaults to the v0 recurring pair.

import "dotenv/config";

import { buildClearActiveGroupTxn, submitAdminTxn } from "../src/lib/aptos";

const DEFAULT_GROUPS = ["btc-3m", "eth-3m"];

async function main(): Promise<void> {
  const groups = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_GROUPS;

  for (const g of groups) {
    try {
      const { txnHash, success } = await submitAdminTxn(
        buildClearActiveGroupTxn(g),
      );
      console.log(`cleared ${g}: ${txnHash} (success=${success})`);
    } catch (err) {
      console.error(`${g} failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
