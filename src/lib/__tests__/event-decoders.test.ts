import { describe, it, expect } from "vitest";

import { decodeEvent } from "@/lib/event-decoders";
import type { GraphqlEventRow, SourceSpec } from "@/lib/vault-indexer";

function makeRaw(
  data: Record<string, unknown>,
  overrides: Partial<GraphqlEventRow> = {},
): GraphqlEventRow {
  return {
    transaction_version: "12345",
    sequence_number: "7",
    indexed_type: "0xabc::case_vault::CaseCreatedEvent",
    type: "0xabc::case_vault::CaseCreatedEvent",
    data,
    ...overrides,
  };
}

const SPEC_CASE_CREATED: SourceSpec = {
  moduleName: "case_vault",
  structName: "CaseCreatedEvent",
  outputTypes: ["case_created"],
};
const SPEC_BOUGHT: SourceSpec = {
  moduleName: "case_vault",
  structName: "BoughtEvent",
  outputTypes: ["bought_yes", "bought_no"],
};
const SPEC_SOLD: SourceSpec = {
  moduleName: "case_vault",
  structName: "SoldEvent",
  outputTypes: ["sold_yes", "sold_no"],
};
const SPEC_CLAIMED: SourceSpec = {
  moduleName: "case_vault",
  structName: "ClaimedEvent",
  outputTypes: ["claimed"],
};
const SPEC_RESOLVED: SourceSpec = {
  moduleName: "case_vault",
  structName: "ResolvedEvent",
  outputTypes: ["resolved"],
};
const SPEC_PAUSED: SourceSpec = {
  moduleName: "case_vault",
  structName: "PausedEvent",
  outputTypes: ["paused"],
};
const SPEC_DRAINED: SourceSpec = {
  moduleName: "case_vault",
  structName: "DrainedEvent",
  outputTypes: ["drained"],
};
const SPEC_LIQ_SEEDED: SourceSpec = {
  moduleName: "case_vault",
  structName: "LiquiditySeededEvent",
  outputTypes: ["liquidity_seeded"],
};
const SPEC_FAUCET: SourceSpec = {
  moduleName: "virtual_usd",
  structName: "FaucetClaimedEvent",
  outputTypes: ["faucet_claimed"],
};
const SPEC_MARKET_CREATED: SourceSpec = {
  moduleName: "market_factory",
  structName: "MarketCreatedEvent",
  outputTypes: ["market_created"],
};

describe("event decoders — happy paths", () => {
  it("CaseCreatedEvent → case_created with caseId + payload", () => {
    const ev = decodeEvent(
      SPEC_CASE_CREATED,
      makeRaw({ case_id: "42", timestamp: "1700000000000000" }),
    );
    expect(ev?.eventType).toBe("case_created");
    expect(ev?.caseId).toBe(42n);
    expect(ev?.txnHash).toBe("12345");
    expect(ev?.eventSeq).toBe(7);
    expect(ev?.payload).toMatchObject({ case_id: "42" });
  });

  it("BoughtEvent with side=0 → bought_yes + reserves", () => {
    const ev = decodeEvent(
      SPEC_BOUGHT,
      makeRaw({
        case_id: "5",
        buyer: "0xABC",
        side: 0,
        amount_in: "1000000",
        shares_out: "950000",
        yes_reserve_after: "9999999",
        no_reserve_after: "1000000",
        timestamp: "1700000000000000",
      }),
    );
    expect(ev?.eventType).toBe("bought_yes");
    expect(ev?.userAddress).toBe("0xabc");
    expect(ev?.amountVirtualUsdRaw).toBe(1_000_000n);
    expect(ev?.sharesRaw).toBe(950_000n);
    expect(ev?.side).toBe(0);
    expect(ev?.yesReserveAfter).toBe(9_999_999n);
  });

  it("BoughtEvent with side=1 → bought_no", () => {
    const ev = decodeEvent(
      SPEC_BOUGHT,
      makeRaw({ case_id: "5", buyer: "0xdef", side: 1, amount_in: "1" }),
    );
    expect(ev?.eventType).toBe("bought_no");
    expect(ev?.side).toBe(1);
  });

  it("SoldEvent with side=0 → sold_yes, seller lowercased", () => {
    const ev = decodeEvent(
      SPEC_SOLD,
      makeRaw({ case_id: "5", seller: "0xCAFE", side: 0, amount_out: "42", shares_in: "100" }),
    );
    expect(ev?.eventType).toBe("sold_yes");
    expect(ev?.userAddress).toBe("0xcafe");
    expect(ev?.amountVirtualUsdRaw).toBe(42n);
    expect(ev?.sharesRaw).toBe(100n);
  });

  it("SoldEvent with side=1 → sold_no", () => {
    const ev = decodeEvent(
      SPEC_SOLD,
      makeRaw({ case_id: "5", seller: "0xbeef", side: 1 }),
    );
    expect(ev?.eventType).toBe("sold_no");
  });

  it("ClaimedEvent happy (outcome=YES) → claimed with payout", () => {
    const ev = decodeEvent(
      SPEC_CLAIMED,
      makeRaw({ case_id: "1", claimer: "0xaa", outcome: 0, payout: "500", shares_burned: "500" }),
    );
    expect(ev?.eventType).toBe("claimed");
    expect(ev?.outcome).toBe(0);
    expect(ev?.userAddress).toBe("0xaa");
    expect(ev?.amountVirtualUsdRaw).toBe(500n);
  });

  it("ClaimedEvent with INVALID outcome (pro-rata) → claimed, outcome=2", () => {
    const ev = decodeEvent(
      SPEC_CLAIMED,
      makeRaw({ case_id: "1", claimer: "0xbb", outcome: 2, payout: "100" }),
    );
    expect(ev?.outcome).toBe(2);
  });

  it("ResolvedEvent → resolved with outcome + resolver", () => {
    const ev = decodeEvent(
      SPEC_RESOLVED,
      makeRaw({ case_id: "3", outcome: 1, resolver: "0x99", oracle_price: "65000" }),
    );
    expect(ev?.eventType).toBe("resolved");
    expect(ev?.outcome).toBe(1);
    expect(ev?.userAddress).toBe("0x99");
    expect(ev?.payload).toMatchObject({ oracle_price: "65000" });
  });

  it("PausedEvent → paused with admin", () => {
    const ev = decodeEvent(SPEC_PAUSED, makeRaw({ case_id: "4", admin: "0xAD" }));
    expect(ev?.eventType).toBe("paused");
    expect(ev?.userAddress).toBe("0xad");
  });

  it("DrainedEvent → drained with destination + amount", () => {
    const ev = decodeEvent(
      SPEC_DRAINED,
      makeRaw({ case_id: "5", destination: "0xD1", amount: "999" }),
    );
    expect(ev?.eventType).toBe("drained");
    expect(ev?.userAddress).toBe("0xd1");
    expect(ev?.amountVirtualUsdRaw).toBe(999n);
  });

  it("LiquiditySeededEvent → liquidity_seeded with reserves", () => {
    const ev = decodeEvent(
      SPEC_LIQ_SEEDED,
      makeRaw({ case_id: "1", amount: "500000000", yes_reserve_after: "500000000", no_reserve_after: "500000000" }),
    );
    expect(ev?.eventType).toBe("liquidity_seeded");
    expect(ev?.yesReserveAfter).toBe(500_000_000n);
  });

  it("FaucetClaimedEvent → faucet_claimed with user + 50 vUSD raw", () => {
    const ev = decodeEvent(
      SPEC_FAUCET,
      makeRaw({ user: "0x11", amount: "50000000", timestamp: "1700000000" }),
    );
    expect(ev?.eventType).toBe("faucet_claimed");
    expect(ev?.userAddress).toBe("0x11");
    expect(ev?.amountVirtualUsdRaw).toBe(50_000_000n);
  });

  it("MarketCreatedEvent → market_created with caseId", () => {
    const ev = decodeEvent(
      SPEC_MARKET_CREATED,
      makeRaw({ case_id: "7", market_object_address: "0xmkt", created_at: "1700000000" }),
    );
    expect(ev?.eventType).toBe("market_created");
    expect(ev?.caseId).toBe(7n);
  });
});

describe("event decoders — edge cases", () => {
  it("decodeEvent returns null for unknown struct", () => {
    const ev = decodeEvent(
      { moduleName: "case_vault", structName: "FutureUnknownEvent", outputTypes: ["claimed"] },
      makeRaw({}),
    );
    expect(ev).toBeNull();
  });

  it("missing timestamp falls back to transaction_version as pseudo-time", () => {
    const ev = decodeEvent(
      SPEC_CASE_CREATED,
      makeRaw({ case_id: "1" }, { transaction_version: "500" }),
    );
    expect(ev?.blockTime).toBeInstanceOf(Date);
  });

  it("microsecond timestamp (16 digits) converts to ms", () => {
    const ev = decodeEvent(SPEC_CASE_CREATED, makeRaw({ case_id: "1", timestamp: "1700000000000000" }));
    // 1700000000000000 us / 1000 = 1700000000000 ms = 2023-11-14T22:13:20Z
    expect(ev?.blockTime.getUTCFullYear()).toBe(2023);
  });

  it("second timestamp (10 digits) converts to ms", () => {
    const ev = decodeEvent(SPEC_FAUCET, makeRaw({ user: "0x1", amount: "50000000", timestamp: "1700000000" }));
    expect(ev?.blockTime.getUTCFullYear()).toBe(2023);
  });

  it("user address with mixed case is normalized to lowercase", () => {
    const ev = decodeEvent(SPEC_BOUGHT, makeRaw({ buyer: "0xABCDef123456", side: 0 }));
    expect(ev?.userAddress).toBe("0xabcdef123456");
  });

  it("event_seq parsed from sequence_number string", () => {
    const ev = decodeEvent(
      SPEC_CASE_CREATED,
      makeRaw({ case_id: "1" }, { sequence_number: "42" }),
    );
    expect(ev?.eventSeq).toBe(42);
  });

  it("payload preserves raw data object verbatim", () => {
    const rawData = { case_id: "1", foo: "bar", nested: { k: "v" } };
    const ev = decodeEvent(SPEC_CASE_CREATED, makeRaw(rawData));
    expect(ev?.payload).toEqual(rawData);
  });

  it("null data fields decode to null without throwing", () => {
    const ev = decodeEvent(SPEC_CLAIMED, makeRaw({ case_id: "1" }));
    expect(ev?.userAddress).toBeNull();
    expect(ev?.amountVirtualUsdRaw).toBeNull();
  });
});
