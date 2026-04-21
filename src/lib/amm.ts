import { AMM_SMOOTHING_K } from "./constants";

export interface PriceQuote {
  yesPrice: number;
  noPrice: number;
}

export interface TradeQuote {
  price: number;
  sharesReceived: number;
  newYesDemand: number;
  newNoDemand: number;
  newYesPrice: number;
  newNoPrice: number;
}

/**
 * Log-ratio pseudo-AMM pricing.
 * Both sides start at demand = 1, giving 50/50 prices.
 * Buying one side increases its demand, raising its price via log curve.
 */
export function calculatePrices(yesDemand: number, noDemand: number): PriceQuote {
  const k = AMM_SMOOTHING_K;
  const yesPressure = Math.log(k + yesDemand);
  const noPressure = Math.log(k + noDemand);
  const total = yesPressure + noPressure;
  return {
    yesPrice: yesPressure / total,
    noPrice: noPressure / total,
  };
}

/**
 * Calculate what a trade would produce without executing it.
 * Shares received = amountSpent / currentPrice (simple model).
 */
export function calculateTradeQuote(
  yesDemand: number,
  noDemand: number,
  side: "YES" | "NO",
  amount: number
): TradeQuote {
  const currentPrices = calculatePrices(yesDemand, noDemand);
  const price = side === "YES" ? currentPrices.yesPrice : currentPrices.noPrice;
  const sharesReceived = amount / price;

  const newYesDemand = side === "YES" ? yesDemand + amount : yesDemand;
  const newNoDemand = side === "NO" ? noDemand + amount : noDemand;
  const newPrices = calculatePrices(newYesDemand, newNoDemand);

  return {
    price,
    sharesReceived,
    newYesDemand,
    newNoDemand,
    newYesPrice: newPrices.yesPrice,
    newNoPrice: newPrices.noPrice,
  };
}

export interface SellQuote {
  proceeds: number;
  pricePerShare: number;
  newYesDemand: number;
  newNoDemand: number;
  newYesPrice: number;
  newNoPrice: number;
}

/**
 * Calculate what selling shares would produce.
 * Proceeds = shares * currentPrice. Demand decreases by proceeds amount.
 */
export function calculateSellQuote(
  yesDemand: number,
  noDemand: number,
  side: "YES" | "NO",
  sharesToSell: number
): SellQuote {
  const currentPrices = calculatePrices(yesDemand, noDemand);
  const pricePerShare = side === "YES" ? currentPrices.yesPrice : currentPrices.noPrice;
  const proceeds = sharesToSell * pricePerShare;

  // Demand decreases by proceeds (inverse of buy). Floor at INITIAL_DEMAND (1) to prevent negative.
  const newYesDemand = side === "YES" ? Math.max(1, yesDemand - proceeds) : yesDemand;
  const newNoDemand = side === "NO" ? Math.max(1, noDemand - proceeds) : noDemand;
  const newPrices = calculatePrices(newYesDemand, newNoDemand);

  return {
    proceeds,
    pricePerShare,
    newYesDemand,
    newNoDemand,
    newYesPrice: newPrices.yesPrice,
    newNoPrice: newPrices.noPrice,
  };
}
