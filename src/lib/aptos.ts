/**
 * Basement — Aptos TS client (Session A, P2NC-T4)
 *
 * Responsibilities
 *  - Singleton `Aptos` client + `getAptos(network)` factory (T4-01)
 *  - LAZY env validation — import is side-effect-free; builders throw on
 *    first use with a helpful message naming the missing env var (T4-02)
 *  - Case / user FA / YES+NO share readers (T4-04..T4-06)
 *  - User tx builders (buy / sell / claim) + simulate helpers (T4-07..T4-09)
 *  - Sponsored-gas builder (inner-entry allowlist hardcoded) + Pyth Hermes
 *    VAA fetch + resolve builder (T4-10)
 *  - Admin tx builders + `submitAdminTxn` (Session D un-stub): private key
 *    loaded call-time from `APTOS_ADMIN_PRIVATE_KEY`, never at module import,
 *    never logged, never returned in responses.
 *
 * Red-lines honored
 *  - R-4: chainId is fetched at runtime via `aptos.getLedgerInfo()`, never
 *    hardcoded and not read from `NEXT_PUBLIC_APTOS_CHAIN_ID` here.
 *  - Sponsored submit uses `aptos.transaction.submit.simple` (NOT multiAgent)
 *    with `feePayerAuthenticator`. `submit.multiAgent` is ONLY for txns with
 *    secondary signers.
 *  - Hermes `binary.data[0]` is a length-1 array in sponsored price-update
 *    flow — do not iterate.
 *
 * Env-filled by Session C (2026-04-22 testnet deploy):
 *   BASEMENT_MODULE_ADDRESS, VIRTUAL_USD_METADATA_ADDRESS, ADMIN_ADDRESS,
 *   PYTH_BTC_FEED_ID, PYTH_ETH_FEED_ID. See .env / .env.example.
 */

import {
  Aptos,
  AptosConfig,
  MoveOption,
  MoveVector,
  Network,
  U8,
  type InputEntryFunctionData,
  type InputViewFunctionData,
  type MoveResource,
} from "@aptos-labs/ts-sdk";

import { cachedView } from "@/lib/aptos-cache";

/* ---------------------------------------------------------------------------
 * T4-01 — Client singleton + factory
 * ------------------------------------------------------------------------ */

type AptosNetwork = "testnet" | "mainnet" | "devnet" | "local";

function resolveNetwork(n?: string): Network {
  const raw = (n ?? process.env.NEXT_PUBLIC_APTOS_NETWORK ?? "testnet").toLowerCase();
  switch (raw) {
    case "mainnet":
      return Network.MAINNET;
    case "devnet":
      return Network.DEVNET;
    case "local":
      return Network.LOCAL;
    case "testnet":
    default:
      return Network.TESTNET;
  }
}

const _aptosCache = new Map<Network, Aptos>();

/** Return (memoized) an Aptos client bound to the requested network.
 *
 * Reads `APTOS_API_KEY` at call time — when set, every RPC carries an
 * `Authorization: Bearer <key>` header so our quota runs against the
 * account tied to that key instead of the per-anon-IP rate limit
 * (40k CU / 300s) that throttles testnet traffic. No key → falls back
 * to anon (only suitable for low-traffic dev).
 */
export function getAptos(network?: AptosNetwork | Network): Aptos {
  const net =
    typeof network === "string" || network === undefined
      ? resolveNetwork(network as string | undefined)
      : network;
  const cached = _aptosCache.get(net);
  if (cached) return cached;
  const fullnode = process.env.APTOS_FULLNODE_URL || undefined;
  const apiKey = process.env.APTOS_API_KEY?.trim();
  const clientConfig = apiKey ? { API_KEY: apiKey } : undefined;
  const cfg = new AptosConfig({ network: net, fullnode, clientConfig });
  const client = new Aptos(cfg);
  _aptosCache.set(net, client);
  return client;
}

/** Default client (v0 == testnet). Lazy: constructor is pure, no network I/O. */
export const aptos: Aptos = getAptos();

/* ---------------------------------------------------------------------------
 * T4-02 — Lazy env validation
 * ------------------------------------------------------------------------ */

const STUB = "0x_STUB_REPLACE_IN_SESSION_B"; // retained as sentinel for env-not-overridden check

/**
 * Client-exposed env getters below use explicit static `process.env.FOO`
 * accesses instead of dynamic bracket lookup because
 * Next.js only inlines `NEXT_PUBLIC_*` vars into the browser bundle when
 * the property name is a string literal. A dynamic `process.env[name]`
 * reads undefined in the browser even if the var is set in .env.
 */
function pickStatic(
  label: string,
  serverValue: string | undefined,
  publicValue: string | undefined,
): string {
  const raw = (serverValue && serverValue.trim()) || (publicValue && publicValue.trim()) || "";
  if (!raw) {
    throw new Error(
      `[aptos.ts] Required env var ${label} is not set. ` +
        `Add it to .env (see .env.example). Filled in Session C (2026-04-22 testnet deploy).`,
    );
  }
  if (raw === STUB) {
    throw new Error(
      `[aptos.ts] Env var ${label} is still a stub "${STUB}". ` +
        `Session C provided real testnet values; ensure .env is loaded.`,
    );
  }
  return raw;
}

/** Module address (e.g. `0xabc...` — basement core modules live here). */
// NOTE: Session C filled .env with 0xb3a8d906...f55f2ff7 (Aptos testnet).
export function moduleAddress(): string {
  return pickStatic(
    "BASEMENT_MODULE_ADDRESS (or NEXT_PUBLIC_BASEMENT_MODULE_ADDRESS)",
    process.env.BASEMENT_MODULE_ADDRESS,
    process.env.NEXT_PUBLIC_BASEMENT_MODULE_ADDRESS,
  );
}
/** Virtual USD Fungible Asset metadata object address. */
// NOTE: Session C filled .env with 0xec45012f...21071c89 (Aptos testnet, derived from init_module).
export function virtualUsdMetadataAddress(): string {
  return pickStatic(
    "VIRTUAL_USD_METADATA_ADDRESS (or NEXT_PUBLIC_VIRTUAL_USD_METADATA_ADDRESS)",
    process.env.VIRTUAL_USD_METADATA_ADDRESS,
    process.env.NEXT_PUBLIC_VIRTUAL_USD_METADATA_ADDRESS,
  );
}
/** Public admin address (sponsor / resolver). Private key NEVER read here. */
// NOTE: Session C v0 testnet uses 1-key-packed: ADMIN_ADDRESS = BASEMENT_MODULE_ADDRESS.
export function adminAddress(): string {
  return pickStatic(
    "ADMIN_ADDRESS (or NEXT_PUBLIC_ADMIN_ADDRESS)",
    process.env.ADMIN_ADDRESS,
    process.env.NEXT_PUBLIC_ADMIN_ADDRESS,
  );
}
/** Pyth Hermes base URL — always defaults to public relay. */
export function pythHermesUrl(): string {
  return process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";
}
// NOTE: Pyth BTC/USD canonical feed id — same on mainnet + testnet + Aptos. Session C filled .env.
// Feed ids are public constants, safe to ship to browser bundle via NEXT_PUBLIC_.
export function pythBtcFeedId(): string {
  return pickStatic(
    "PYTH_BTC_FEED_ID (or NEXT_PUBLIC_PYTH_BTC_FEED_ID)",
    process.env.PYTH_BTC_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_BTC_FEED_ID,
  );
}
// NOTE: Pyth ETH/USD canonical feed id — same on mainnet + testnet + Aptos. Session C filled .env.
export function pythEthFeedId(): string {
  return pickStatic(
    "PYTH_ETH_FEED_ID (or NEXT_PUBLIC_PYTH_ETH_FEED_ID)",
    process.env.PYTH_ETH_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_ETH_FEED_ID,
  );
}
// NOTE: Pyth XAU/USD gold-spot feed — beta on Aptos testnet, stable on mainnet.
// Channel must match PYTH_HERMES_URL (see env file docs).
export function pythXauFeedId(): string {
  return pickStatic(
    "PYTH_XAU_FEED_ID (or NEXT_PUBLIC_PYTH_XAU_FEED_ID)",
    process.env.PYTH_XAU_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_XAU_FEED_ID,
  );
}

// v0.5 Phase C — additional Pyth feed getters for the new market groups.
// Each follows the same `pickStatic` pattern: server-side env first, then
// `NEXT_PUBLIC_*` mirror, throw if neither is set. Feed ids are the
// hermes-beta channel ids (Aptos testnet) — see `.env.example` for the
// mainnet alternates and channel-vs-feed-id discipline.
export function pythSolFeedId(): string {
  return pickStatic(
    "PYTH_SOL_FEED_ID (or NEXT_PUBLIC_PYTH_SOL_FEED_ID)",
    process.env.PYTH_SOL_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_SOL_FEED_ID,
  );
}
export function pythMaticFeedId(): string {
  return pickStatic(
    "PYTH_MATIC_FEED_ID (or NEXT_PUBLIC_PYTH_MATIC_FEED_ID)",
    process.env.PYTH_MATIC_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_MATIC_FEED_ID,
  );
}
export function pythAptFeedId(): string {
  return pickStatic(
    "PYTH_APT_FEED_ID (or NEXT_PUBLIC_PYTH_APT_FEED_ID)",
    process.env.PYTH_APT_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_APT_FEED_ID,
  );
}
export function pythXagFeedId(): string {
  return pickStatic(
    "PYTH_XAG_FEED_ID (or NEXT_PUBLIC_PYTH_XAG_FEED_ID)",
    process.env.PYTH_XAG_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_XAG_FEED_ID,
  );
}
export function pythXptFeedId(): string {
  return pickStatic(
    "PYTH_XPT_FEED_ID (or NEXT_PUBLIC_PYTH_XPT_FEED_ID)",
    process.env.PYTH_XPT_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_XPT_FEED_ID,
  );
}
export function pythHypeFeedId(): string {
  return pickStatic(
    "PYTH_HYPE_FEED_ID (or NEXT_PUBLIC_PYTH_HYPE_FEED_ID)",
    process.env.PYTH_HYPE_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_HYPE_FEED_ID,
  );
}
/** Brent front-month override. Prefer the rollover table in
 *  `src/lib/quant/brent-rollover.ts::resolveBrentFeedId`; this getter only
 *  reads the env override and is a fallthrough when the table is empty. */
export function pythBrentFrontMonthFeedId(): string {
  return pickStatic(
    "PYTH_BRENT_FRONT_MONTH_FEED_ID (or NEXT_PUBLIC_PYTH_BRENT_FRONT_MONTH_FEED_ID)",
    process.env.PYTH_BRENT_FRONT_MONTH_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_BRENT_FRONT_MONTH_FEED_ID,
  );
}
export function pythQqqFeedId(): string {
  return pickStatic(
    "PYTH_QQQ_FEED_ID (or NEXT_PUBLIC_PYTH_QQQ_FEED_ID)",
    process.env.PYTH_QQQ_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_QQQ_FEED_ID,
  );
}
// NVDA/USD — Equity.US.NVDA/USD RTH variant on hermes-beta. Mirrors the QQQ
// wiring (RTH-only feed, no ON/PRE/POST suffix). Beta channel feed id:
// 0x16e38262485de554be6a09b0c1d4d86eb2151a7af265f867d769dee359cec32e.
export function pythNvdaFeedId(): string {
  return pickStatic(
    "PYTH_NVDA_FEED_ID (or NEXT_PUBLIC_PYTH_NVDA_FEED_ID)",
    process.env.PYTH_NVDA_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_NVDA_FEED_ID,
  );
}
export function pythEurUsdFeedId(): string {
  return pickStatic(
    "PYTH_EURUSD_FEED_ID (or NEXT_PUBLIC_PYTH_EURUSD_FEED_ID)",
    process.env.PYTH_EURUSD_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_EURUSD_FEED_ID,
  );
}
export function pythUsdJpyFeedId(): string {
  return pickStatic(
    "PYTH_USDJPY_FEED_ID (or NEXT_PUBLIC_PYTH_USDJPY_FEED_ID)",
    process.env.PYTH_USDJPY_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_USDJPY_FEED_ID,
  );
}
export function pythUsdCnhFeedId(): string {
  return pickStatic(
    "PYTH_USDCNH_FEED_ID (or NEXT_PUBLIC_PYTH_USDCNH_FEED_ID)",
    process.env.PYTH_USDCNH_FEED_ID,
    process.env.NEXT_PUBLIC_PYTH_USDCNH_FEED_ID,
  );
}

/* ---------------------------------------------------------------------------
 * T4-03 — Types
 * ------------------------------------------------------------------------ */

export type Address = string;
export type CaseId = bigint;

/** Case lifecycle state (matches Move enum; 3 = drained). */
export type CaseStateCode = 0 | 1 | 2 | 3;
/** Resolved outcome (matches Move `case_vault.move:51-54`).
 *  0 = YES, 1 = NO, 2 = INVALID, 255 = UNSET (no resolution yet). */
export type OutcomeCode = 0 | 1 | 2 | 255;

export interface CaseState {
  caseId: CaseId;
  vaultAddress: Address;
  yesReserve: bigint;
  noReserve: bigint;
  state: CaseStateCode;
  resolvedOutcome: OutcomeCode;
  adminAddr: Address;
  closeTime: bigint; // unix seconds
  feeBps: number;
  strikePrice: bigint;
  marketType: number;
  thresholdType: number;
  maxTradeBps: number;
  maxStalenessSec: number;
  assetPythFeedId: string; // hex
  /** MarketConfig.recurring_group_id: Option<vector<u8>>. Decoded as the
   *  UTF-8 group id string when `Some`, else `null`. Use this (not feed id)
   *  to match a case back to its spec — up/down groups share one feed. */
  recurringGroupId: string | null;
  yesMetadata?: Address; // derived from vault, used by T4-06
  noMetadata?: Address;
}

export interface BoughtEvent {
  caseId: CaseId;
  trader: Address;
  side: "yes" | "no";
  amountIn: bigint;
  sharesOut: bigint;
  timestamp: bigint;
}
export interface SoldEvent {
  caseId: CaseId;
  trader: Address;
  side: "yes" | "no";
  sharesIn: bigint;
  amountOut: bigint;
  timestamp: bigint;
}
export interface ClaimedEvent {
  caseId: CaseId;
  trader: Address;
  payout: bigint;
  timestamp: bigint;
}
export interface ResolvedEvent {
  caseId: CaseId;
  outcome: OutcomeCode;
  strikePrice: bigint;
  observedPrice: bigint;
  timestamp: bigint;
}
export interface PausedEvent {
  caseId: CaseId;
  paused: boolean;
  timestamp: bigint;
}
export interface DrainedEvent {
  caseId: CaseId;
  drainedAmount: bigint;
  timestamp: bigint;
}
export interface LiquiditySeededEvent {
  caseId: CaseId;
  yesSeed: bigint;
  noSeed: bigint;
  timestamp: bigint;
}
export interface FaucetClaimedEvent {
  recipient: Address;
  amount: bigint;
  timestamp: bigint;
}
export interface CaseCreatedEvent {
  caseId: CaseId;
  vaultAddress: Address;
  strikePrice: bigint;
  closeTime: bigint;
}
// Canonical shape matching move/basement/sources/market_factory.move L77-86.
// `market_factory::MarketCreatedEvent` carries all fields needed to
// materialize a RECURRING DB row from the spawn tx.
export interface MarketCreatedEvent {
  caseId: bigint;
  vaultAddr: Address;
  assetPythFeedId: string;               // 0x-prefixed hex of vector<u8>
  strikePrice: bigint;
  closeTime: bigint;                     // unix seconds
  marketType: number;                    // u8
  thresholdType: number;                 // u8
  recurringGroupId: string | null;       // decoded from Option<vector<u8>>; utf8 if printable, else hex
}

export interface ResolvedEventData {
  caseId: bigint;
  outcome: 0 | 1 | 2;                    // 0=YES, 1=NO, 2=INVALID
}

/** Result shape of simulate* helpers. */
export interface SimulateResult {
  expectedSharesOut: bigint;
  priceImpactBps: number;
  gasEstimate: bigint;
}

/* Hex + bigint helpers ---------------------------------------------------- */

export function toHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  return BigInt(v);
}

/* ---------------------------------------------------------------------------
 * T4-07..T4-11 — Transaction payload shape
 * ------------------------------------------------------------------------ */

/** Mirror of @aptos-labs/ts-sdk InputTransactionData (wallet-adapter consumes). */
export interface InputTransactionData {
  data: {
    function: `${string}::${string}::${string}`;
    typeArguments: string[];
    functionArguments: unknown[];
  };
  options?: {
    maxGasAmount?: number;
    gasUnitPrice?: number;
    expireTimestamp?: number;
  };
  withFeePayer?: boolean;
}

function entryFn(
  moduleName: string,
  fn: string,
): `${string}::${string}::${string}` {
  return `${moduleAddress()}::${moduleName}::${fn}` as `${string}::${string}::${string}`;
}

/* ---------------------------------------------------------------------------
 * T4-04 — readCaseState
 * ------------------------------------------------------------------------ */

/**
 * Parse a raw CaseVault Move resource into our CaseState shape. Exposed for
 * test fixtures (T4-12) — accepts either the raw `data` object or the full
 * MoveResource envelope.
 */
export function parseCaseVaultResource(
  caseId: CaseId,
  vaultAddress: Address,
  resource: MoveResource | Record<string, unknown>,
): CaseState {
  const data = (resource as { data?: Record<string, unknown> }).data
    ? ((resource as { data: Record<string, unknown> }).data)
    : (resource as Record<string, unknown>);

  const pick = (k: string): unknown => data[k];
  const big = (k: string): bigint => toBigInt(pick(k) as string | number | bigint);
  const num = (k: string): number => Number(pick(k));

  // Move's `Option<vector<u8>>` serializes as `{ vec: ["0x..."] }` (Some) or
  // `{ vec: [] }` (None). Decode the hex bytes back to the original UTF-8
  // group id string so callers can match against the registry directly.
  const rawGroupOpt = pick("recurring_group_id") as
    | { vec?: unknown[] }
    | undefined;
  let recurringGroupId: string | null = null;
  const vec = rawGroupOpt?.vec;
  if (Array.isArray(vec) && vec.length > 0) {
    const hex = String(vec[0]).replace(/^0x/, "");
    try {
      const bytes = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
      );
      recurringGroupId = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      recurringGroupId = null;
    }
  }

  return {
    caseId,
    vaultAddress,
    yesReserve: big("yes_reserve"),
    noReserve: big("no_reserve"),
    state: num("state") as CaseStateCode,
    resolvedOutcome: num("resolved_outcome") as OutcomeCode,
    adminAddr: String(pick("admin_addr")),
    closeTime: big("close_time"),
    feeBps: num("fee_bps"),
    strikePrice: big("strike_price"),
    marketType: num("market_type"),
    thresholdType: num("threshold_type"),
    maxTradeBps: num("max_trade_bps"),
    maxStalenessSec: num("max_staleness_sec"),
    assetPythFeedId: String(pick("asset_pyth_feed_id")),
    recurringGroupId,
    yesMetadata: pick("yes_metadata")
      ? String(
          (pick("yes_metadata") as { inner?: string }).inner ??
            pick("yes_metadata"),
        )
      : undefined,
    noMetadata: pick("no_metadata")
      ? String(
          (pick("no_metadata") as { inner?: string }).inner ?? pick("no_metadata"),
        )
      : undefined,
  };
}

/** Read case state from chain. `CaseVault` + `MarketConfig` live at the
 *  same object address; parse merges both so callers get a single shape.
 *
 *  Cached 60s under `caseState:${caseId}` to avoid the 2-RPC fanout
 *  (1 view + 1 getAccountResources) being repeated within a single cron
 *  tick across spawn-recurring / resolve-onchain / markets-query that
 *  read the same case. Invalidate on trade/settle (see `/api/bet`,
 *  `/api/sell`, `/api/cron/tick::resolveCase`).
 */
export async function readCaseState(
  caseId: CaseId,
  client: Aptos = aptos,
): Promise<CaseState> {
  return cachedView(
    `caseState:${caseId}`,
    60_000,
    () => readCaseStateUncached(caseId, client),
  );
}

async function readCaseStateUncached(
  caseId: CaseId,
  client: Aptos,
): Promise<CaseState> {
  const [vaultAddress] = await client.view<[string]>({
    payload: {
      function: entryFn("market_factory", "get_vault_address"),
      typeArguments: [],
      functionArguments: [caseId.toString()],
    } satisfies InputViewFunctionData,
  });
  // Single getAccountResources call (1 RPC) to fetch all resources on the
  // vault address, then locate CaseVault + MarketConfig client-side. Saves
  // 1 RPC vs. two parallel getAccountResource calls and is the only batch
  // pattern the Aptos REST API exposes.
  const vaultCaseType =
    `${moduleAddress()}::case_vault::CaseVault` as const;
  const vaultConfigType =
    `${moduleAddress()}::case_vault::MarketConfig` as const;
  const all = await client.getAccountResources({
    accountAddress: vaultAddress,
  });
  const vaultRes = all.find((r) => r.type === vaultCaseType);
  const configRes = all.find((r) => r.type === vaultConfigType);
  if (!vaultRes || !configRes) {
    throw new Error(
      `[readCaseState] vault ${vaultAddress} missing required resources: ${
        !vaultRes ? "CaseVault " : ""
      }${!configRes ? "MarketConfig" : ""}`.trim(),
    );
  }
  const vaultData =
    (vaultRes as { data?: Record<string, unknown> }).data ??
    (vaultRes as Record<string, unknown>);
  const configData =
    (configRes as { data?: Record<string, unknown> }).data ??
    (configRes as Record<string, unknown>);
  return parseCaseVaultResource(caseId, vaultAddress, {
    ...configData,
    ...vaultData,
  });
}

/**
 * Read the active case id for a market group, or null if no active case.
 * Cached 60s under `activeMarket:${groupId}` so the same per-tick read
 * across spawn-recurring / resolve-onchain / markets-query / use-active-case
 * shares one RPC. Invalidated on spawn / resolve / clear (call sites in
 * the cron routes after successful tx).
 */
export async function getActiveCaseIdForGroup(
  groupId: string,
  client: Aptos = aptos,
): Promise<bigint | null> {
  return cachedView(
    `activeMarket:${groupId}`,
    60_000,
    () => getActiveCaseIdUncached(groupId, client),
  );
}

async function getActiveCaseIdUncached(
  groupId: string,
  client: Aptos,
): Promise<bigint | null> {
  const groupBytes = Array.from(new TextEncoder().encode(groupId));
  const [opt] = (await client.view({
    payload: {
      function: entryFn("market_factory", "get_active_market_in_group"),
      typeArguments: [],
      functionArguments: [groupBytes],
    } satisfies InputViewFunctionData,
  })) as [{ vec?: unknown[] }];
  const vec = opt?.vec;
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return BigInt(vec[0] as string);
}

/* ---------------------------------------------------------------------------
 * T4-05 — readUserVirtualUsdBalance
 * ------------------------------------------------------------------------ */

export async function readUserVirtualUsdBalance(
  addr: Address,
  client: Aptos = aptos,
): Promise<bigint> {
  const [raw] = await client.view<[string]>({
    payload: {
      function: "0x1::primary_fungible_store::balance",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [addr, virtualUsdMetadataAddress()],
    } satisfies InputViewFunctionData,
  });
  return toBigInt(raw);
}

/* ---------------------------------------------------------------------------
 * T4-06 — readUserYesFa / readUserNoFa
 * ------------------------------------------------------------------------ */

async function faBalance(
  owner: Address,
  metadata: Address,
  client: Aptos,
): Promise<bigint> {
  const [raw] = await client.view<[string]>({
    payload: {
      function: "0x1::primary_fungible_store::balance",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [owner, metadata],
    } satisfies InputViewFunctionData,
  });
  return toBigInt(raw);
}

export async function readUserYesFa(
  addr: Address,
  caseId: CaseId,
  client: Aptos = aptos,
): Promise<bigint> {
  const state = await readCaseState(caseId, client);
  if (!state.yesMetadata) {
    throw new Error(
      `[aptos.ts] case ${caseId} has no yes_metadata — CaseVault resource missing field`,
    );
  }
  return faBalance(addr, state.yesMetadata, client);
}

export async function readUserNoFa(
  addr: Address,
  caseId: CaseId,
  client: Aptos = aptos,
): Promise<bigint> {
  const state = await readCaseState(caseId, client);
  if (!state.noMetadata) {
    throw new Error(
      `[aptos.ts] case ${caseId} has no no_metadata — CaseVault resource missing field`,
    );
  }
  return faBalance(addr, state.noMetadata, client);
}

/* ---------------------------------------------------------------------------
 * Tx-event fetchers — parse `market_factory::MarketCreatedEvent` and
 * `case_vault::ResolvedEvent` from a committed transaction. Used by
 * spawn-recurring / resolve-onchain cron to materialize DB state from
 * authoritative on-chain events.
 * ------------------------------------------------------------------------ */

function decodeOptionBytes(value: unknown): string | null {
  // Move `Option<vector<u8>>` serializes to `{ vec: ["0x..."] }` (some) or
  // `{ vec: [] }` (none) in JSON. Raw vectors can also arrive as hex strings
  // directly on older nodes.
  if (value == null) return null;
  if (typeof value === "string") return decodeVectorU8Bytes(value);
  if (typeof value === "object") {
    const vec = (value as { vec?: unknown }).vec;
    if (Array.isArray(vec) && vec.length > 0 && typeof vec[0] === "string") {
      return decodeVectorU8Bytes(vec[0]);
    }
    return null;
  }
  return null;
}

function decodeVectorU8Bytes(hex: string): string | null {
  if (!hex) return null;
  try {
    const bytes = fromHex(hex);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Only treat as UTF-8 string if fully printable ASCII/UTF-8; otherwise
    // keep hex so callers can still compare.
    if (/^[\x20-\x7E]+$/.test(text)) return text;
    return hex.toLowerCase();
  } catch {
    return hex.toLowerCase();
  }
}

export async function fetchMarketCreatedEventsForTxn(
  txnHash: string,
  client: Aptos = aptos,
): Promise<MarketCreatedEvent[]> {
  const matchType = `${moduleAddress()}::market_factory::MarketCreatedEvent`;
  const txn = await client.getTransactionByHash({ transactionHash: txnHash });
  const events = (txn as { events?: Array<{ type: string; data: unknown }> }).events ?? [];
  const out: MarketCreatedEvent[] = [];
  for (const ev of events) {
    if (ev.type !== matchType) continue;
    const d = ev.data as Record<string, unknown>;
    out.push({
      caseId: BigInt(d.case_id as string | number),
      vaultAddr: String(d.vault_addr),
      assetPythFeedId: String(d.asset_pyth_feed_id ?? ""),
      strikePrice: BigInt(d.strike_price as string | number),
      closeTime: BigInt(d.close_time as string | number),
      marketType: Number(d.market_type ?? 0),
      thresholdType: Number(d.threshold_type ?? 0),
      recurringGroupId: decodeOptionBytes(d.recurring_group_id),
    });
  }
  return out;
}

export async function fetchResolvedEventForTxn(
  txnHash: string,
  client: Aptos = aptos,
): Promise<ResolvedEventData | null> {
  const matchType = `${moduleAddress()}::case_vault::ResolvedEvent`;
  const txn = await client.getTransactionByHash({ transactionHash: txnHash });
  const events = (txn as { events?: Array<{ type: string; data: unknown }> }).events ?? [];
  for (const ev of events) {
    if (ev.type !== matchType) continue;
    const d = ev.data as Record<string, unknown>;
    const raw = Number(d.outcome ?? 0);
    const outcome = (raw === 0 ? 0 : raw === 1 ? 1 : 2) as 0 | 1 | 2;
    return {
      caseId: BigInt(d.case_id as string | number),
      outcome,
    };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * T4-07 — buy builders + simulate
 * ------------------------------------------------------------------------ */

function buildBuyTxn(
  fn: "buy_yes" | "buy_no",
  caseId: CaseId,
  amountIn: bigint,
  minSharesOut: bigint,
): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", fn),
      typeArguments: [],
      functionArguments: [
        caseId.toString(),
        amountIn.toString(),
        minSharesOut.toString(),
      ],
    },
  };
}

export function buildBuyYesTxn(
  caseId: CaseId,
  amountIn: bigint,
  minSharesOut: bigint,
): InputTransactionData {
  return buildBuyTxn("buy_yes", caseId, amountIn, minSharesOut);
}

export function buildBuyNoTxn(
  caseId: CaseId,
  amountIn: bigint,
  minSharesOut: bigint,
): InputTransactionData {
  return buildBuyTxn("buy_no", caseId, amountIn, minSharesOut);
}

/**
 * Compute priceImpactBps from simulator gas used + reserves.
 * For now we approximate priceImpactBps as `amountIn / reserve * 10000`
 * (reserves read from the CaseVault alongside the simulation).
 */
async function simulateBuy(
  fn: "buy_yes" | "buy_no",
  sender: Address,
  caseId: CaseId,
  amountIn: bigint,
  client: Aptos,
): Promise<SimulateResult> {
  const state = await readCaseState(caseId, client);
  const txn = await client.transaction.build.simple({
    sender,
    data: {
      function: entryFn("case_vault", fn),
      typeArguments: [],
      functionArguments: [caseId.toString(), amountIn.toString(), "0"],
    },
  });
  const [sim] = await client.transaction.simulate.simple({ transaction: txn });
  // Move-aligned CPMM quote (pure bigint ≡ Move u128):
  //   fee: case_vault.move:563 — amount_in_after_fee = amount_in * (10000 - fee_bps) / 10000
  //   CPMM: case_vault.move:470-483,567-596 —
  //     buy_yes → reserve_in = no_reserve (grows), reserve_out = yes_reserve (shrinks)
  //     buy_no  → reserve_in = yes_reserve,        reserve_out = no_reserve
  //     k = reserve_in * reserve_out;
  //     new_reserve_out = k / (reserve_in + amount_in_after_fee);
  //     shares = reserve_out - new_reserve_out.
  const BPS_BASE = 10_000n;
  const feeBpsBig = BigInt(state.feeBps);
  const amountInAfterFee = (amountIn * (BPS_BASE - feeBpsBig)) / BPS_BASE;

  const reserveIn = fn === "buy_yes" ? state.noReserve : state.yesReserve;
  const reserveOut = fn === "buy_yes" ? state.yesReserve : state.noReserve;

  let expectedSharesOut = 0n;
  if (reserveIn > 0n && reserveOut > 0n) {
    const k = reserveIn * reserveOut;
    const newReserveIn = reserveIn + amountInAfterFee;
    const newReserveOut = newReserveIn === 0n ? reserveOut : k / newReserveIn;
    expectedSharesOut =
      reserveOut > newReserveOut ? reserveOut - newReserveOut : 0n;
  }

  // priceImpactBps: amountIn / (reserveOut + amountInAfterFee) * 10000, bounded ≤ 10000 → Number safe.
  const priceImpactBps =
    reserveOut === 0n
      ? 0
      : Number((amountIn * 10_000n) / (reserveOut + amountInAfterFee));
  const gasEstimate = toBigInt(
    (sim as { gas_used?: string | number }).gas_used ?? 0,
  );
  return { expectedSharesOut, priceImpactBps, gasEstimate };
}

export function simulateBuyYes(
  sender: Address,
  caseId: CaseId,
  amountIn: bigint,
  client: Aptos = aptos,
): Promise<SimulateResult> {
  return simulateBuy("buy_yes", sender, caseId, amountIn, client);
}

export function simulateBuyNo(
  sender: Address,
  caseId: CaseId,
  amountIn: bigint,
  client: Aptos = aptos,
): Promise<SimulateResult> {
  return simulateBuy("buy_no", sender, caseId, amountIn, client);
}

/* ---------------------------------------------------------------------------
 * T4-08 — sell builders
 * ------------------------------------------------------------------------ */

function buildSellTxn(
  fn: "sell_yes" | "sell_no",
  caseId: CaseId,
  sharesIn: bigint,
  minVirtualUsdOut: bigint,
): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", fn),
      typeArguments: [],
      functionArguments: [
        caseId.toString(),
        sharesIn.toString(),
        minVirtualUsdOut.toString(),
      ],
    },
  };
}

export function buildSellYesTxn(
  caseId: CaseId,
  sharesIn: bigint,
  minVirtualUsdOut: bigint,
): InputTransactionData {
  return buildSellTxn("sell_yes", caseId, sharesIn, minVirtualUsdOut);
}

export function buildSellNoTxn(
  caseId: CaseId,
  sharesIn: bigint,
  minVirtualUsdOut: bigint,
): InputTransactionData {
  return buildSellTxn("sell_no", caseId, sharesIn, minVirtualUsdOut);
}

/* ---------------------------------------------------------------------------
 * T4-09 — claim winnings
 * ------------------------------------------------------------------------ */

export function buildClaimWinningsTxn(caseId: CaseId): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", "claim_winnings"),
      typeArguments: [],
      functionArguments: [caseId.toString()],
    },
  };
}

/** Faucet claim — the canonical sponsored-gas entrypoint. */
export function buildClaimFaucetTxn(): InputTransactionData {
  return {
    data: {
      function: entryFn("virtual_usd", "claim_faucet"),
      typeArguments: [],
      functionArguments: [],
    },
  };
}

/* ---------------------------------------------------------------------------
 * T4-10 — Sponsored gas + Pyth + resolve
 * ------------------------------------------------------------------------ */

/**
 * Hardcoded allowlist of inner entry functions permitted inside a sponsored
 * transaction. Keeping this in code (not env) in Session A so the gate is
 * part of the audited diff. Session B may promote to on-chain allowlist.
 */
export const SPONSORED_INNER_ENTRY_ALLOWLIST: ReadonlyArray<string> = [
  "basement::virtual_usd::claim_faucet",
  "basement::case_vault::claim_winnings",
] as const;

/**
 * Strip module-address prefix if present so allowlist matching is address
 * agnostic (Session B deploy address will differ from Session A stub).
 */
function normalizeInnerEntry(fullName: string): string {
  // "0xMODULE::virtual_usd::claim_faucet" → "basement::virtual_usd::claim_faucet"
  const parts = fullName.split("::");
  if (parts.length === 3) return `basement::${parts[1]}::${parts[2]}`;
  return fullName;
}

export function isInnerEntryAllowed(fullName: string): boolean {
  return SPONSORED_INNER_ENTRY_ALLOWLIST.includes(normalizeInnerEntry(fullName));
}

export interface BuildSponsoredInput {
  sender: Address;
  /** Inner entry call (use one of the helper builders above). */
  inner: InputTransactionData;
  /** Defaults to true; explicit flag so tests can assert. */
  withFeePayer?: boolean;
  /** Optional expiry override (seconds). Defaults to now+60. */
  expireTimestampSec?: number;
}

export interface SponsoredTxnOutput {
  data: InputTransactionData["data"];
  options: { expireTimestamp: number };
  withFeePayer: true;
  sender: Address;
}

/**
 * Build a sponsored (fee_payer) transaction payload. Validates that the inner
 * entry function is in {@link SPONSORED_INNER_ENTRY_ALLOWLIST}, enforces
 * `withFeePayer: true`, and sets a 60-second expiry (Hermes VAA / wallet
 * prompt round-trip buffer; see red-line note in core-apis.md §5).
 *
 * NOTE: We do NOT submit here. Submit uses `aptos.transaction.submit.simple`
 * (not `multiAgent`) with both `senderAuthenticator` and `feePayerAuthenticator`
 * — that call lives in the server route (Session E).
 */
export function buildSponsoredTxn(input: BuildSponsoredInput): SponsoredTxnOutput {
  const fnName = input.inner.data.function;
  if (!isInnerEntryAllowed(fnName)) {
    throw new Error(
      `[aptos.ts] Sponsored tx rejected: inner entry "${fnName}" is not in the ` +
        `SPONSORED_INNER_ENTRY_ALLOWLIST. Allowed: ${SPONSORED_INNER_ENTRY_ALLOWLIST.join(", ")}`,
    );
  }
  const expireTimestamp =
    input.expireTimestampSec ?? Math.floor(Date.now() / 1000) + 60;
  return {
    sender: input.sender,
    data: input.inner.data,
    options: { expireTimestamp },
    withFeePayer: true,
  };
}

/* ---- Pyth Hermes VAA fetch ---------------------------------------------- */

/**
 * Fetch a single VAA for a Pyth feed. Hermes returns `binary.data` as an
 * array of base64 strings — RED FLAG: for single-feed queries it is always
 * length 1 (Wormhole batch wrapper). Do NOT iterate.
 *
 * NO CACHE: resolve_oracle requires the VAA's `publish_time >= close_time`;
 * a cached pre-close VAA would fail Move's staleness check with
 * `E_STALE_PRICE`. Hermes round-trip is ~200-300ms — cheap enough to always
 * fetch fresh.
 */
/**
 * Fetch the parsed current price for a Pyth feed. Returns price at Pyth's
 * canonical 1e8 exponent (crypto convention). Used by off-chain resolvers
 * (`admin_resolve` path) to compute outcome without submitting a VAA update
 * on-chain — avoids Pyth Move module format incompatibilities.
 */
export async function fetchPythPrice(
  feedId: string,
): Promise<{ price: bigint; publishTime: number; expo: number }> {
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const url = `${pythHermesUrl()}/v2/updates/price/latest?ids[]=${id}&encoding=base64`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[aptos.ts] Pyth Hermes fetch failed: ${res.status} ${res.statusText} for feedId ${feedId}`,
    );
  }
  const body = (await res.json()) as {
    parsed?: Array<{
      price?: { price?: string; publish_time?: number; expo?: number };
    }>;
  };
  const parsed = body.parsed?.[0]?.price;
  if (!parsed?.price) {
    throw new Error(`[aptos.ts] Pyth Hermes returned no parsed price for ${feedId}`);
  }
  const price = BigInt(parsed.price);
  if (price <= 0n) {
    throw new Error(`[aptos.ts] Pyth Hermes returned non-positive price ${parsed.price}`);
  }
  // expo is typically -8 for crypto spot, -3 for XAU spot; caller must use it
  // to produce a human-readable decimal (rawPrice * 10^expo).
  return {
    price,
    publishTime: parsed.publish_time ?? 0,
    expo: parsed.expo ?? -8,
  };
}

export async function getPythVAA(feedId: string): Promise<Uint8Array> {
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  // Use the Pyth Hermes V2 accumulator endpoint — returns a PNAU VAA that
  // the post-2024 Pyth Move module accepts. The stable vs beta channel
  // (mainnet vs Aptos testnet) is determined entirely by PYTH_HERMES_URL
  // + the feed ids that come with it; a stable-channel VAA submitted to
  // Aptos testnet Wormhole aborts 0x6507 because testnet only has
  // guardian_set[0] while stable VAAs are signed by guardian_set[5].
  const url = `${pythHermesUrl()}/v2/updates/price/latest?ids[]=${id}&encoding=base64`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[aptos.ts] Pyth Hermes fetch failed: ${res.status} ${res.statusText} for feedId ${feedId}`,
    );
  }
  const body = (await res.json()) as unknown;
  // Hermes has two shapes depending on endpoint:
  //   /api/latest_vaas     → ["<base64>"]             (array of strings)
  //   /v2/updates/price/...→ { binary: { data: ["<base64>"] }, parsed: [...] }
  let b64: string | undefined;
  if (Array.isArray(body) && typeof body[0] === "string") {
    b64 = body[0] as string;
  } else if (
    body &&
    typeof body === "object" &&
    "binary" in (body as Record<string, unknown>)
  ) {
    const binary = (body as { binary?: { data?: unknown } }).binary;
    if (binary && Array.isArray(binary.data) && typeof binary.data[0] === "string") {
      b64 = binary.data[0] as string;
    }
  }
  if (!b64) {
    throw new Error(
      `[aptos.ts] Pyth Hermes response missing VAA bytes (feedId ${feedId})`,
    );
  }
  return base64ToBytes(b64);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // Browser fallback
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Admin gas budget. Aptos validator pre-reserves
 * `maxGasAmount × gasUnitPrice` from the sender's balance, so leaving it
 * at the SDK default (200k) would need 0.2 APT per submit — painful when
 * testnet faucet rations 1 APT/day.
 *
 * These ceilings are ~2× headroom over observed actuals (measured via
 * `/v1/accounts/:addr/transactions`):
 *   - resolve_oracle          ~955 units
 *   - clear_active_group      ~51 units
 *   - spawn_recurring_3min    ~52,138 units (create CaseVault + seed_liquidity)
 *
 * If a tx hits the ceiling it aborts OUT_OF_GAS — lift the specific
 * builder rather than raising globally.
 */
const ADMIN_MAX_GAS = {
  RESOLVE_ORACLE: 10_000,
  ADMIN_RESOLVE: 5_000,
  ADMIN_PAUSE: 5_000,
  CLEAR_ACTIVE_GROUP: 5_000,
  SPAWN_RECURRING_3MIN: 120_000, // 2x headroom over measured 52k
  CREATE_MARKET: 120_000,
} as const;

/**
 * Admin gas price (octas/unit). Aptos testnet now enforces a minimum of
 * 100 — lower values get rejected at validation with
 * `GAS_UNIT_PRICE_BELOW_MIN_BOUND`. Network's `deprioritized_gas_estimate`
 * is currently 100 (queried 2026-04-25 via /v1/estimate_gas_price); used to
 * be effectively 0, hence the older `gasUnitPrice: 1` setting. Raised here
 * to match the current floor.
 *
 * Cost impact: SPAWN_RECURRING_3MIN ~52k units × 100 = 0.0052 APT/spawn.
 * Admin's 150 APT balance covers ~28k spawns before needing refill.
 *
 * Mainnet stays on SDK default (market-based) since min varies.
 *
 * User-signed txns (Petra/OKX buy/sell/claim) are unaffected — wallets set
 * their own price. This only applies to admin cron txns.
 */
function adminGasUnitPrice(): number | undefined {
  const net = (process.env.APTOS_NETWORK ?? "testnet").toLowerCase();
  return net === "testnet" || net === "devnet" ? 100 : undefined;
}

function adminOptions(maxGasAmount: number) {
  const gasUnitPrice = adminGasUnitPrice();
  return gasUnitPrice !== undefined
    ? { maxGasAmount, gasUnitPrice }
    : { maxGasAmount };
}

/** Build resolve-with-oracle txn (admin / cron). */
export function buildResolveOracleTxn(
  caseId: CaseId,
  vaaBytes: Uint8Array,
): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", "resolve_oracle"),
      typeArguments: [],
      functionArguments: [caseId.toString(), Array.from(vaaBytes)],
    },
    options: adminOptions(ADMIN_MAX_GAS.RESOLVE_ORACLE),
  };
}

/* ---------------------------------------------------------------------------
 * T4-11 — Admin builders (skeleton; Session E wires signing)
 * ------------------------------------------------------------------------ */

export function buildAdminResolveTxn(
  caseId: CaseId,
  outcome: OutcomeCode,
): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", "admin_resolve"),
      typeArguments: [],
      functionArguments: [caseId.toString(), outcome],
    },
    options: adminOptions(ADMIN_MAX_GAS.ADMIN_RESOLVE),
  };
}

/** `admin_pause(admin, case_id)` — one-way OPEN -> CLOSED gate. */
export function buildAdminPauseTxn(caseId: CaseId): InputTransactionData {
  return {
    data: {
      function: entryFn("case_vault", "admin_pause"),
      typeArguments: [],
      functionArguments: [caseId.toString()],
    },
    options: adminOptions(ADMIN_MAX_GAS.ADMIN_PAUSE),
  };
}

/**
 * `market_factory::clear_active_group(admin, group_id)` — removes the
 * active-group table entry so a successor recurring case can spawn.
 * `resolve_oracle` does NOT auto-clear; cron must invoke this after resolve.
 */
export function buildClearActiveGroupTxn(groupId: string): InputTransactionData {
  const groupBytes = Array.from(new TextEncoder().encode(groupId));
  return {
    data: {
      function: entryFn("market_factory", "clear_active_group"),
      typeArguments: [],
      functionArguments: [groupBytes],
    },
    options: adminOptions(ADMIN_MAX_GAS.CLEAR_ACTIVE_GROUP),
  };
}

/**
 * Build `market_factory::spawn_recurring_3min`. Move signature takes
 * `group_id: vector<u8>` so we UTF-8 encode the logical group name
 * (e.g. "btc-3m", "eth-3m"). `feedId` is hex-encoded Pyth bytes32.
 */
export function buildSpawnRecurring3minTxn(
  groupId: string,
  feedId: string,
  currentPrice: bigint,
  tickSize: bigint,
  poolDepth: bigint,
): InputTransactionData {
  const groupBytes = Array.from(new TextEncoder().encode(groupId));
  const feedBytes = Array.from(fromHex(feedId));
  return {
    data: {
      function: entryFn("market_factory", "spawn_recurring_3min"),
      typeArguments: [],
      functionArguments: [
        groupBytes,
        feedBytes,
        currentPrice.toString(),
        tickSize.toString(),
        poolDepth.toString(),
      ],
    },
    options: adminOptions(ADMIN_MAX_GAS.SPAWN_RECURRING_3MIN),
  };
}

/**
 * Build `market_factory::create_market` — the generic recurring-market spawn
 * path used by strike-based groups (e.g. `xau-daily-up`/`-down`). Signature
 * mirrors `create_market` in `move/basement/sources/market_factory.move`.
 *
 * `recurring_group_id: Option<vector<u8>>` is the tricky bit. We wrap with
 * {@link MoveOption} + {@link MoveVector.U8} so the SDK emits the correct
 * nested BCS. **Must run `aptos.transaction.simulate.simple` once before the
 * first live submission** — an encoding miss throws `deserialize failed` on
 * chain with a large gas_used and no emitted events.
 */
export interface CreateMarketParams {
  assetPythFeedId: string; // hex
  strikePriceRaw: bigint; // u64 at feed's Pyth exponent
  closeTimeSec: number; // Unix seconds
  recurringGroupId: string; // UTF-8 group id, gets wrapped as Option::some
  recurringAutoSpawn: boolean;
  recurringDurationSeconds: number;
  marketType: number; // TS-side MARKET_TYPE_* constant (u8)
  thresholdType: 0 | 1; // ABOVE=0, BELOW=1
  feeBps: number; // u64
  poolDepth: bigint; // u64 (FA 1e6 decimals for vUSD)
  maxTradeBps: number; // u64
  maxStalenessSec: number; // u64
  questionHash?: Uint8Array; // defaults to empty
  metadataHash?: Uint8Array; // defaults to empty
}

export function buildCreateMarketTxn(
  params: CreateMarketParams,
): InputTransactionData {
  const feedBytes = Array.from(fromHex(params.assetPythFeedId));
  const groupBytes = new TextEncoder().encode(params.recurringGroupId);
  // Option::some(vector<u8>) via explicit BCS: wrap bytes into MoveVector<U8>,
  // then wrap that into MoveOption. Plain JS arrays are NOT used here — the
  // nested generic type needs explicit BCS so the SDK does not emit a bare
  // vector<u8> where Option is expected.
  const groupOption = new MoveOption<MoveVector<U8>>(
    new MoveVector<U8>(Array.from(groupBytes).map((b) => new U8(b))),
  );
  const questionHash = Array.from(params.questionHash ?? new Uint8Array());
  const metadataHash = Array.from(params.metadataHash ?? new Uint8Array());
  return {
    data: {
      function: entryFn("market_factory", "create_market"),
      typeArguments: [],
      functionArguments: [
        feedBytes, // asset_pyth_feed_id: vector<u8>
        params.strikePriceRaw.toString(), // strike_price: u64
        params.closeTimeSec.toString(), // close_time: u64
        groupOption, // recurring_group_id: Option<vector<u8>>
        params.recurringAutoSpawn, // recurring_auto_spawn: bool
        params.recurringDurationSeconds.toString(), // recurring_duration_seconds: u64
        params.marketType, // market_type: u8
        params.thresholdType, // threshold_type: u8
        params.feeBps.toString(), // fee_bps: u64
        params.poolDepth.toString(), // pool_depth: u64
        params.maxTradeBps.toString(), // max_trade_bps: u64
        params.maxStalenessSec.toString(), // max_staleness_sec: u64
        questionHash, // question_hash: vector<u8>
        metadataHash, // metadata_hash: vector<u8>
      ],
    },
    options: adminOptions(ADMIN_MAX_GAS.CREATE_MARKET),
  };
}

/**
 * INVARIANT: admin-signing path; never moves user VirtualUSD; only mutates
 * market state via on-chain entry functions (spawn_recurring_3min,
 * admin_resolve, admin_pause). Private key loaded call-time from
 * APTOS_ADMIN_PRIVATE_KEY — never at module import, never logged, never
 * returned in responses. Rotation: generate new Ed25519 key via `aptos init`,
 * overwrite `.env` APTOS_ADMIN_PRIVATE_KEY, redeploy.
 */
async function loadAdminSigner() {
  const rawKey = process.env.APTOS_ADMIN_PRIVATE_KEY ?? "";
  if (rawKey.trim() === "" || rawKey.startsWith("0x_")) {
    throw new Error(
      "[aptos.ts] APTOS_ADMIN_PRIVATE_KEY is not configured. " +
        "Add the admin Ed25519 hex key to .env (gitignored) before invoking admin-signing paths.",
    );
  }
  const { Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } =
    await import("@aptos-labs/ts-sdk");
  const hex = PrivateKey.formatPrivateKey(rawKey, PrivateKeyVariants.Ed25519);
  return Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(hex),
  });
}

export async function submitAdminTxn(
  payload: InputTransactionData,
): Promise<{ txnHash: string; success: boolean }> {
  const signer = await loadAdminSigner();
  const transaction = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data: payload.data as InputEntryFunctionData,
    options: {
      expireTimestamp: Math.floor(Date.now() / 1000) + 60,
      ...(payload.options?.maxGasAmount !== undefined
        ? { maxGasAmount: payload.options.maxGasAmount }
        : {}),
      ...(payload.options?.gasUnitPrice !== undefined
        ? { gasUnitPrice: payload.options.gasUnitPrice }
        : {}),
    },
  });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction });
  const result = await aptos.waitForTransaction({
    transactionHash: pending.hash,
    options: { timeoutSecs: 30 },
  });
  return { txnHash: pending.hash, success: Boolean(result.success) };
}

/**
 * Parallel admin tx batch. Fetches admin seq once, assigns monotonic
 * `accountSequenceNumber` per payload, submits serially (fast — HTTP only),
 * then awaits confirmations in parallel. On-chain executes strictly in seq
 * order, so callers can rely on N-th payload having observed the (N-1)-th
 * payload's state mutation.
 *
 * Per Aptos docs (see plan docs-synthesis): field name is
 * `accountSequenceNumber`, NOT `sequenceNumber`. Type is AnyNumber.
 */
export type AdminTxnResult = {
  txnHash: string | null;
  success: boolean;
  error?: string;
};

export async function submitAdminTxnsParallel(
  payloads: InputTransactionData[],
): Promise<AdminTxnResult[]> {
  if (payloads.length === 0) return [];
  if (payloads.length === 1) {
    try {
      const r = await submitAdminTxn(payloads[0]);
      return [r];
    } catch (err) {
      return [{ txnHash: null, success: false, error: (err as Error).message }];
    }
  }

  const signer = await loadAdminSigner();
  const info = await aptos.getAccountInfo({
    accountAddress: signer.accountAddress,
  });
  const baseSeq = BigInt(info.sequence_number);
  const expireAt = Math.floor(Date.now() / 1000) + 60;

  const txns = await Promise.all(
    payloads.map((payload, i) =>
      aptos.transaction.build.simple({
        sender: signer.accountAddress,
        data: payload.data as InputEntryFunctionData,
        options: {
          accountSequenceNumber: baseSeq + BigInt(i),
          expireTimestamp: expireAt,
          // Per-builder gas budget override (e.g. ADMIN_MAX_GAS.*).
          // Without this, the SDK defaults maxGasAmount to 200k which
          // pre-reserves 0.2 APT per tx and bricks the admin wallet on a
          // rationed testnet faucet.
          ...(payload.options?.maxGasAmount !== undefined
            ? { maxGasAmount: payload.options.maxGasAmount }
            : {}),
          ...(payload.options?.gasUnitPrice !== undefined
            ? { gasUnitPrice: payload.options.gasUnitPrice }
            : {}),
        },
      }),
    ),
  );

  // Submit serially (fast HTTP) — avoids out-of-order fullnode submit
  // behavior (Aptos docs silent on buffering). Wait phase is parallel.
  const pending: Array<{ hash: string | null; error?: string }> = [];
  for (const tx of txns) {
    try {
      const p = await aptos.signAndSubmitTransaction({ signer, transaction: tx });
      pending.push({ hash: p.hash });
    } catch (err) {
      pending.push({ hash: null, error: (err as Error).message });
    }
  }

  return Promise.all(
    pending.map(async (p): Promise<AdminTxnResult> => {
      if (p.hash === null) {
        return { txnHash: null, success: false, error: p.error };
      }
      try {
        const r = await aptos.waitForTransaction({
          transactionHash: p.hash,
          options: { timeoutSecs: 15, checkSuccess: false },
        });
        const success = Boolean(r.success);
        if (!success) {
          const vmStatus = (r as { vm_status?: string }).vm_status;
          return {
            txnHash: p.hash,
            success: false,
            error: vmStatus ? `tx aborted: ${vmStatus}` : "tx aborted (no vm_status)",
          };
        }
        return { txnHash: p.hash, success: true };
      } catch (err) {
        return { txnHash: p.hash, success: false, error: (err as Error).message };
      }
    }),
  );
}
