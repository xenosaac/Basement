// INVARIANT: withAdminAuth gates admin-only HTTP handlers. The session
// address must appear in the comma-separated ADMIN_ALLOWED_ADDRESSES env.
// This file never reads the admin private key — that lives only inside
// `src/lib/aptos.ts::submitAdminTxn`.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getVerifiedAddress } from "@/lib/auth";

export function adminAllowedAddresses(): string[] {
  const raw = process.env.ADMIN_ALLOWED_ADDRESSES ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isAdminAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const allowed = adminAllowedAddresses();
  return allowed.includes(address.toLowerCase());
}

export function withAdminAuth<Ctx>(
  handler: (req: NextRequest, ctx: Ctx, session: { address: string }) => Promise<Response>,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const address = await getVerifiedAddress(req);
    if (!address) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }
    if (!isAdminAddress(address)) {
      return NextResponse.json(
        { error: "Forbidden — admin-only endpoint" },
        { status: 403 },
      );
    }
    return handler(req, ctx, { address });
  };
}
