import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import {
  Ed25519PublicKey,
  Ed25519Signature,
  Hex,
} from "@aptos-labs/ts-sdk";
import {
  AUTH_STATEMENT,
  getAuthChainId,
  getAuthDomain,
} from "./constants";

/**
 * Aptos Ed25519 signMessage auth — nonce issuance + verify + JWT session cookie.
 *
 * Signs & verifies Ed25519 messages using the Aptos wallet adapter's
 * signMessage response (full message shape: domain | chainId | nonce |
 * address | statement).
 *
 * STUB: nonces live in an in-memory Map for Session A. Session C will
 * migrate to a Postgres `auth_nonces` table.
 */

const JWT_SECRET_RAW = process.env.JWT_SECRET ?? "dev-secret";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
const SESSION_COOKIE = "basement_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes (red line R-5)
const SWEEP_EVERY = 50; // sweep expired entries every Nth write

interface NonceRecord {
  address?: string;
  issuedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __basementAptosNonceStore: Map<string, NonceRecord> | undefined;
  // eslint-disable-next-line no-var
  var __basementAptosNonceSweepCounter: number | undefined;
}

// Persisted on globalThis so the Map survives dev-mode HMR re-execution.
const nonceStore: Map<string, NonceRecord> =
  globalThis.__basementAptosNonceStore ?? new Map<string, NonceRecord>();
globalThis.__basementAptosNonceStore = nonceStore;

function sweepExpired(): void {
  const counter = (globalThis.__basementAptosNonceSweepCounter ?? 0) + 1;
  globalThis.__basementAptosNonceSweepCounter = counter;
  if (counter % SWEEP_EVERY !== 0) return;
  const now = Date.now();
  for (const [nonce, rec] of nonceStore.entries()) {
    if (now - rec.issuedAt > NONCE_TTL_MS) nonceStore.delete(nonce);
  }
}

// STUB: Session C migrates to auth_nonces Postgres table.
export function issueNonce(address?: string): string {
  sweepExpired();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  nonceStore.set(nonce, { address, issuedAt: Date.now() });
  return nonce;
}

export function consumeNonce(nonce: string, address?: string): boolean {
  const rec = nonceStore.get(nonce);
  if (!rec) return false;
  if (Date.now() - rec.issuedAt > NONCE_TTL_MS) {
    nonceStore.delete(nonce);
    return false;
  }
  if (rec.address && address && rec.address.toLowerCase() !== address.toLowerCase()) {
    return false;
  }
  nonceStore.delete(nonce);
  return true;
}

export interface AuthMessageFields {
  domain: string;
  chainId: number;
  nonce: string;
  address: string;
  statement: string;
}

/**
 * Build the 5-field auth message the wallet will sign (red line R-4).
 * The wallet adapter wraps this message with its own APTOS\n prefix
 * headers, but our 5 fields are embedded verbatim inside `message`.
 */
export function buildAuthMessage(fields: AuthMessageFields): string {
  const { domain, chainId, nonce, address, statement } = fields;
  return [
    `domain: ${domain}`,
    `chainId: ${chainId}`,
    `nonce: ${nonce}`,
    `address: ${address}`,
    `statement: ${statement}`,
  ].join("\n");
}

export function expectedAuthMessage(address: string, nonce: string): string {
  return buildAuthMessage({
    domain: getAuthDomain(),
    chainId: getAuthChainId(),
    nonce,
    address,
    statement: AUTH_STATEMENT,
  });
}

/**
 * Verify an Ed25519 signature produced by `signMessage` against the
 * address-bound public key.
 *
 * @param publicKey hex-encoded Ed25519 public key (AIP-80 formatted or raw hex)
 * @param fullMessage the full message string the wallet actually signed
 *   (adapter-wrapped; e.g. "APTOS\nmessage: ...\nnonce: ..."). We verify
 *   the signature against this exact bytes-of-fullMessage payload.
 * @param signature hex-encoded signature
 */
export function verifyAptosSignature(
  publicKey: string,
  fullMessage: string,
  signature: string,
): boolean {
  try {
    const pubKeyBytes = Hex.fromHexString(publicKey).toUint8Array();
    const sigBytes = Hex.fromHexString(signature).toUint8Array();
    const pk = new Ed25519PublicKey(pubKeyBytes);
    const sig = new Ed25519Signature(sigBytes);
    const messageBytes = new TextEncoder().encode(fullMessage);
    return pk.verifySignature({ message: messageBytes, signature: sig });
  } catch (err) {
    console.error("Aptos signature verification threw:", err);
    return false;
  }
}

/**
 * Normalize an Aptos address to lowercase 0x-prefixed hex (66 chars).
 */
export function normalizeAptosAddress(address: string): string {
  const hex = address.toLowerCase().startsWith("0x")
    ? address.toLowerCase()
    : `0x${address.toLowerCase()}`;
  return hex;
}

// ─── Session cookie ────────────────────────────────────────

export async function createSessionCookie(address: string): Promise<string> {
  const token = await new SignJWT({ address: normalizeAptosAddress(address) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(JWT_SECRET);

  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secureFlag}`;
}

export async function getVerifiedAddress(
  request: NextRequest,
): Promise<string | null> {
  const cookie = request.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, JWT_SECRET);
    return (payload.address as string) ?? null;
  } catch {
    return null;
  }
}

export async function requireAuth(
  request: NextRequest,
): Promise<{ address: string } | Response> {
  const address = await getVerifiedAddress(request);
  if (!address) {
    return new Response(
      JSON.stringify({ error: "Not authenticated. Sign in with wallet first." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  return { address };
}
