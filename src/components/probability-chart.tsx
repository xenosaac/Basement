"use client";

import { useMemo } from "react";

export interface ChartPoint {
  t: number; // unix sec
  upCents: number; // 0..100
  downCents: number;
}

export interface ProbabilityChartProps {
  points: ChartPoint[];
  startTimeSec: number;
  closeTimeSec: number;
  height?: number;
  resolvedOutcome?: "UP" | "DOWN" | "INVALID" | null;
  state?: "OPEN" | "CLOSED" | "RESOLVED" | "VOID";
}

const PADDING_X = 16;
const PADDING_Y = 14;
const RIGHT_LABEL = 44;

function formatT(secFromStart: number, totalSec: number): string {
  if (totalSec <= 600) {
    // minute:second
    const m = Math.floor(secFromStart / 60);
    const s = Math.floor(secFromStart % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  const h = Math.floor(secFromStart / 3600);
  const m = Math.floor((secFromStart % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

export function ProbabilityChart({
  points,
  startTimeSec,
  closeTimeSec,
  height = 200,
  resolvedOutcome,
  state,
}: ProbabilityChartProps) {
  const width = 720; // intrinsic; SVG scales via viewBox
  const innerW = width - PADDING_X * 2 - RIGHT_LABEL;
  const innerH = height - PADDING_Y * 2;

  const totalSec = Math.max(1, closeTimeSec - startTimeSec);

  const { upPath, downPath, lastUp, lastDown } = useMemo(() => {
    if (points.length === 0) {
      return { upPath: "", downPath: "", lastUp: 50, lastDown: 50 };
    }
    const xOf = (t: number) => {
      const frac = Math.max(0, Math.min(1, (t - startTimeSec) / totalSec));
      return PADDING_X + frac * innerW;
    };
    const yOf = (pct: number) => {
      // 0 → bottom, 100 → top
      return PADDING_Y + (1 - pct / 100) * innerH;
    };

    const up: string[] = [];
    const dn: string[] = [];
    points.forEach((p, i) => {
      const cmd = i === 0 ? "M" : "L";
      up.push(`${cmd}${xOf(p.t).toFixed(1)},${yOf(p.upCents).toFixed(1)}`);
      dn.push(`${cmd}${xOf(p.t).toFixed(1)},${yOf(p.downCents).toFixed(1)}`);
    });
    const last = points[points.length - 1];
    return {
      upPath: up.join(" "),
      downPath: dn.join(" "),
      lastUp: last.upCents,
      lastDown: last.downCents,
    };
  }, [points, startTimeSec, totalSec, innerW, innerH]);

  const lastX = PADDING_X + innerW;
  const lastUpY = PADDING_Y + (1 - lastUp / 100) * innerH;
  const lastDownY = PADDING_Y + (1 - lastDown / 100) * innerH;

  // Y-axis grid at 0/25/50/75/100
  const grid = [0, 25, 50, 75, 100];

  // X-axis ticks: start, mid, close
  const ticks = [
    { t: startTimeSec, label: "0:00" },
    {
      t: startTimeSec + Math.floor(totalSec / 2),
      label: formatT(Math.floor(totalSec / 2), totalSec),
    },
    { t: closeTimeSec, label: formatT(totalSec, totalSec) },
  ];

  if (points.length < 2) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-white/30"
        style={{ height }}
      >
        Trade to see the curve move.
      </div>
    );
  }

  const isClosed = state === "RESOLVED" || state === "VOID";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full block"
      style={{ height }}
      preserveAspectRatio="none"
      aria-label="YES vs NO probability over time"
    >
      {/* Y grid */}
      {grid.map((g) => {
        const y = PADDING_Y + (1 - g / 100) * innerH;
        return (
          <g key={g}>
            <line
              x1={PADDING_X}
              x2={PADDING_X + innerW}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray={g === 50 ? "0" : "2 4"}
              strokeWidth={g === 50 ? 1 : 0.5}
            />
            <text
              x={PADDING_X + innerW + 6}
              y={y + 3}
              fontSize="10"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fill="rgba(255,255,255,0.3)"
            >
              {g}%
            </text>
          </g>
        );
      })}

      {/* X tick labels */}
      {ticks.map((tk, i) => {
        const frac = Math.max(0, Math.min(1, (tk.t - startTimeSec) / totalSec));
        const x = PADDING_X + frac * innerW;
        return (
          <text
            key={i}
            x={x}
            y={height - 2}
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fill="rgba(255,255,255,0.25)"
            textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
          >
            {tk.label}
          </text>
        );
      })}

      {/* YES line */}
      <path
        d={upPath}
        fill="none"
        stroke="rgb(74, 222, 128)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* NO line */}
      <path
        d={downPath}
        fill="none"
        stroke="rgb(248, 113, 113)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End-of-line markers + current % labels */}
      <circle cx={lastX} cy={lastUpY} r="3" fill="rgb(74, 222, 128)" />
      <circle cx={lastX} cy={lastDownY} r="3" fill="rgb(248, 113, 113)" />

      {isClosed && resolvedOutcome && resolvedOutcome !== "INVALID" && (
        <text
          x={lastX - 4}
          y={resolvedOutcome === "UP" ? lastUpY - 8 : lastDownY + 14}
          fontSize="10"
          fontWeight="600"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fill={resolvedOutcome === "UP" ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)"}
          textAnchor="end"
        >
          {resolvedOutcome} won
        </text>
      )}
    </svg>
  );
}
