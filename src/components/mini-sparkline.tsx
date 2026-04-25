"use client";

/**
 * Pure-SVG Polymarket-style mini sparkline. Zero chart dependencies.
 *
 * Math sits entirely in bigint cents until the last x/y mapping step, where we
 * convert to Number (±10M cents = $100K is well inside Number precision).
 *
 * Design tokens (MASTER §2 D11 + C-sparkline §6):
 *   up       stroke #22c55e + rgba(34,197,94,0.15) area fill
 *   down     stroke #ef4444 + rgba(239,68,68,0.15) area fill
 *   neutral  stroke rgba(255,255,255,0.45), no area fill (REVIEW P2)
 *   strike   dashed horizontal, rgba(255,255,255,0.35), 2-3 dasharray
 */

import type { JSX } from "react";

// ───────────────────── Types ─────────────────────

export interface MiniSparklineProps {
  ticks: Array<{ tSec: number; priceCents: bigint }>;
  /** Pixel width of the rendered SVG. Default 120. */
  width?: number;
  /** Pixel height of the rendered SVG. Default 32. */
  height?: number;
  /** Appends a sentinel point at the right edge and draws a dot. */
  currentPriceCents?: bigint | null;
  /** If provided, draws a dashed horizontal reference line. */
  strikeCents?: bigint | null;
  /** Color tint; caller passes value from `sparklineVariantFor()`. */
  variant?: "up" | "down" | "neutral";
  /** Forces the skeleton state. */
  isLoading?: boolean;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

interface VariantTokens {
  stroke: string;
  fill: string | null;
}

// ───────────────────── Constants ─────────────────────

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 32;
const WARMUP_THRESHOLD = 8; // < 8 ticks → 70% opacity
const MIN_TICKS_TO_RENDER = 2;

const VARIANTS: Record<"up" | "down" | "neutral", VariantTokens> = {
  up: {
    stroke: "#22c55e",
    fill: "rgba(34,197,94,0.15)",
  },
  down: {
    stroke: "#ef4444",
    fill: "rgba(239,68,68,0.15)",
  },
  neutral: {
    stroke: "rgba(255,255,255,0.45)",
    fill: null,
  },
};

const STRIKE_STROKE = "rgba(255,255,255,0.35)";
const STRIKE_DASHARRAY = "2 3";

// ───────────────────── Geometry helpers ─────────────────────

/** `M x0,y0 L x1,y1 L x2,y2 ...` — avoids polyline's points attribute so we
 *  can share the same helper for dashed loading lines. */
function pointsToPolyline(pts: Point[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
  }
  return d;
}

/** Closed area from polyline down to bottom edge at `height`. */
function pointsToAreaPath(pts: Point[], height: number): string {
  if (pts.length < 2) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  let d = `M ${first.x.toFixed(2)},${height.toFixed(2)}`;
  d += ` L ${first.x.toFixed(2)},${first.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
  }
  d += ` L ${last.x.toFixed(2)},${height.toFixed(2)} Z`;
  return d;
}

// ───────────────────── Component ─────────────────────

export function MiniSparkline(props: MiniSparklineProps): JSX.Element {
  const {
    ticks,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    currentPriceCents = null,
    strikeCents = null,
    variant = "neutral",
    isLoading = false,
    className,
  } = props;

  const tokens = VARIANTS[variant];

  // Combine input ticks with the optional live-price sentinel. The sentinel is
  // placed at "now" seconds so the polyline extends to the right edge even when
  // the latest DB tick is a few seconds stale.
  const combined: Array<{ tSec: number; priceCents: bigint }> =
    currentPriceCents !== null && currentPriceCents !== undefined
      ? [
          ...ticks,
          { tSec: Math.floor(Date.now() / 1000), priceCents: currentPriceCents },
        ]
      : ticks.slice();

  // ── Skeleton state: loading, or not enough data to draw a line.
  const showSkeleton = isLoading || combined.length < MIN_TICKS_TO_RENDER;
  if (showSkeleton) {
    const midY = height / 2;
    const baseClass = "overflow-visible";
    const wrapperClass = isLoading
      ? `${baseClass} animate-pulse`
      : baseClass;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={className ? `${wrapperClass} ${className}` : wrapperClass}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={midY}
          x2={width}
          y2={midY}
          stroke={tokens.stroke}
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.6}
        />
      </svg>
    );
  }

  // ── X domain: first to last tSec; collapse to unit range if identical.
  const first = combined[0];
  const last = combined[combined.length - 1];
  const xMinSec = first.tSec;
  const xMaxSec = last.tSec === first.tSec ? first.tSec + 1 : last.tSec;
  const xSpan = xMaxSec - xMinSec; // > 0 by construction

  // ── Y domain in bigint cents; include strike if present for viewport stability.
  let yMin = combined[0].priceCents;
  let yMax = combined[0].priceCents;
  for (const pt of combined) {
    if (pt.priceCents < yMin) yMin = pt.priceCents;
    if (pt.priceCents > yMax) yMax = pt.priceCents;
  }
  if (strikeCents !== null && strikeCents !== undefined) {
    if (strikeCents < yMin) yMin = strikeCents;
    if (strikeCents > yMax) yMax = strikeCents;
  }

  // 5% vertical padding so strokes don't clip the viewBox edges. Minimum of 1
  // cent ensures we don't collapse to a zero span when every tick is identical.
  let range = yMax - yMin;
  let pad = range / 20n; // 5%
  if (pad === 0n) pad = 1n;
  yMin -= pad;
  yMax += pad;
  range = yMax - yMin; // > 0 now

  // Convert bigint cents -> Number ONLY at the pixel-mapping step. Safe for
  // any realistic asset price in cents (±10M = $100K fits Number easily).
  const rangeNum = Number(range);
  const yMinNum = Number(yMin);
  const h = height;
  const w = width;

  const pts: Point[] = combined.map((pt) => {
    const xFrac = (pt.tSec - xMinSec) / xSpan;
    const x = xFrac * w;
    const priceNum = Number(pt.priceCents);
    const yFrac = (priceNum - yMinNum) / rangeNum;
    const y = h - yFrac * h;
    return { x, y };
  });

  const strikeY: number | null =
    strikeCents !== null && strikeCents !== undefined
      ? h - ((Number(strikeCents) - yMinNum) / rangeNum) * h
      : null;

  // ── Opacity ramp: warming up until we have >= 8 points.
  const lineOpacity = combined.length < WARMUP_THRESHOLD ? 0.7 : 1;

  const linePath = pointsToPolyline(pts);
  const areaPath = tokens.fill ? pointsToAreaPath(pts, h) : null;

  const lastPoint = pts[pts.length - 1];
  const showDot =
    currentPriceCents !== null && currentPriceCents !== undefined;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={
        className ? `overflow-visible ${className}` : "overflow-visible"
      }
      aria-hidden="true"
    >
      {areaPath ? (
        <path d={areaPath} fill={tokens.fill ?? "none"} stroke="none" />
      ) : null}
      {strikeY !== null ? (
        <line
          x1={0}
          y1={strikeY}
          x2={w}
          y2={strikeY}
          stroke={STRIKE_STROKE}
          strokeWidth={1}
          strokeDasharray={STRIKE_DASHARRAY}
        />
      ) : null}
      <path
        d={linePath}
        fill="none"
        stroke={tokens.stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={lineOpacity}
      />
      {showDot ? (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={2.5}
          fill={tokens.stroke}
          stroke="none"
        />
      ) : null}
    </svg>
  );
}
