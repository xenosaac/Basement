import {
  COINGECKO_SIMPLE_PRICE_URL,
  BTC_STRIKE_ROUNDING,
  ETH_STRIKE_ROUNDING,
} from "./constants";

export interface CryptoPrices {
  btc: number;
  eth: number;
}

export async function fetchCryptoPrices(): Promise<CryptoPrices> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `${COINGECKO_SIMPLE_PRICE_URL}?ids=bitcoin,ethereum&vs_currencies=usd`,
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data = await res.json();
    return {
      btc: data.bitcoin.usd,
      eth: data.ethereum.usd,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function roundStrikePrice(price: number, asset: "BTC" | "ETH"): number {
  const rounding = asset === "BTC" ? BTC_STRIKE_ROUNDING : ETH_STRIKE_ROUNDING;
  return Math.round(price / rounding) * rounding;
}

export function generateMarketQuestion(asset: "BTC" | "ETH"): string {
  const name = asset === "BTC" ? "Bitcoin" : "Ethereum";
  return `Will ${name} go up in the next 3 minutes?`;
}
