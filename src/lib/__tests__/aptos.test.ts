/**
 * T4-12 — Vitest unit tests for src/lib/aptos.ts
 *
 * Hermetic — no network, no chain calls. We stub env + fetch as needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Preserve real env so each test can mutate freely.
const ENV_KEYS = [
  "BASEMENT_MODULE_ADDRESS",
  "VIRTUAL_USD_METADATA_ADDRESS",
  "ADMIN_ADDRESS",
  "PYTH_HERMES_URL",
  "PYTH_BTC_FEED_ID",
  "PYTH_ETH_FEED_ID",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // readCaseState now wraps a module-global TTL cache; clear between tests so
  // a fakeClient mock from one test doesn't leak its return shape to another.
  const cacheMod = await import("../aptos-cache");
  cacheMod._clearCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function setEnvHappy() {
  process.env.BASEMENT_MODULE_ADDRESS = "0xabc1";
  process.env.VIRTUAL_USD_METADATA_ADDRESS = "0xbeef";
  process.env.ADMIN_ADDRESS = "0xadm1";
  process.env.PYTH_HERMES_URL = "https://hermes.pyth.network";
  process.env.PYTH_BTC_FEED_ID = "0xfeedbeef";
  process.env.PYTH_ETH_FEED_ID = "0xcafebabe";
}

describe("import is side-effect-free", () => {
  it("can be imported with stub env without throwing", async () => {
    // Simulate the .env.example stub values — lazy validation means import OK.
    process.env.BASEMENT_MODULE_ADDRESS = "0x_STUB_REPLACE_IN_SESSION_B";
    process.env.VIRTUAL_USD_METADATA_ADDRESS = "0x_STUB_REPLACE_IN_SESSION_B";
    process.env.ADMIN_ADDRESS = "0x_STUB_REPLACE_IN_SESSION_B";
    await expect(import("../aptos")).resolves.toBeDefined();
  });
});

describe("env-missing builders throw with helpful messages", () => {
  it("throws naming BASEMENT_MODULE_ADDRESS when unset", async () => {
    delete process.env.BASEMENT_MODULE_ADDRESS;
    const mod = await import("../aptos");
    expect(() => mod.buildClaimWinningsTxn(1n)).toThrow(
      /BASEMENT_MODULE_ADDRESS/,
    );
  });

  it("throws naming VIRTUAL_USD_METADATA_ADDRESS when unset", async () => {
    setEnvHappy();
    delete process.env.VIRTUAL_USD_METADATA_ADDRESS;
    const mod = await import("../aptos");
    expect(() => mod.virtualUsdMetadataAddress()).toThrow(
      /VIRTUAL_USD_METADATA_ADDRESS/,
    );
  });

  it("throws when BASEMENT_MODULE_ADDRESS is still the stub sentinel", async () => {
    setEnvHappy();
    process.env.BASEMENT_MODULE_ADDRESS = "0x_STUB_REPLACE_IN_SESSION_B";
    const mod = await import("../aptos");
    expect(() => mod.buildClaimWinningsTxn(1n)).toThrow(/still a stub/);
  });
});

describe("user tx builders — payload shape", () => {
  it("buildBuyYesTxn produces correct InputTransactionData", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildBuyYesTxn(42n, 100n, 95n);
    expect(txn.data.function).toBe("0xabc1::case_vault::buy_yes");
    expect(txn.data.typeArguments).toEqual([]);
    expect(txn.data.functionArguments).toEqual(["42", "100", "95"]);
  });

  it("buildBuyNoTxn routes to buy_no", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildBuyNoTxn(1n, 10n, 9n);
    expect(txn.data.function).toBe("0xabc1::case_vault::buy_no");
  });

  it("buildSellYesTxn / buildSellNoTxn use sharesIn + minOut", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const sellYes = mod.buildSellYesTxn(7n, 50n, 40n);
    expect(sellYes.data.function).toBe("0xabc1::case_vault::sell_yes");
    expect(sellYes.data.functionArguments).toEqual(["7", "50", "40"]);

    const sellNo = mod.buildSellNoTxn(7n, 50n, 40n);
    expect(sellNo.data.function).toBe("0xabc1::case_vault::sell_no");
  });

  it("buildClaimWinningsTxn has caseId only", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildClaimWinningsTxn(123n);
    expect(txn.data.function).toBe("0xabc1::case_vault::claim_winnings");
    expect(txn.data.functionArguments).toEqual(["123"]);
  });

  it("buildClaimFaucetTxn targets virtual_usd::claim_faucet with no args", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildClaimFaucetTxn();
    expect(txn.data.function).toBe("0xabc1::virtual_usd::claim_faucet");
    expect(txn.data.functionArguments).toEqual([]);
  });
});

describe("buildSponsoredTxn — allowlist + fee-payer flag", () => {
  it("accepts claim_faucet and sets withFeePayer:true", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const inner = mod.buildClaimFaucetTxn();
    const sponsored = mod.buildSponsoredTxn({ sender: "0xuser", inner });
    expect(sponsored.withFeePayer).toBe(true);
    expect(sponsored.sender).toBe("0xuser");
    expect(sponsored.data.function).toBe("0xabc1::virtual_usd::claim_faucet");
    expect(sponsored.options.expireTimestamp).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("accepts claim_winnings (second allowlisted inner entry)", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const inner = mod.buildClaimWinningsTxn(9n);
    const sponsored = mod.buildSponsoredTxn({ sender: "0xuser", inner });
    expect(sponsored.withFeePayer).toBe(true);
  });

  it("throws for inner entry NOT on allowlist (buy_yes)", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const inner = mod.buildBuyYesTxn(1n, 10n, 9n);
    expect(() => mod.buildSponsoredTxn({ sender: "0xuser", inner })).toThrow(
      /SPONSORED_INNER_ENTRY_ALLOWLIST/,
    );
  });

  it("isInnerEntryAllowed normalizes module address prefix", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    expect(
      mod.isInnerEntryAllowed("0xdeadbeef::virtual_usd::claim_faucet"),
    ).toBe(true);
    expect(
      mod.isInnerEntryAllowed("0xdeadbeef::case_vault::buy_yes"),
    ).toBe(false);
  });
});

describe("getPythVAA — mocked fetch", () => {
  it("returns Uint8Array from v2/updates accumulator response", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const b64 = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ binary: { encoding: "base64", data: [b64] }, parsed: [] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await mod.getPythVAA(
      "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toMatch(/\/v2\/updates\/price\/latest\?ids\[\]=e62d/);
  });

  it("handles { binary: { data: [b64] } } envelope shape", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const b64 = Buffer.from([9, 9]).toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ binary: { data: [b64] } }), {
          status: 200,
        }),
      ),
    );
    const bytes = await mod.getPythVAA("abcd");
    expect(Array.from(bytes)).toEqual([9, 9]);
  });

  it("throws on non-2xx response", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("err", { status: 500 })),
    );
    await expect(mod.getPythVAA("0xffff")).rejects.toThrow(/Hermes fetch failed/);
  });
});

describe("parseCaseVaultResource — fixture", () => {
  it("parses a recorded CaseVault resource into typed CaseState", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    // Recorded fixture — mirrors what aptos.getAccountResource returns for
    // `${BASEMENT}::case_vault::CaseVault` on testnet.
    const fixture = {
      type: "0xabc1::case_vault::CaseVault",
      data: {
        yes_reserve: "1000000",
        no_reserve: "2000000",
        state: 1,
        resolved_outcome: 0,
        admin_addr: "0xadm1",
        close_time: "1776787175",
        fee_bps: 30,
        strike_price: "7500000000000",
        market_type: 1,
        threshold_type: 0,
        max_trade_bps: 500,
        max_staleness_sec: 60,
        asset_pyth_feed_id:
          "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        yes_metadata: { inner: "0xaaaa" },
        no_metadata: { inner: "0xbbbb" },
      },
    };
    const parsed = mod.parseCaseVaultResource(42n, "0xvault", fixture);
    expect(parsed.caseId).toBe(42n);
    expect(parsed.vaultAddress).toBe("0xvault");
    expect(parsed.yesReserve).toBe(1000000n);
    expect(parsed.noReserve).toBe(2000000n);
    expect(parsed.state).toBe(1);
    expect(parsed.resolvedOutcome).toBe(0);
    expect(parsed.adminAddr).toBe("0xadm1");
    expect(parsed.closeTime).toBe(1776787175n);
    expect(parsed.feeBps).toBe(30);
    expect(parsed.strikePrice).toBe(7500000000000n);
    expect(parsed.marketType).toBe(1);
    expect(parsed.thresholdType).toBe(0);
    expect(parsed.maxTradeBps).toBe(500);
    expect(parsed.maxStalenessSec).toBe(60);
    expect(parsed.assetPythFeedId).toMatch(/^0xe62df/);
    expect(parsed.yesMetadata).toBe("0xaaaa");
    expect(parsed.noMetadata).toBe("0xbbbb");
  });
});

describe("admin builders — payload shape (no private key reads)", () => {
  it("buildAdminResolveTxn has caseId + outcome", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildAdminResolveTxn(42n, 1);
    expect(txn.data.function).toBe("0xabc1::case_vault::admin_resolve");
    expect(txn.data.functionArguments).toEqual(["42", 1]);
  });

  it("buildSpawnRecurring3minTxn encodes groupId as UTF-8 bytes and feedId as bytes", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildSpawnRecurring3minTxn(
      "btc-3m",
      "0xdeadbeef",
      1000n,
      5n,
      1_000_000n,
    );
    expect(txn.data.function).toBe(
      "0xabc1::market_factory::spawn_recurring_3min",
    );
    // Arg 0 is groupId as UTF-8 bytes of "btc-3m".
    expect(txn.data.functionArguments[0]).toEqual(
      Array.from(new TextEncoder().encode("btc-3m")),
    );
    // Arg 1 is feedId as hex-decoded bytes.
    expect(txn.data.functionArguments[1]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("buildAdminPauseTxn carries caseId", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const txn = mod.buildAdminPauseTxn(99n);
    expect(txn.data.function).toBe("0xabc1::case_vault::admin_pause");
    expect(txn.data.functionArguments).toEqual(["99"]);
  });

  it("submitAdminTxn throws when APTOS_ADMIN_PRIVATE_KEY is unset", async () => {
    setEnvHappy();
    delete process.env.APTOS_ADMIN_PRIVATE_KEY;
    const mod = await import("../aptos");
    await expect(
      mod.submitAdminTxn({
        data: {
          function: "0xabc1::case_vault::admin_resolve",
          typeArguments: [],
          functionArguments: [],
        },
      }),
    ).rejects.toThrow(/APTOS_ADMIN_PRIVATE_KEY/);
  });
});

describe("simulate helper — result shape", () => {
  it("simulateBuyYes returns {expectedSharesOut, priceImpactBps, gasEstimate}", async () => {
    setEnvHappy();
    // Cache is module-global; clear so prior tests don't leak readCaseState
    // results into this one (the simulate fakeClient differs between tests).
    const cacheMod = await import("../aptos-cache");
    cacheMod._clearCacheForTests();
    const mod = await import("../aptos");
    const caseVaultData = {
      yes_reserve: "1000",
      no_reserve: "1000",
      state: 1,
      resolved_outcome: 0,
      admin_addr: "0xadm1",
      close_time: "0",
      fee_bps: 30,
      strike_price: "0",
      market_type: 0,
      threshold_type: 0,
      max_trade_bps: 0,
      max_staleness_sec: 0,
      asset_pyth_feed_id: "0x00",
    };
    const fakeClient = {
      view: vi.fn().mockResolvedValue(["0xvault"]),
      // readCaseState now uses the plural getAccountResources to fetch both
      // CaseVault + MarketConfig in a single RPC. Provide both shapes.
      getAccountResources: vi.fn().mockResolvedValue([
        { type: `${process.env.BASEMENT_MODULE_ADDRESS}::case_vault::CaseVault`, data: caseVaultData },
        { type: `${process.env.BASEMENT_MODULE_ADDRESS}::case_vault::MarketConfig`, data: caseVaultData },
      ]),
      getAccountResource: vi.fn().mockResolvedValue({
        type: "0xabc1::case_vault::CaseVault",
        data: caseVaultData,
      }),
      transaction: {
        build: { simple: vi.fn().mockResolvedValue({ rawTxn: true }) },
        simulate: {
          simple: vi.fn().mockResolvedValue([{ gas_used: "42" }]),
        },
      },
    } as unknown as import("@aptos-labs/ts-sdk").Aptos;
    const result = await mod.simulateBuyYes(
      "0xuser",
      1n,
      100n,
      fakeClient,
    );
    expect(typeof result.expectedSharesOut).toBe("bigint");
    expect(typeof result.priceImpactBps).toBe("number");
    expect(typeof result.gasEstimate).toBe("bigint");
    expect(result.gasEstimate).toBe(42n);
    // With 1000/1000 reserves and amountIn=100, expectedSharesOut ≈ 1000 - 1000*1000/1100 ≈ 90
    expect(result.expectedSharesOut > 0n).toBe(true);
    expect(result.priceImpactBps).toBeGreaterThan(0);
  });
});

describe("simulateBuy — Move-aligned CPMM math (fee + reserve direction)", () => {
  // Helper to build a fakeClient with given reserves + fee_bps.
  function makeFakeClient(opts: {
    yesReserve: string;
    noReserve: string;
    feeBps: number;
  }) {
    const caseVaultData = {
      yes_reserve: opts.yesReserve,
      no_reserve: opts.noReserve,
      state: 1,
      resolved_outcome: 0,
      admin_addr: "0xadm1",
      close_time: "0",
      fee_bps: opts.feeBps,
      strike_price: "0",
      market_type: 0,
      threshold_type: 0,
      max_trade_bps: 0,
      max_staleness_sec: 0,
      asset_pyth_feed_id: "0x00",
    };
    return {
      view: vi.fn().mockResolvedValue(["0xvault"]),
      // readCaseState now uses the plural getAccountResources for one-shot
      // fetch of CaseVault + MarketConfig.
      getAccountResources: vi.fn().mockResolvedValue([
        { type: `${process.env.BASEMENT_MODULE_ADDRESS}::case_vault::CaseVault`, data: caseVaultData },
        { type: `${process.env.BASEMENT_MODULE_ADDRESS}::case_vault::MarketConfig`, data: caseVaultData },
      ]),
      getAccountResource: vi.fn().mockResolvedValue({
        type: "0xabc1::case_vault::CaseVault",
        data: caseVaultData,
      }),
      transaction: {
        build: { simple: vi.fn().mockResolvedValue({ rawTxn: true }) },
        simulate: {
          simple: vi.fn().mockResolvedValue([{ gas_used: "42" }]),
        },
      },
    } as unknown as import("@aptos-labs/ts-sdk").Aptos;
  }

  it("fee_bps=300, asymmetric yes=1000/no=2000, buy_yes, amountIn=100 → 47", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const fakeClient = makeFakeClient({
      yesReserve: "1000",
      noReserve: "2000",
      feeBps: 300,
    });
    const result = await mod.simulateBuyYes("0xuser", 1n, 100n, fakeClient);
    expect(result.expectedSharesOut).toBe(47n);
  });

  it("fee_bps=300, symmetric flip yes=2000/no=1000, buy_no, amountIn=100 → 47", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const fakeClient = makeFakeClient({
      yesReserve: "2000",
      noReserve: "1000",
      feeBps: 300,
    });
    const result = await mod.simulateBuyNo("0xuser", 1n, 100n, fakeClient);
    expect(result.expectedSharesOut).toBe(47n);
  });

  it("fee_bps=0 control, yes=1000/no=1000, buy_yes, amountIn=100 → 91", async () => {
    setEnvHappy();
    const mod = await import("../aptos");
    const fakeClient = makeFakeClient({
      yesReserve: "1000",
      noReserve: "1000",
      feeBps: 0,
    });
    const result = await mod.simulateBuyYes("0xuser", 1n, 100n, fakeClient);
    expect(result.expectedSharesOut).toBe(91n);
  });
});

describe("hex + bigint helpers", () => {
  it("toHex / fromHex round-trip", async () => {
    const mod = await import("../aptos");
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    const hex = mod.toHex(bytes);
    expect(hex).toBe("0x00010f10ff");
    expect(Array.from(mod.fromHex(hex))).toEqual(Array.from(bytes));
    expect(Array.from(mod.fromHex("00010f10ff"))).toEqual(Array.from(bytes));
  });

  it("toBigInt handles string/number/bigint", async () => {
    const mod = await import("../aptos");
    expect(mod.toBigInt("123")).toBe(123n);
    expect(mod.toBigInt(7)).toBe(7n);
    expect(mod.toBigInt(99n)).toBe(99n);
  });
});
