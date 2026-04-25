"use client";

import type { JSX } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BetSide, SeriesId, SeriesSummary } from "@/lib/types/v3-api";
import { useUser } from "@/hooks/use-user";
import { useBalanceV3 } from "@/hooks/use-balance-v3";
import { useBetV3, BetError, codeToUserMessage } from "@/hooks/use-bet-v3";
import { useFaucetV3 } from "@/hooks/use-faucet-v3";
import { useAptosAuth } from "@/components/aptos-auth-provider";
import { useConnectModal } from "@/components/connect-modal-provider";
import { useToastQueue } from "@/components/toast-queue-provider";
import { formatCentsShare } from "@/lib/quant";
import { sideLabel } from "@/lib/utils";

/**
 * `<InlineTradeWidget>` - card-local miniaturized trade panel.
 *
 * Phase 4 of the Polymarket-style redesign. Lives as a sibling of the
 * `<Link>` inside `<SeriesCardV2>` (MASTER D5/D6 - no event-bubble
 * manipulation needed). Consumes the probability computed by Agent B
 * upstream and renders Yes/No side chips + amount input + CTA with a
 * full wallet-gate matrix (D24).
 *
 * References:
 *   - plans/polymarket-redesign/D-inline-trade.md
 *   - MASTER D22 (nonce reuse), D23 (role=alert), D24 (gate matrix)
 */

// --- Types ---

export interface InlineTradeWidgetProps {
  series: SeriesSummary;
  probability: { upCents: number; downCents: number };
  onTradeStart?: (side: BetSide, cents: number) => void;
  onTradeSuccess?: (side: BetSide, cents: number, roundIdx: number) => void;
  onTradeError?: (code: string) => void;
  className?: string;
  /** Parent-level disable (resolving, settling, etc.). */
  disabled?: boolean;
  variant?: "default" | "hero";
}

type WidgetState =
  | { kind: "idle" }
  | { kind: "submitting"; side: BetSide; cents: number; nonce: string }
  | { kind: "success"; side: BetSide; cents: number; flashUntil: number }
  | { kind: "error"; code: string; clearAt: number };

// --- Constants ---

const MIN_BET_CENTS = 10; // $0.10 (matches server MIN_BET_CENTS)
const QUICK_AMOUNTS_CENTS = [100, 500, 1000, 5000] as const; // $1 / $5 / $10 / $50
const DEFAULT_AMOUNT_CENTS = 100;
const SUCCESS_FLASH_MS = 900;
const ERROR_CLEAR_MS = 4000;
const ROUND_CLOSING_THRESHOLD_SEC = 5;

// --- Helpers ---

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatFaucetCooldown(nextFaucetAtSec: number | null | undefined): string {
  if (!nextFaucetAtSec) return "—";
  const secs = nextFaucetAtSec - nowSec();
  if (secs <= 0) return "now";
  const hours = Math.ceil(secs / 3600);
  return `${hours}h`;
}

function marketClosedReason(
  reason: SeriesSummary["marketHours"]["reason"],
): string {
  switch (reason) {
    case "weekend":
      return "weekend";
    case "holiday":
      return "holiday";
    case "pre-open":
      return "pre-open";
    case "post-close":
      return "post-close";
    default:
      return "closed";
  }
}

// Tick every 500ms while mounted so roundClosing/faucet-cooldown transitions
// flip the gate matrix in real time.
function useNowTick(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

// --- Component ---

export function InlineTradeWidget(
  props: InlineTradeWidgetProps,
): JSX.Element {
  const {
    series,
    probability,
    onTradeStart,
    onTradeSuccess,
    onTradeError,
    className = "",
    disabled = false,
    variant = "default",
  } = props;

  // Drive relative-time displays (countdown, faucet cooldown).
  useNowTick(500);

  const user = useUser();
  const { isAuthenticating, signIn } = useAptosAuth();
  const address =
    user.isConnected && user.address ? user.address : undefined;
  const { data: balance } = useBalanceV3(address);
  const bet = useBetV3();
  const faucet = useFaucetV3();
  const connectModal = useConnectModal();
  const toasts = useToastQueue();

  const [selectedSide, setSelectedSide] = useState<BetSide>("UP");
  const [amountCents, setAmountCents] = useState<number>(DEFAULT_AMOUNT_CENTS);
  const [state, setState] = useState<WidgetState>({ kind: "idle" });

  // Nonce reuse (MASTER D22 / REVIEW P1-5) - persist across the
  // submitting -> error -> retry loop so the server deduplicates.
  // Rotates only on confirmed success.
  const pendingNonceRef = useRef<string | null>(null);

  // Auto-clear error state after 4s so the CTA label bounces back.
  useEffect(() => {
    if (state.kind !== "error") return;
    const delay = Math.max(0, state.clearAt - Date.now());
    const id = setTimeout(() => setState({ kind: "idle" }), delay);
    return () => clearTimeout(id);
  }, [state]);

  // Auto-clear success flash after 900ms.
  useEffect(() => {
    if (state.kind !== "success") return;
    const delay = Math.max(0, state.flashUntil - Date.now());
    const id = setTimeout(() => setState({ kind: "idle" }), delay);
    return () => clearTimeout(id);
  }, [state]);

  // --- Derived wallet/round gate flags ---

  const availableCents = Number(balance?.availableCents ?? 0);
  const canClaimFaucet =
    balance?.nextFaucetAtSec == null ||
    balance.nextFaucetAtSec <= nowSec();
  const isRoundClosing =
    series.currentCloseTimeSec - nowSec() <= ROUND_CLOSING_THRESHOLD_SEC;
  const isMarketClosed = !series.marketHours.open;
  const isInsufficient =
    !!address && availableCents >= 0 && amountCents > availableCents;
  const isBelowMin = amountCents < MIN_BET_CENTS;
  const isSubmitting = state.kind === "submitting" || bet.isPending;

  // --- Gate matrix (D24 - 9 states) ---

  type GateKind =
    | "connect"
    | "signIn"
    | "signing"
    | "claim"
    | "cooldown"
    | "marketClosed"
    | "roundClosing"
    | "parentDisabled"
    | "submitting"
    | "success"
    | "error"
    | "insufficient"
    | "belowMin"
    | "happy";

  type Gate = {
    kind: GateKind;
    label: string;
    disabled: boolean;
    tone: "accent" | "yes" | "no" | "muted" | "success";
    ariaLabel?: string;
    onClick?: () => void;
  };

  const tradeAction = useCallback(() => {
    if (!address) return;

    // Nonce reuse: keep the same nonce across a submitting -> error -> retry
    // cycle. Only rotate when a bet actually succeeds or when the user
    // changes side/amount (we treat a change as a new intent - see below).
    const nonce = pendingNonceRef.current ?? crypto.randomUUID();
    pendingNonceRef.current = nonce;

    const side = selectedSide;
    const cents = amountCents;
    const roundIdx = series.currentRoundIdx;

    setState({ kind: "submitting", side, cents, nonce });
    onTradeStart?.(side, cents);

    bet.mutate(
      {
        seriesId: series.seriesId as SeriesId,
        roundIdx,
        side,
        amountCents: cents,
        nonce,
      },
      {
        onSuccess: () => {
          // Rotate nonce now that this bet is confirmed.
          pendingNonceRef.current = null;
          setState({
            kind: "success",
            side,
            cents,
            flashUntil: Date.now() + SUCCESS_FLASH_MS,
          });
          toasts.push({
            message: `✓ Bet ${formatDollars(cents)} on ${sideLabel(side)} · Round ${roundIdx}`,
            type: "success",
          });
          onTradeSuccess?.(side, cents, roundIdx);
        },
        onError: (err) => {
          const code =
            err instanceof BetError ? err.code : "INTERNAL";
          const msg = codeToUserMessage(code);
          setState({
            kind: "error",
            code,
            clearAt: Date.now() + ERROR_CLEAR_MS,
          });
          toasts.push({ message: msg, type: "error" });
          onTradeError?.(code);
        },
      },
    );
  }, [
    address,
    amountCents,
    bet,
    onTradeError,
    onTradeStart,
    onTradeSuccess,
    selectedSide,
    series.currentRoundIdx,
    series.seriesId,
    toasts,
  ]);

  const gate: Gate = useMemo(() => {
    // 1. wallet not connected
    if (!user.isConnected) {
      return {
        kind: "connect",
        label: "Connect Wallet",
        disabled: false,
        tone: "accent",
        onClick: () => connectModal.open(),
      };
    }
    // 3. signing in (check before 2, since isAuthenticating implies !isAuthenticated)
    if (isAuthenticating) {
      return {
        kind: "signing",
        label: "Signing message…",
        disabled: true,
        tone: "muted",
        ariaLabel: "Signing auth message",
      };
    }
    // 2. connected but not authed
    if (!user.isAuthenticated) {
      return {
        kind: "signIn",
        label: "Sign in to trade",
        disabled: false,
        tone: "accent",
        onClick: () => {
          void signIn();
        },
      };
    }
    // 8. parent override (resolving/settling)
    if (disabled) {
      return {
        kind: "parentDisabled",
        label: "Settling…",
        disabled: true,
        tone: "muted",
        ariaLabel: "Round settling",
      };
    }
    // 6. market closed (weekend/holiday)
    if (isMarketClosed) {
      const reason = marketClosedReason(series.marketHours.reason);
      return {
        kind: "marketClosed",
        label: `Closed (${reason})`,
        disabled: true,
        tone: "muted",
        ariaLabel: `Market closed: ${reason}`,
      };
    }
    // 7. round closing (<=5s)
    if (isRoundClosing) {
      return {
        kind: "roundClosing",
        label: "Round closing…",
        disabled: true,
        tone: "muted",
        ariaLabel: "Round closing — next round opening shortly",
      };
    }
    // 4/5. zero balance -> faucet path
    if (availableCents === 0) {
      if (canClaimFaucet) {
        return {
          kind: "claim",
          label: faucet.isPending ? "Claiming…" : "Claim $50 to start",
          disabled: faucet.isPending,
          tone: "accent",
          onClick: () => {
            if (!faucet.isPending) faucet.mutate();
          },
        };
      }
      return {
        kind: "cooldown",
        label: `Next faucet in ${formatFaucetCooldown(balance?.nextFaucetAtSec)}`,
        disabled: true,
        tone: "muted",
        ariaLabel: "Faucet on cooldown",
      };
    }
    // Submitting
    if (isSubmitting) {
      return {
        kind: "submitting",
        label: "Placing…",
        disabled: true,
        tone: "accent",
      };
    }
    // Success flash
    if (state.kind === "success") {
      return {
        kind: "success",
        label: `✓ ${sideLabel(state.side)} · ${formatDollars(state.cents)}`,
        disabled: true,
        tone: "success",
      };
    }
    // Validation (below min / insufficient)
    if (isBelowMin) {
      return {
        kind: "belowMin",
        label: "Min $0.10",
        disabled: true,
        tone: "muted",
        ariaLabel: "Amount below minimum bet",
      };
    }
    if (isInsufficient) {
      return {
        kind: "insufficient",
        label: "Insufficient Balance",
        disabled: true,
        tone: "muted",
        ariaLabel: "Amount exceeds available balance",
      };
    }
    // 9. happy path
    return {
      kind: "happy",
      label: `Trade ${formatDollars(amountCents)} on ${sideLabel(selectedSide)}`,
      disabled: false,
      tone: selectedSide === "UP" ? "yes" : "no",
      onClick: tradeAction,
    };
  }, [
    amountCents,
    availableCents,
    balance?.nextFaucetAtSec,
    canClaimFaucet,
    connectModal,
    disabled,
    faucet,
    isAuthenticating,
    isBelowMin,
    isInsufficient,
    isMarketClosed,
    isRoundClosing,
    isSubmitting,
    selectedSide,
    series.marketHours.reason,
    signIn,
    state,
    tradeAction,
    user.isAuthenticated,
    user.isConnected,
  ]);

  // --- Handlers ---

  const handleSideChange = useCallback((side: BetSide) => {
    setSelectedSide(side);
    // Intent changed -> drop any stale nonce so a fresh intent gets a fresh id.
    pendingNonceRef.current = null;
    // Clear any error banner on fresh input.
    setState((prev) => (prev.kind === "error" ? { kind: "idle" } : prev));
  }, []);

  const handleAmountChange = useCallback((raw: string) => {
    // NaN parse guard (D-inline-trade.md section 10.5).
    const parsed = parseFloat(raw);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    const cents = Math.max(0, Math.round(safe * 100));
    setAmountCents(cents);
    pendingNonceRef.current = null;
    setState((prev) => (prev.kind === "error" ? { kind: "idle" } : prev));
  }, []);

  const handleQuickAmount = useCallback((c: number) => {
    setAmountCents(c);
    pendingNonceRef.current = null;
    setState((prev) => (prev.kind === "error" ? { kind: "idle" } : prev));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      // Defensive: widget lives OUTSIDE the card <Link> per MASTER D5/D6, so
      // no stopPropagation is needed - but prevent the default GET-reload of
      // a bare <form>.
      e.preventDefault();
      if (!gate.disabled && gate.onClick) gate.onClick();
    },
    [gate],
  );

  // --- Visual helpers ---

  const yesSelected = selectedSide === "UP";
  const noSelected = selectedSide === "DOWN";
  const flashYes =
    state.kind === "success" && state.side === "UP" ? "ring-2 ring-yes/70" : "";
  const flashNo =
    state.kind === "success" && state.side === "DOWN" ? "ring-2 ring-no/70" : "";

  const ctaClass = (() => {
    const base =
      "w-full rounded-[14px] text-sm font-semibold transition-all duration-150 tabular-nums";
    const size = variant === "hero" ? "py-3.5" : "py-2.5";
    if (gate.disabled) {
      return `${base} ${size} bg-white/[0.04] text-white/40 border border-white/[0.06] cursor-not-allowed`;
    }
    if (gate.tone === "yes") {
      return `${base} ${size} bg-yes text-black hover:shadow-glow-sm`;
    }
    if (gate.tone === "no") {
      return `${base} ${size} bg-no text-black hover:shadow-glow-sm`;
    }
    if (gate.tone === "success") {
      return `${base} ${size} bg-yes-dim text-yes border border-yes/40`;
    }
    // accent / muted / default
    return `${base} ${size} bg-accent text-black hover:shadow-glow-sm`;
  })();

  const containerPad = variant === "hero" ? "p-4" : "p-3";
  const errorCode = state.kind === "error" ? state.code : null;
  const errorMsg = errorCode ? codeToUserMessage(errorCode) : null;

  // --- Render ---

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-[20px] border border-white/[0.06] bg-black/25 backdrop-blur-md ${containerPad} space-y-2.5 ${className}`}
    >
      {/* Yes / No side chips */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => handleSideChange("UP")}
          aria-pressed={yesSelected}
          aria-label={`Select Yes at ${formatCentsShare(probability.upCents)}`}
          className={`py-2 rounded-[12px] text-xs font-semibold tabular-nums transition-all ${flashYes} ${
            yesSelected
              ? "bg-yes-dim text-yes border border-yes-border"
              : "bg-white/[0.03] text-white/60 border border-transparent hover:border-yes-border/60"
          }`}
        >
          <span className="block leading-tight">Yes</span>
          <span className="block text-[10px] font-normal opacity-80">
            {formatCentsShare(probability.upCents)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => handleSideChange("DOWN")}
          aria-pressed={noSelected}
          aria-label={`Select No at ${formatCentsShare(probability.downCents)}`}
          className={`py-2 rounded-[12px] text-xs font-semibold tabular-nums transition-all ${flashNo} ${
            noSelected
              ? "bg-no-dim text-no border border-no-border"
              : "bg-white/[0.03] text-white/60 border border-transparent hover:border-no-border/60"
          }`}
        >
          <span className="block leading-tight">No</span>
          <span className="block text-[10px] font-normal opacity-80">
            {formatCentsShare(probability.downCents)}
          </span>
        </button>
      </div>

      {/* Amount - quick picks + numeric input */}
      <div className="flex items-center gap-1.5">
        {QUICK_AMOUNTS_CENTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleQuickAmount(c)}
            className={`flex-1 py-1 text-[11px] rounded-[10px] tabular-nums transition ${
              amountCents === c
                ? "bg-accent-dim text-accent border border-accent/30"
                : "bg-white/[0.03] text-white/50 border border-transparent hover:border-white/[0.12]"
            }`}
          >
            ${c / 100}
          </button>
        ))}
      </div>

      <input
        type="number"
        step="0.01"
        min="0.10"
        inputMode="decimal"
        aria-label="Bet amount in vUSD"
        value={(amountCents / 100).toFixed(2)}
        onChange={(e) => handleAmountChange(e.target.value)}
        className="w-full px-2.5 py-1.5 bg-black/40 border border-white/[0.08] rounded-[10px] text-white text-xs tabular-nums focus:outline-none focus:border-accent"
        placeholder="Amount vUSD"
      />

      {/* CTA */}
      <button
        type="submit"
        disabled={gate.disabled}
        aria-disabled={gate.disabled}
        aria-label={gate.ariaLabel ?? gate.label}
        className={ctaClass}
      >
        {gate.label}
      </button>

      {/* Inline error banner (role=alert per D23 / P1-6) */}
      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="text-[11px] text-no bg-no-dim rounded-[10px] px-2.5 py-1.5"
        >
          {errorMsg}
        </div>
      )}
    </form>
  );
}
