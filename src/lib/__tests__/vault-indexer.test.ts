import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  runIndexerPass,
  type IndexerDbOps,
  type RestTransaction,
} from "@/lib/vault-indexer";
import type { NewVaultEvent } from "@/db/schema";

const ORIGINAL_ENV = { ...process.env };
function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v;
}

function setEnvHappy() {
  process.env.BASEMENT_MODULE_ADDRESS = "0xbase";
  process.env.VIRTUAL_USD_METADATA_ADDRESS = "0xvusd";
  process.env.ADMIN_ADDRESS = "0xadm";
  process.env.PYTH_BTC_FEED_ID = "0xbtc";
  process.env.PYTH_ETH_FEED_ID = "0xeth";
  process.env.APTOS_FULLNODE_URL = "http://test-fullnode/v1";
}

function makeTxn(
  version: string,
  events: Array<{ type: string; data: Record<string, unknown>; seq?: string }>,
): RestTransaction {
  return {
    version,
    type: "user_transaction",
    hash: `0x${version.padStart(8, "0")}`,
    timestamp: "1700000000000000",
    events: events.map((e, i) => ({
      type: e.type,
      sequence_number: e.seq ?? String(i),
      data: e.data,
    })),
  };
}

function makeMockDb(initialCursor = 0n): {
  ops: IndexerDbOps;
  events: NewVaultEvent[];
  lastCursor: { value: bigint };
} {
  const events: NewVaultEvent[] = [];
  const lastCursor = { value: initialCursor };
  const ops: IndexerDbOps = {
    async listCursors() {
      return [
        { eventType: "case_created", lastProcessedSequence: lastCursor.value },
        { eventType: "bought_yes", lastProcessedSequence: lastCursor.value },
        { eventType: "bought_no", lastProcessedSequence: lastCursor.value },
        { eventType: "sold_yes", lastProcessedSequence: lastCursor.value },
        { eventType: "sold_no", lastProcessedSequence: lastCursor.value },
        { eventType: "claimed", lastProcessedSequence: lastCursor.value },
        { eventType: "resolved", lastProcessedSequence: lastCursor.value },
        { eventType: "paused", lastProcessedSequence: lastCursor.value },
        { eventType: "drained", lastProcessedSequence: lastCursor.value },
        { eventType: "liquidity_seeded", lastProcessedSequence: lastCursor.value },
        { eventType: "faucet_claimed", lastProcessedSequence: lastCursor.value },
        { eventType: "market_created", lastProcessedSequence: lastCursor.value },
      ];
    },
    async upsertEvents(rows) {
      events.push(...rows);
      return rows.length;
    },
    async updateAllCursors(newVersion) {
      lastCursor.value = newVersion;
    },
  };
  return { ops, events, lastCursor };
}

describe("runIndexerPass", () => {
  beforeEach(() => {
    restoreEnv();
    setEnvHappy();
  });
  afterEach(restoreEnv);

  it("happy path: filters our module events, decodes BoughtEvent + skips 0x1 framework events", async () => {
    const { ops, events, lastCursor } = makeMockDb(0n);
    const result = await runIndexerPass({
      batchSize: 100,
      softTimeoutMs: 5000,
      dbOverride: ops,
      fetchTransactions: async (addr, start) => {
        expect(addr).toBe("0xbase");
        expect(start).toBe(1n);
        return [
          makeTxn("100", [
            // Our event — should be decoded.
            { type: "0xbase::case_vault::BoughtEvent", data: { case_id: "5", buyer: "0xAA", side: 0, amount_in: "100", shares_out: "95" } },
            // Framework event — should be skipped.
            { type: "0x1::fungible_asset::Deposit", data: { amount: "1" } },
          ]),
          makeTxn("101", [
            { type: "0xbase::virtual_usd::FaucetClaimedEvent", data: { user: "0xBB", amount: "50000000" } },
          ]),
        ];
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.eventsProcessed).toBe(2);
    expect(result.txnsScanned).toBe(2);
    expect(result.cursorAdvancedTo).toBe("101");
    expect(events.map((e) => e.eventType).sort()).toEqual(["bought_yes", "faucet_claimed"]);
    expect(lastCursor.value).toBe(101n);
  });

  it("empty fetch: no events, cursor unchanged, no errors", async () => {
    const { ops, events, lastCursor } = makeMockDb(500n);
    const result = await runIndexerPass({
      batchSize: 100,
      softTimeoutMs: 5000,
      dbOverride: ops,
      fetchTransactions: async () => [],
    });
    expect(result.eventsProcessed).toBe(0);
    expect(result.txnsScanned).toBe(0);
    expect(result.cursorAdvancedTo).toBeNull();
    expect(events.length).toBe(0);
    expect(lastCursor.value).toBe(500n); // unchanged
  });

  it("fetch failure: surfaces error and bails the pass without advancing cursor", async () => {
    const { ops, lastCursor } = makeMockDb(10n);
    const result = await runIndexerPass({
      batchSize: 100,
      softTimeoutMs: 5000,
      dbOverride: ops,
      fetchTransactions: async () => {
        throw new Error("network down");
      },
    });
    expect(result.errors[0].stage).toBe("fetchTransactions");
    expect(result.errors[0].message).toMatch(/network down/);
    expect(lastCursor.value).toBe(10n); // unchanged
  });

  it("soft timeout: sets timeout flag when batch loop exceeds budget", async () => {
    const { ops } = makeMockDb(0n);
    let callCount = 0;
    const result = await runIndexerPass({
      batchSize: 2,
      softTimeoutMs: 10, // immediate
      dbOverride: ops,
      fetchTransactions: async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 15));
        return [
          makeTxn(String(200 + callCount), [
            { type: "0xbase::case_vault::CaseCreatedEvent", data: { case_id: String(callCount) } },
          ]),
          makeTxn(String(300 + callCount), [
            { type: "0xbase::case_vault::CaseCreatedEvent", data: { case_id: String(callCount + 100) } },
          ]),
        ];
      },
    });
    expect(result.timeout).toBe(true);
  });
});
