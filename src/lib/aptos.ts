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
 *  - Admin tx builder skeletons — no private key reads here; `submitAdminTxn`
 *    is a stub that throws until Session E wires `APTOS_ADMIN_PRIVATE_KEY`
 *    (T4-11)
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
 * STUB addresses (grep "STUB:" — Session B will replace):
 *   BASEMENT_MODULE_ADDRESS, VIRTUAL_USD_METADATA_ADDRESS, ADMIN_ADDRESS,
 *   PYTH_BTC_FEED_ID, PYTH_ETH_FEED_ID.
 */

import {
  Aptos,
  AptosConfig,
  Network,
  type InputViewFunctionData,
  type MoveResource,
} from "@aptos-labs/ts-sdk";

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

/** Return (memoized) an Aptos client bound to the requested network. */
export function getAptos(network?: AptosNetwork | Network): Aptos {
  const net =
    typeof network === "string" || network === undefined
      ? resolveNetwork(network as string | undefined)
      : network;
  const cached = _aptosCache.get(net);
  if (cached) return cached;
  const fullnode = process.env.APTOS_FULLNODE_URL || undefined;
  const cfg = new AptosConfig({ network: net, fullnode });
  const client = new Aptos(cfg);
  _aptosCache.set(net, client);
  return client;
}

/** Default client (v0 == testnet). Lazy: constructor is pure, no network I/O. */
export const aptos: Aptos = getAptos();

/**
 * Runtime chainId fetch (R-4). Callers should use this rather than hardcode.
 * Cached per-client after first successful read.
 */
const _chainIdCache = new WeakMap<Aptos, number>();
export async function getChainId(client: Aptos = aptos): Promise<number> {
  const hit = _chainIdCache.get(client);
  if (hit !== undefined) return hit;
  const info = await client.getLedgerInfo();
  const id = Number((info as { chain_id: number | string }).chain_id);
  _chainIdCache.set(client, id);
  return id;
}

/* ---------------------------------------------------------------------------
 * T4-02 — Lazy env validation
 * ------------------------------------------------------------------------ */

const STUB = "0x_STUB_REPLACE_IN_SESSION_B"; // STUB: Session B replaces

/** Throw a helpful error naming the env var if it is unset or still a stub. */
function requireEnv(name: string, allowStub = false): string {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    throw new Error(
      `[aptos.ts] Required env var ${name} is not set. ` +
        `Add it to .env.local (see .env.example). ` +
        `Session B will fill in the real address after Move deploy.`,
    );
  }
  if (!allowStub && raw === STUB) {
    throw new Error(
      `[aptos.ts] Env var ${name} is still the Session A stub "${STUB}". ` +
        `Session B must replace this with the deployed Move address before builders can run.`,
    );
  }
  return raw;
}

/** Module address (e.g. `0xabc...` — basement core modules live here). */
// STUB: BASEMENT_MODULE_ADDRESS defaults to 0x_STUB_REPLACE_IN_SESSION_B until Move deploy.
export function moduleAddress(): string {
  return requireEnv("BASEMENT_MODULE_ADDRESS");
}
/** Virtual USD Fungible Asset metadata object address. */
// STUB: VIRTUAL_USD_METADATA_ADDRESS defaults to 0x_STUB_REPLACE_IN_SESSION_B until FA deploy.
export function virtualUsdMetadataAddress(): string {
  return requireEnv("VIRTUAL_USD_METADATA_ADDRESS");
}
/** Public admin address (sponsor / resolver). Private key NEVER read here. */
// STUB: ADMIN_ADDRESS defaults to 0x_STUB_REPLACE_IN_SESSION_B until sponsor account provisioned.
export function adminAddress(): string {
  return requireEnv("ADMIN_ADDRESS");
}
/** Pyth Hermes base URL — always defaults to public relay. */
export function pythHermesUrl(): string {
  return process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";
}
// STUB: PYTH_BTC_FEED_ID defaults to 0x_STUB_REPLACE_IN_SESSION_B — replace with
// real feed id `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` in Session B.
export function pythBtcFeedId(): string {
  return requireEnv("PYTH_BTC_FEED_ID");
}
// STUB: PYTH_ETH_FEED_ID defaults to 0x_STUB_REPLACE_IN_SESSION_B — replace with
// real feed id `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` in Session B.
export function pythEthFeedId(): string {
  return requireEnv("PYTH_ETH_FEED_ID");
}

/* ---------------------------------------------------------------------------
 * T4-03 — Types
 * ------------------------------------------------------------------------ */

export type Address = string;
export type CaseId = bigint;

/** Case lifecycle state (matches Move enum; 3 = drained). */
export type CaseStateCode = 0 | 1 | 2 | 3;
/** Resolved outcome: 0 = unresolved, 1 = YES, 2 = NO. */
export type OutcomeCode = 0 | 1 | 2;

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
export interface MarketCreatedEvent {
  groupId: bigint;
  feedId: string;
  tickSize: bigint;
  poolDepth: bigint;
  timestamp: bigint;
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

/** Read case state from chain. */
export async function readCaseState(
  caseId: CaseId,
  client: Aptos = aptos,
): Promise<CaseState> {
  const [vaultAddress] = await client.view<[string]>({
    payload: {
      function: entryFn("market_factory", "get_vault_address"),
      typeArguments: [],
      functionArguments: [caseId.toString()],
    } satisfies InputViewFunctionData,
  });
  const resource = await client.getAccountResource({
    accountAddress: vaultAddress,
    resourceType:
      `${moduleAddress()}::case_vault::CaseVault` as `${string}::${string}::${string}`,
  });
  return parseCaseVaultResource(caseId, vaultAddress, resource);
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
  // Shares-out is emitted as a return-or-event — Move entry fns don't return,
  // so approximation via constant-product reserve math is fine for UX.
  const reserve = fn === "buy_yes" ? state.yesReserve : state.noReserve;
  const k = state.yesReserve * state.noReserve;
  const otherReserve = fn === "buy_yes" ? state.noReserve : state.yesReserve;
  // new_other = k / (reserve + amountIn) ; expectedSharesOut = other - new_other
  const newOther =
    reserve + amountIn === 0n ? otherReserve : k / (reserve + amountIn);
  const expectedSharesOut =
    otherReserve > newOther ? otherReserve - newOther : 0n;
  const priceImpactBps =
    reserve === 0n ? 0 : Number((amountIn * 10000n) / (reserve + amountIn));
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
 */
export async function getPythVAA(feedId: string): Promise<Uint8Array> {
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const url = `${pythHermesUrl()}/api/latest_vaas?ids[]=${id}`;
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
  };
}

/* ---------------------------------------------------------------------------
 * T4-11 — Admin builders (skeleton; Session E wires signing)
 * ------------------------------------------------------------------------ */

export interface CreateMarketArgs {
  groupId: bigint;
  feedId: string; // hex, 0x-prefixed or not
  strikePrice: bigint;
  closeTime: bigint; // unix seconds
  feeBps: number;
  marketType: number;
  thresholdType: number;
  maxTradeBps: number;
  maxStalenessSec: number;
  poolDepth: bigint;
}

export function buildCreateMarketTxn(args: CreateMarketArgs): InputTransactionData {
  const feedBytes = Array.from(fromHex(args.feedId));
  return {
    data: {
      function: entryFn("market_factory", "create_market"),
      typeArguments: [],
      functionArguments: [
        args.groupId.toString(),
        feedBytes,
        args.strikePrice.toString(),
        args.closeTime.toString(),
        args.feeBps,
        args.marketType,
        args.thresholdType,
        args.maxTradeBps,
        args.maxStalenessSec,
        args.poolDepth.toString(),
      ],
    },
  };
}

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
  };
}

export function buildSpawnRecurring3minTxn(
  groupId: bigint,
  feedId: string,
  currentPrice: bigint,
  tickSize: bigint,
  poolDepth: bigint,
): InputTransactionData {
  const feedBytes = Array.from(fromHex(feedId));
  return {
    data: {
      function: entryFn("market_factory", "spawn_recurring_3min"),
      typeArguments: [],
      functionArguments: [
        groupId.toString(),
        feedBytes,
        currentPrice.toString(),
        tickSize.toString(),
        poolDepth.toString(),
      ],
    },
  };
}

/**
 * STUB: Session E wires APTOS_ADMIN_PRIVATE_KEY.
 * TODO: Session E wires APTOS_ADMIN_PRIVATE_KEY — load via
 *   `PrivateKey.formatPrivateKey(hex, PrivateKeyVariants.Ed25519)` →
 *   `Ed25519PrivateKey` → `Account.fromPrivateKey(...)`, then
 *   `aptos.signAndSubmitTransaction({ signer, transaction })`.
 * In Session A we deliberately throw to prevent accidental use and to keep
 * this file free of any private-key env reads (audit grep rule).
 */
export async function submitAdminTxn(
  _payload: InputTransactionData,
): Promise<{ txnHash: string; success: boolean }> {
  throw new Error(
    "[aptos.ts] admin submission handled in Session E — submitAdminTxn is a Session A stub.",
  );
}
