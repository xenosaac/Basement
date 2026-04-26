import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { lookupTick, type PythPriceTick } from "../pyth-hermes";
import { pythNvdaFeedId } from "../aptos";

const sample: PythPriceTick = {
  feedId: "f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
  priceE8: 1234567890n,
  conf: 100n,
  expo: -8,
  publishTimeSec: 1777160000,
};

const map = new Map<string, PythPriceTick>([[sample.feedId, sample]]);

describe("lookupTick", () => {
  it("hits when feedId has 0x prefix", () => {
    expect(lookupTick(map, `0x${sample.feedId}`)).toBe(sample);
  });

  it("hits when feedId has no prefix", () => {
    expect(lookupTick(map, sample.feedId)).toBe(sample);
  });

  it("hits with mixed/upper case", () => {
    expect(lookupTick(map, `0X${sample.feedId.toUpperCase()}`)).toBe(sample);
    expect(lookupTick(map, sample.feedId.toUpperCase())).toBe(sample);
  });

  it("misses for unknown feedId", () => {
    expect(lookupTick(map, "0xdeadbeef")).toBeUndefined();
  });
});

describe("pythNvdaFeedId", () => {
  const NVDA_BETA_FEED_ID =
    "0x16e38262485de554be6a09b0c1d4d86eb2151a7af265f867d769dee359cec32e";
  const prevServer = process.env.PYTH_NVDA_FEED_ID;
  const prevPublic = process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID;

  beforeEach(() => {
    delete process.env.PYTH_NVDA_FEED_ID;
    delete process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID;
  });

  afterEach(() => {
    if (prevServer === undefined) delete process.env.PYTH_NVDA_FEED_ID;
    else process.env.PYTH_NVDA_FEED_ID = prevServer;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID;
    else process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID = prevPublic;
  });

  it("returns the server-side env var when set", () => {
    process.env.PYTH_NVDA_FEED_ID = NVDA_BETA_FEED_ID;
    expect(pythNvdaFeedId()).toBe(NVDA_BETA_FEED_ID);
  });

  it("falls back to the NEXT_PUBLIC mirror when server-side is unset", () => {
    process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID = NVDA_BETA_FEED_ID;
    expect(pythNvdaFeedId()).toBe(NVDA_BETA_FEED_ID);
  });

  it("throws when both env vars are unset", () => {
    expect(() => pythNvdaFeedId()).toThrow(/PYTH_NVDA_FEED_ID/);
  });
});
