import { describe, it, expect, beforeEach } from "vitest";

import { POST } from "../sponsor/route";
import { __resetRateLimitForTests } from "../sponsor/rate-limit";
import {
  SPONSORED_INNER_ENTRY_ALLOWLIST,
  isInnerEntryAllowed,
} from "@/lib/aptos";

function makeReq(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/faucet/sponsor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("faucet sponsor allowlist helper", () => {
  it("accepts claim_faucet", () => {
    expect(isInnerEntryAllowed("basement::virtual_usd::claim_faucet")).toBe(true);
  });
  it("accepts claim_winnings", () => {
    expect(isInnerEntryAllowed("basement::case_vault::claim_winnings")).toBe(true);
  });
  it("rejects arbitrary inner fn", () => {
    expect(isInnerEntryAllowed("basement::virtual_usd::admin_mint")).toBe(false);
  });
  it("allowlist has exactly the two v0 entries", () => {
    expect([...SPONSORED_INNER_ENTRY_ALLOWLIST]).toEqual([
      "basement::virtual_usd::claim_faucet",
      "basement::case_vault::claim_winnings",
    ]);
  });
});

describe("POST /api/faucet/sponsor — body + rate-limit gates", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await POST(makeReq({ foo: "bar" }, "1.1.1.1"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Missing/);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/faucet/sponsor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2.2.2.2",
      },
      body: "{not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rate-limits a second request within 10s from the same IP", async () => {
    // First call is rate-limit pass but will fail body validation (400) —
    // that's fine, the rate limiter records the timestamp regardless.
    const first = await POST(makeReq({}, "3.3.3.3"));
    expect(first.status).toBe(400);
    const second = await POST(makeReq({}, "3.3.3.3"));
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/rate limited/);
  });
});
