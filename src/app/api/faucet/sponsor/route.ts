// INVARIANT: faucet-admin signing path pays gas only; never mints VirtualUSD
// to user directly; user signs their own claim_faucet entry (multi-agent
// fee_payer pattern). Allowlist gate on inner entry function prevents the
// admin key from being coerced into sponsoring arbitrary transactions.

import { NextResponse } from "next/server";
import {
  Account,
  AccountAuthenticator,
  Deserializer,
  Ed25519PrivateKey,
  PrivateKey,
  PrivateKeyVariants,
  SimpleTransaction,
} from "@aptos-labs/ts-sdk";

import { aptos, isInnerEntryAllowed } from "@/lib/aptos";
import { rateLimitCheckAndRecord } from "./rate-limit";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex string");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function extractInnerEntryName(transaction: SimpleTransaction): string | null {
  // v5 SDK shape: transaction.rawTransaction.payload is a TransactionPayloadEntryFunction
  // with { entryFunction: EntryFunction { module_name: ModuleId, function_name: Identifier } }.
  const payload = (transaction.rawTransaction as unknown as {
    payload: {
      entryFunction?: {
        module_name: { name: { identifier: string } | { value: string } };
        function_name: { identifier: string } | { value: string };
      };
    };
  }).payload;
  const ef = payload?.entryFunction;
  if (!ef) return null;
  const moduleName =
    "identifier" in ef.module_name.name
      ? ef.module_name.name.identifier
      : ef.module_name.name.value;
  const functionName =
    "identifier" in ef.function_name
      ? ef.function_name.identifier
      : ef.function_name.value;
  return `basement::${moduleName}::${functionName}`;
}

// Canonical fee-payer address derived from the server-held faucet admin key.
// Exposed so the client doesn't need to trust `NEXT_PUBLIC_ADMIN_ADDRESS` to
// stay in sync with the private key — the wallet must set the correct
// feePayerAddress on the sponsored tx or submission fails signature check.
function loadFaucetAdmin():
  | { account: Account; error?: undefined }
  | { account?: undefined; error: string } {
  const rawKey =
    process.env.APTOS_FAUCET_ADMIN_PRIVATE_KEY ??
    process.env.APTOS_ADMIN_PRIVATE_KEY ??
    "";
  if (rawKey.trim() === "" || rawKey.startsWith("0x_")) {
    return { error: "APTOS_FAUCET_ADMIN_PRIVATE_KEY not configured" };
  }
  try {
    const hex = PrivateKey.formatPrivateKey(rawKey, PrivateKeyVariants.Ed25519);
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(hex),
    });
    return { account };
  } catch (err) {
    return { error: `Invalid admin private key: ${(err as Error).message}` };
  }
}

export async function GET(): Promise<Response> {
  const loaded = loadFaucetAdmin();
  if (!loaded.account) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }
  return NextResponse.json({
    feePayerAddress: loaded.account.accountAddress.toString(),
  });
}

export async function POST(req: Request): Promise<Response> {
  // ── Rate limit ──────────────────────────────────────────
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!rateLimitCheckAndRecord(ip)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  // ── Body validation ─────────────────────────────────────
  const body = (await req.json().catch(() => null)) as {
    transactionBytesHex?: unknown;
    senderAuthenticatorBytesHex?: unknown;
  } | null;
  if (
    !body ||
    typeof body.transactionBytesHex !== "string" ||
    typeof body.senderAuthenticatorBytesHex !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing transactionBytesHex or senderAuthenticatorBytesHex" },
      { status: 400 }
    );
  }

  // ── Env gate (never at module import) ───────────────────
  const rawKey =
    process.env.APTOS_FAUCET_ADMIN_PRIVATE_KEY ??
    process.env.APTOS_ADMIN_PRIVATE_KEY ??
    "";
  if (rawKey.trim() === "" || rawKey.startsWith("0x_")) {
    return NextResponse.json(
      { error: "APTOS_FAUCET_ADMIN_PRIVATE_KEY not configured" },
      { status: 500 }
    );
  }

  // ── Deserialize user-signed transaction + authenticator ─
  let transaction: SimpleTransaction;
  let senderAuthenticator: AccountAuthenticator;
  try {
    transaction = SimpleTransaction.deserialize(
      new Deserializer(hexToBytes(body.transactionBytesHex))
    );
    senderAuthenticator = AccountAuthenticator.deserialize(
      new Deserializer(hexToBytes(body.senderAuthenticatorBytesHex))
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Deserialization failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  // ── Allowlist gate on inner entry function ──────────────
  const canonicalInner = extractInnerEntryName(transaction);
  if (!canonicalInner) {
    return NextResponse.json(
      { error: "Only entry function payloads accepted" },
      { status: 400 }
    );
  }
  if (!isInnerEntryAllowed(canonicalInner)) {
    return NextResponse.json(
      { error: `Inner entry "${canonicalInner}" not in SPONSORED_INNER_ENTRY_ALLOWLIST` },
      { status: 400 }
    );
  }

  // ── Load faucet-admin account (v0: shares admin key) ────
  let feePayer: Account;
  try {
    const hex = PrivateKey.formatPrivateKey(rawKey, PrivateKeyVariants.Ed25519);
    feePayer = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(hex),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid admin private key: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  // ── Sign as fee_payer + submit ──────────────────────────
  let pendingHash: string;
  try {
    const feePayerAuthenticator = aptos.transaction.signAsFeePayer({
      signer: feePayer,
      transaction,
    });
    const pending = await aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator,
      feePayerAuthenticator,
    });
    pendingHash = pending.hash;
  } catch (err) {
    return NextResponse.json(
      { error: `Submit failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  try {
    await aptos.waitForTransaction({
      transactionHash: pendingHash,
      options: { timeoutSecs: 20 },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, txnHash: pendingHash, error: (err as Error).message },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, txnHash: pendingHash });
}
