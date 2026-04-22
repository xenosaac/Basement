import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  adminAllowedAddresses,
  isAdminAddress,
  withAdminAuth,
} from "@/lib/admin-auth";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v;
}

describe("admin-auth helpers", () => {
  beforeEach(restoreEnv);
  afterEach(restoreEnv);

  it("adminAllowedAddresses parses comma-separated env and lowercases", () => {
    process.env.ADMIN_ALLOWED_ADDRESSES = "0xAA,  0xBB  , , 0xCc";
    expect(adminAllowedAddresses()).toEqual(["0xaa", "0xbb", "0xcc"]);
  });

  it("adminAllowedAddresses returns [] when env missing", () => {
    delete process.env.ADMIN_ALLOWED_ADDRESSES;
    expect(adminAllowedAddresses()).toEqual([]);
  });

  it("isAdminAddress matches case-insensitively", () => {
    process.env.ADMIN_ALLOWED_ADDRESSES = "0xdeadbeef";
    expect(isAdminAddress("0xDEADBEEF")).toBe(true);
    expect(isAdminAddress("0xcafe")).toBe(false);
    expect(isAdminAddress(null)).toBe(false);
    expect(isAdminAddress(undefined)).toBe(false);
  });
});

describe("withAdminAuth", () => {
  beforeEach(restoreEnv);
  afterEach(restoreEnv);

  it("returns 401 when no session cookie is present", async () => {
    const handler = withAdminAuth(async () => new Response("ok"));
    const req = new NextRequest(
      new URL("http://localhost/api/admin/manual-resolve"),
      { method: "POST" },
    );
    const res = await handler(req, {} as never);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Not authenticated/);
  });

  it("returns 403 when session address is not in allowlist", async () => {
    process.env.ADMIN_ALLOWED_ADDRESSES = "0xaaaa";
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-32bytes";
    const { createSessionCookie } = await import("@/lib/auth");
    const cookieHeader = await createSessionCookie("0xbbbb");
    const cookieValue = cookieHeader.split(";")[0];
    const req = new NextRequest(
      new URL("http://localhost/api/admin/manual-resolve"),
      { method: "POST", headers: { cookie: cookieValue } },
    );
    const handler = withAdminAuth(async () => new Response("ok"));
    const res = await handler(req, {} as never);
    expect(res.status).toBe(403);
  });
});

describe("submitAdminTxn", () => {
  beforeEach(restoreEnv);
  afterEach(restoreEnv);

  it("throws a helpful error when APTOS_ADMIN_PRIVATE_KEY is unset", async () => {
    delete process.env.APTOS_ADMIN_PRIVATE_KEY;
    process.env.BASEMENT_MODULE_ADDRESS = "0xabc1";
    process.env.VIRTUAL_USD_METADATA_ADDRESS = "0xabc2";
    process.env.ADMIN_ADDRESS = "0xabc3";
    process.env.PYTH_BTC_FEED_ID = "0xbeef1";
    process.env.PYTH_ETH_FEED_ID = "0xbeef2";
    const mod = await import("@/lib/aptos");
    await expect(
      mod.submitAdminTxn({
        data: {
          function: "0xabc1::market_factory::init_factory",
          typeArguments: [],
          functionArguments: [],
        },
      } as never),
    ).rejects.toThrow(/APTOS_ADMIN_PRIVATE_KEY/);
  });

  it("throws when APTOS_ADMIN_PRIVATE_KEY is still the placeholder", async () => {
    process.env.APTOS_ADMIN_PRIVATE_KEY = "0x_REPLACE_ME";
    const mod = await import("@/lib/aptos");
    await expect(
      mod.submitAdminTxn({
        data: {
          function: "0xabc1::case_vault::admin_pause",
          typeArguments: [],
          functionArguments: ["1"],
        },
      } as never),
    ).rejects.toThrow(/APTOS_ADMIN_PRIVATE_KEY/);
  });
});
