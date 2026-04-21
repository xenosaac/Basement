import { NextRequest, NextResponse } from "next/server";
import {
  consumeNonce,
  createSessionCookie,
  expectedAuthMessage,
  normalizeAptosAddress,
  verifyAptosSignature,
} from "@/lib/auth";

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

    // R-4: the 5-field expected message must appear verbatim inside the
    // wrapped fullMessage produced by the wallet.
    const expected = expectedAuthMessage(normalized, nonce);
    if (!fullMessage.includes(expected)) {
      return NextResponse.json(
        { error: "Message mismatch" },
        { status: 400 },
      );
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
