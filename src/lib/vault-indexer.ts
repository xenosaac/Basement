// Vault event indexer. Periodically pulls on-chain events emitted by the
// basement Move modules (case_vault, market_factory, virtual_usd) from the
// Aptos fullnode REST API and materializes them into Postgres
// `vault_events`.
//
// Aptos Labs deprecated the GraphQL `events` table in Sept 2024, so this
// indexer uses `GET /accounts/{addr}/transactions?start=X&limit=N` to
// discover transactions touching our module address, then reads the inline
// `events[]` array on each `user_transaction` payload. Cursor is a single
// `transaction_version` stored across all 12 event-type rows in
// `vault_indexer_cursor` (advanced in lockstep per pass).
//
// Scope: Session D Option 2a. This file does NOT project into derived
// tables (positions/trades/claims) — that's Option 2b after the custodial
// writer is deleted.

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  vaultEvents,
  vaultIndexerCursor,
  type NewVaultEvent,
} from "@/db/schema";
import { moduleAddress } from "@/lib/aptos";
import { decodeEvent, type EventTypeKey } from "@/lib/event-decoders";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SOFT_TIMEOUT_MS = 25_000;
const CANONICAL_CURSOR = "case_created"; // arbitrary — all cursors tracked lockstep

// 12 event_type keys (must match vaultEventTypeEnum).
const ALL_EVENT_TYPES: EventTypeKey[] = [
  "case_created",
  "bought_yes",
  "bought_no",
  "sold_yes",
  "sold_no",
  "claimed",
  "resolved",
  "paused",
  "drained",
  "liquidity_seeded",
  "faucet_claimed",
  "market_created",
];

export interface IndexerPassResult {
  eventsProcessed: number;
  txnsScanned: number;
  cursorAdvancedTo: string | null;
  durationMs: number;
  timeout: boolean;
  errors: Array<{ stage: string; message: string }>;
}

export interface RunIndexerPassOptions {
  batchSize?: number;
  softTimeoutMs?: number;
  /**
   * Transport override for tests. Given a (moduleAddr, startVersion, limit),
   * returns the REST response body (array of user_transaction objects).
   */
  fetchTransactions?: (
    moduleAddr: string,
    start: bigint,
    limit: number,
  ) => Promise<RestTransaction[]>;
  /** DB surface override for tests. */
  dbOverride?: IndexerDbOps;
}

export interface RestEvent {
  type: string;
  sequence_number?: string;
  guid?: { creation_number: string; account_address: string };
  data: Record<string, unknown>;
}

export interface RestTransaction {
  version: string;
  type: string; // "user_transaction" | "block_metadata_transaction" | ...
  hash?: string;
  timestamp?: string; // microseconds since epoch (user_transaction)
  events?: RestEvent[];
}

export interface IndexerDbOps {
  listCursors(): Promise<Array<{ eventType: string; lastProcessedSequence: bigint }>>;
  upsertEvents(rows: NewVaultEvent[]): Promise<number>;
  updateAllCursors(newVersion: bigint): Promise<void>;
}

const defaultDbOps: IndexerDbOps = {
  async listCursors() {
    return await db
      .select({
        eventType: vaultIndexerCursor.eventType,
        lastProcessedSequence: vaultIndexerCursor.lastProcessedSequence,
      })
      .from(vaultIndexerCursor);
  },
  async upsertEvents(rows) {
    if (rows.length === 0) return 0;
    const result = await db
      .insert(vaultEvents)
      .values(rows)
      .onConflictDoNothing({
        target: [vaultEvents.txnHash, vaultEvents.eventSeq],
      });
    return result.rowCount ?? rows.length;
  },
  async updateAllCursors(newVersion) {
    await db
      .update(vaultIndexerCursor)
      .set({
        lastProcessedSequence: sql`${newVersion}`,
        updatedAt: new Date(),
      });
  },
};

async function defaultFetchTransactions(
  moduleAddr: string,
  start: bigint,
  limit: number,
): Promise<RestTransaction[]> {
  const fullnode = process.env.APTOS_FULLNODE_URL ?? "https://fullnode.testnet.aptoslabs.com/v1";
  const url = `${fullnode}/accounts/${moduleAddr}/transactions?start=${start}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Fullnode REST returned ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as RestTransaction[];
}

// ─── Type-name mapping ──────────────────────────────────

export interface SourceSpec {
  moduleName: "case_vault" | "market_factory" | "virtual_usd";
  structName: string;
  outputTypes: EventTypeKey[];
}

/**
 * Shape that decoders accept. Constructed from either a REST transaction's
 * event (primary path) or a synthesized fixture (tests). Keeps the decoder
 * API stable even if we later swap the upstream data source again.
 */
export interface DecoderInputRow {
  transaction_version: string;
  sequence_number: string;
  indexed_type: string;
  type: string;
  data: Record<string, unknown>;
  /** Microsecond or millisecond timestamp from the transaction envelope. */
  timestamp?: string;
}

/** @deprecated Pre-2024 GraphQL shape; kept as alias for test compatibility. */
export type GraphqlEventRow = DecoderInputRow;

export const SOURCE_SPECS: SourceSpec[] = [
  { moduleName: "case_vault", structName: "CaseCreatedEvent", outputTypes: ["case_created"] },
  { moduleName: "case_vault", structName: "BoughtEvent", outputTypes: ["bought_yes", "bought_no"] },
  { moduleName: "case_vault", structName: "SoldEvent", outputTypes: ["sold_yes", "sold_no"] },
  { moduleName: "case_vault", structName: "ClaimedEvent", outputTypes: ["claimed"] },
  { moduleName: "case_vault", structName: "ResolvedEvent", outputTypes: ["resolved"] },
  { moduleName: "case_vault", structName: "PausedEvent", outputTypes: ["paused"] },
  { moduleName: "case_vault", structName: "DrainedEvent", outputTypes: ["drained"] },
  { moduleName: "case_vault", structName: "LiquiditySeededEvent", outputTypes: ["liquidity_seeded"] },
  { moduleName: "virtual_usd", structName: "FaucetClaimedEvent", outputTypes: ["faucet_claimed"] },
  { moduleName: "market_factory", structName: "MarketCreatedEvent", outputTypes: ["market_created"] },
];

function findSpec(eventType: string, modAddr: string): SourceSpec | null {
  // eventType = "0xADDR::module::StructName" — split and match.
  const parts = eventType.split("::");
  if (parts.length !== 3) return null;
  if (parts[0].toLowerCase() !== modAddr.toLowerCase()) return null;
  const [, moduleName, structName] = parts;
  return (
    SOURCE_SPECS.find(
      (s) => s.moduleName === moduleName && s.structName === structName,
    ) ?? null
  );
}

// ─── Main pass ──────────────────────────────────────────

export async function runIndexerPass(
  options: RunIndexerPassOptions = {},
): Promise<IndexerPassResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const softTimeoutMs = options.softTimeoutMs ?? DEFAULT_SOFT_TIMEOUT_MS;
  const fetchTxns = options.fetchTransactions ?? defaultFetchTransactions;
  const dbOps = options.dbOverride ?? defaultDbOps;

  const start = Date.now();
  const modAddr = moduleAddress();
  const errors: IndexerPassResult["errors"] = [];

  const cursors = await dbOps.listCursors();
  const current = cursors.find((c) => c.eventType === CANONICAL_CURSOR)?.lastProcessedSequence ?? 0n;
  let cursor = current;
  let eventsProcessed = 0;
  let txnsScanned = 0;
  let timedOut = false;

  while (Date.now() - start < softTimeoutMs) {
    let txns: RestTransaction[];
    try {
      txns = await fetchTxns(modAddr, cursor + 1n, batchSize);
    } catch (err) {
      errors.push({ stage: "fetchTransactions", message: (err as Error).message });
      break;
    }
    if (txns.length === 0) break;
    txnsScanned += txns.length;

    const decoded: NewVaultEvent[] = [];
    let maxSeq = cursor;
    for (const txn of txns) {
      // `start` / cursor use the account's per-sender sequence_number
      // (monotonic u64). `transaction_version` is a global anchor that we
      // keep in the decoded row for downstream joins, but cursoring on it
      // would break because REST `start` expects sequence_number.
      const seq = BigInt(
        (txn as RestTransaction & { sequence_number?: string }).sequence_number ??
          txn.version,
      );
      if (seq > maxSeq) maxSeq = seq;
      const events = txn.events ?? [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const spec = findSpec(ev.type, modAddr);
        if (!spec) continue;
        // Module-level `#[event]` emissions all report sequence_number=0.
        // Use the event's index inside the transaction as the composite
        // key with txn_hash so UNIQUE(txn_hash, event_seq) actually
        // distinguishes sibling events in the same tx.
        const raw = {
          transaction_version: txn.version,
          sequence_number: String(i),
          indexed_type: ev.type,
          type: ev.type,
          data: ev.data,
          timestamp: txn.timestamp,
        };
        try {
          const decodedEvent = decodeEvent(spec, raw);
          if (decodedEvent) decoded.push(decodedEvent);
        } catch (err) {
          errors.push({
            stage: `decode:${spec.structName}`,
            message: (err as Error).message,
          });
        }
      }
    }

    if (decoded.length > 0) {
      try {
        const inserted = await dbOps.upsertEvents(decoded);
        eventsProcessed += inserted;
      } catch (err) {
        errors.push({ stage: "upsertEvents", message: (err as Error).message });
        break;
      }
    }

    cursor = maxSeq;
    try {
      await dbOps.updateAllCursors(cursor);
    } catch (err) {
      errors.push({ stage: "updateAllCursors", message: (err as Error).message });
      break;
    }

    // If we received fewer than batchSize txns, we caught up.
    if (txns.length < batchSize) break;
  }

  if (Date.now() - start >= softTimeoutMs) timedOut = true;
  void ALL_EVENT_TYPES; // silence unused

  return {
    eventsProcessed,
    txnsScanned,
    cursorAdvancedTo: cursor > current ? cursor.toString() : null,
    durationMs: Date.now() - start,
    timeout: timedOut,
    errors,
  };
}
