import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Clears the `basement_session` cookie. Mirrors the hardening attributes
 * applied by `createSessionCookie` in `src/lib/auth.ts` so the browser
 * reliably evicts the cookie regardless of environment.
 */
export async function POST() {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `basement_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie } },
  );
}
