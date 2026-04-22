import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };
function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v;
}

describe("GET /api/cron/indexer auth gate", () => {
  beforeEach(restoreEnv);
  afterEach(restoreEnv);

  it("returns 401 when no bearer token provided", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { GET } = await import("@/app/api/cron/indexer/route");
    const res = await GET(
      new Request("http://localhost/api/cron/indexer", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET env is unset (hard-gate)", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/indexer/route");
    const res = await GET(
      new Request("http://localhost/api/cron/indexer", {
        method: "GET",
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token mismatches", async () => {
    process.env.CRON_SECRET = "correct";
    const { GET } = await import("@/app/api/cron/indexer/route");
    const res = await GET(
      new Request("http://localhost/api/cron/indexer", {
        method: "GET",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });
});
