export type OutcomeLabel = "YES" | "NO" | "INVALID";

export function outcomeCodeToLabel(code: number): OutcomeLabel {
  if (code === 0) return "YES";
  if (code === 1) return "NO";
  return "INVALID";
}

export interface DisplayPrices {
  yesPrice: number;
  noPrice: number;
}

export function settlementDisplayPrices(
  state: "OPEN" | "CLOSED" | "RESOLVED" | "SETTLED",
  resolvedOutcome: string | null,
  fallback: DisplayPrices,
): DisplayPrices {
  if (state !== "RESOLVED" && state !== "SETTLED") return fallback;
  if (resolvedOutcome === "YES") return { yesPrice: 1, noPrice: 0 };
  if (resolvedOutcome === "NO") return { yesPrice: 0, noPrice: 1 };
  if (resolvedOutcome === "INVALID") return { yesPrice: 0.5, noPrice: 0.5 };
  return fallback;
}
