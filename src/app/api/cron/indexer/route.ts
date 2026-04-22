// Vercel cron endpoint for the vault event indexer. Runs once per minute
// (see vercel.json). Pulls fresh Move events from the Aptos GraphQL indexer
// and materializes them into Postgres `vault_events`. Cursor per event
// type in `vault_indexer_cursor` ensures idempotency across retries.

import { NextResponse } from "next/server";

import { runIndexerPass } from "@/lib/vault-indexer";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIndexerPass();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
