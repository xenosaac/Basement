// INVARIANT: admin-signing path; never moves user VirtualUSD; flips case
// state OPEN -> CLOSED so buy/sell abort, leaving user FA + usdc_store
// balances intact for subsequent resolve/claim.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withAdminAuth } from "@/lib/admin-auth";
import { buildAdminPauseTxn, submitAdminTxn } from "@/lib/aptos";

interface Body {
  caseId?: unknown;
}

export const dynamic = "force-dynamic";

export const POST = withAdminAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const caseIdRaw = body.caseId;
  if (typeof caseIdRaw !== "number" && typeof caseIdRaw !== "string") {
    return NextResponse.json(
      { error: "caseId required (number or string)" },
      { status: 400 },
    );
  }

  try {
    const { txnHash, success } = await submitAdminTxn(
      buildAdminPauseTxn(BigInt(caseIdRaw)),
    );
    return NextResponse.json({ success, txnHash });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
});
