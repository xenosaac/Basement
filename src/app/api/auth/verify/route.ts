import { NextRequest, NextResponse } from "next/server";
import {
  consumeNonce,
  createSessionCookie,
  normalizeAptosAddress,
  verifyAptosSignature,
} from "@/lib/auth";
import { AUTH_STATEMENT, getAuthChainId } from "@/lib/constants";

/**
 * Derive the expected domain from the request. Client-side builds the auth
 * message with `window.location.host`; the server must match the actual host
 * the browser used, not a hardcoded constant. `NEXT_PUBLIC_AUTH_DOMAIN` still
 * wins as an explicit override for deployments that terminate TLS behind a
 * proxy (the Host header may not reflect the canonical dapp domain).
 */
function resolveExpectedDomain(request: NextRequest): string {
  const override = process.env.NEXT_PUBLIC_AUTH_DOMAIN;
  if (override) return override;
  const host = request.headers.get("host");
  if (host) return host;
  return "basement";
}

export const dynamic = "force-dynamic";

interface VerifyBody {
  address?: string;
  publicKey?: string;
  signature?: string;
  fullMessage?: string;
  nonce?: string;
}

/**
 * POST /api/auth/verify
 *
 * Verifies an Aptos wallet-adapter `signMessage` response. Body shape:
 *   { address, publicKey, signature, fullMessage, nonce }
 *
 * Security red lines enforced:
 *  - R-4: nonce is consumed single-use with 10-min TTL + address binding
 *  - R-4: expected 5-field message is rebuilt server-side and must appear
 *    inside `fullMessage` (adapter wraps it with APTOS headers)
 *  - R-6: session cookie is HttpOnly + SameSite=Lax + Secure (prod)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VerifyBody;
    const { address, publicKey, signature, fullMessage, nonce } = body;

    if (!address || !publicKey || !signature || !fullMessage || !nonce) {
      return NextResponse.json(
        {
          error:
            "address, publicKey, signature, fullMessage, and nonce required",
        },
        { status: 400 },
      );
    }

    const normalized = normalizeAptosAddress(address);

    // R-4: nonce single-use + address binding.
    if (!consumeNonce(nonce, normalized)) {
      return NextResponse.json(
        { error: "Invalid or expired nonce" },
        { status: 400 },
      );
    }

    // R-4: each of the 5 required fields must appear as `key: value` substring
    // inside the wrapped fullMessage. Wallets differ in how they frame the
    // raw message (Petra: APTOS\nmessage: ...\nnonce: ...; OKX wraps
    // differently), so matching the 5-field block verbatim is too brittle.
    // Security is preserved: the Ed25519 signature still covers the entire
    // fullMessage, so an attacker cannot splice or alter any byte.
    const requiredFields: Record<string, string> = {
      domain: resolveExpectedDomain(request),
      chainId: String(getAuthChainId()),
      nonce,
      address: normalized,
      statement: AUTH_STATEMENT,
    };
    for (const [key, value] of Object.entries(requiredFields)) {
      if (!fullMessage.includes(`${key}: ${value}`)) {
        return NextResponse.json(
          { error: `Message field missing: ${key}` },
          { status: 400 },
        );
      }
    }

    const ok = verifyAptosSignature(publicKey, fullMessage, signature);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 },
      );
    }

    const cookie = await createSessionCookie(normalized);
    return NextResponse.json(
      { address: normalized },
      { headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Verification failed";
    console.error("Aptos verify error:", msg);
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }
}
