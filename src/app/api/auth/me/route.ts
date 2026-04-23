import { NextRequest, NextResponse } from "next/server";
import { getVerifiedAddress } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, address });
}
