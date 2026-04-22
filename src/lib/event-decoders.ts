// Decoders that turn raw Aptos indexer GraphQL event rows into
// `NewVaultEvent` Drizzle rows. Each Move event struct gets one decoder;
// a single struct may branch into multiple vault_event_type values (e.g.
// BoughtEvent → bought_yes | bought_no by inspecting `data.side`).
//
// txn_hash: v0 uses `transaction_version` as the anchor (unique, u64). The
// schema column is `text` and tolerates this. A follow-up session can
// switch to the true 0x hash if we start joining the indexer's
// `transactions` table.

import type { NewVaultEvent } from "@/db/schema";
import type { DecoderInputRow, SourceSpec } from "@/lib/vault-indexer";

type GraphqlEventRow = DecoderInputRow;

export type EventTypeKey =
  | "case_created"
  | "bought_yes"
  | "bought_no"
  | "sold_yes"
  | "sold_no"
  | "claimed"
  | "resolved"
  | "paused"
  | "drained"
  | "liquidity_seeded"
  | "faucet_claimed"
  | "market_created";

function toBigIntOrNull(v: unknown): bigint | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  return null;
}

function toBlockTime(raw: GraphqlEventRow, tsField: unknown): Date {
  // Prefer Aptos microsecond timestamp from either the event data or the
  // enclosing transaction envelope. Falls back to transaction_version as a
  // monotonic pseudo-anchor if nothing else is available.
  const envelope = raw.timestamp;
  const candidate =
    typeof tsField === "string" && tsField.length > 0
      ? tsField
      : typeof envelope === "string" && envelope.length > 0
        ? envelope
        : null;
  if (candidate !== null) {
    const n = BigInt(candidate);
    // Heuristic: Aptos timestamps are microseconds since epoch (16 digits).
    const ms = n >= 10n ** 15n ? Number(n / 1000n) : Number(n * 1000n);
    return new Date(ms);
  }
  return new Date(Number(BigInt(raw.transaction_version)));
}

function anchorTxn(raw: GraphqlEventRow): { txnHash: string; eventSeq: number } {
  return {
    txnHash: raw.transaction_version,
    eventSeq: Number(raw.sequence_number),
  };
}

function lowerHexAddr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.toLowerCase();
}

// ─── Per-struct decoders ────────────────────────────────

function decodeCaseCreated(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "case_created",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: null,
    amountVirtualUsdRaw: null,
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeBought(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  const side = Number(d.side ?? 0); // 0 = YES, 1 = NO
  return {
    ...anchorTxn(raw),
    eventType: side === 0 ? "bought_yes" : "bought_no",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.buyer),
    amountVirtualUsdRaw: toBigIntOrNull(d.amount_in),
    sharesRaw: toBigIntOrNull(d.shares_out),
    side,
    outcome: null,
    yesReserveAfter: toBigIntOrNull(d.yes_reserve_after),
    noReserveAfter: toBigIntOrNull(d.no_reserve_after),
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeSold(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  const side = Number(d.side ?? 0);
  return {
    ...anchorTxn(raw),
    eventType: side === 0 ? "sold_yes" : "sold_no",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.seller),
    amountVirtualUsdRaw: toBigIntOrNull(d.amount_out),
    sharesRaw: toBigIntOrNull(d.shares_in),
    side,
    outcome: null,
    yesReserveAfter: toBigIntOrNull(d.yes_reserve_after),
    noReserveAfter: toBigIntOrNull(d.no_reserve_after),
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeClaimed(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "claimed",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.claimer ?? d.user),
    amountVirtualUsdRaw: toBigIntOrNull(d.payout ?? d.amount),
    sharesRaw: toBigIntOrNull(d.shares_burned),
    side: null,
    outcome: typeof d.outcome === "number" ? (d.outcome as number) : null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeResolved(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "resolved",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.resolver),
    amountVirtualUsdRaw: null,
    sharesRaw: null,
    side: null,
    outcome: typeof d.outcome === "number" ? (d.outcome as number) : null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodePaused(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "paused",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.admin),
    amountVirtualUsdRaw: null,
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeDrained(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "drained",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: lowerHexAddr(d.destination ?? d.owner),
    amountVirtualUsdRaw: toBigIntOrNull(d.amount),
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeLiquiditySeeded(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "liquidity_seeded",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: null,
    amountVirtualUsdRaw: toBigIntOrNull(d.amount),
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: toBigIntOrNull(d.yes_reserve_after),
    noReserveAfter: toBigIntOrNull(d.no_reserve_after),
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeFaucetClaimed(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "faucet_claimed",
    caseId: null,
    userAddress: lowerHexAddr(d.user),
    amountVirtualUsdRaw: toBigIntOrNull(d.amount),
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp),
    payload: d,
  };
}

function decodeMarketCreated(raw: GraphqlEventRow): NewVaultEvent {
  const d = raw.data as Record<string, unknown>;
  return {
    ...anchorTxn(raw),
    eventType: "market_created",
    caseId: toBigIntOrNull(d.case_id),
    userAddress: null,
    amountVirtualUsdRaw: null,
    sharesRaw: null,
    side: null,
    outcome: null,
    yesReserveAfter: null,
    noReserveAfter: null,
    blockTime: toBlockTime(raw, d.timestamp ?? d.created_at),
    payload: d,
  };
}

// ─── Dispatch ───────────────────────────────────────────

export function decodeEvent(
  spec: SourceSpec,
  raw: GraphqlEventRow,
): NewVaultEvent | null {
  switch (spec.structName) {
    case "CaseCreatedEvent":
      return decodeCaseCreated(raw);
    case "BoughtEvent":
      return decodeBought(raw);
    case "SoldEvent":
      return decodeSold(raw);
    case "ClaimedEvent":
      return decodeClaimed(raw);
    case "ResolvedEvent":
      return decodeResolved(raw);
    case "PausedEvent":
      return decodePaused(raw);
    case "DrainedEvent":
      return decodeDrained(raw);
    case "LiquiditySeededEvent":
      return decodeLiquiditySeeded(raw);
    case "FaucetClaimedEvent":
      return decodeFaucetClaimed(raw);
    case "MarketCreatedEvent":
      return decodeMarketCreated(raw);
    default:
      return null;
  }
}
