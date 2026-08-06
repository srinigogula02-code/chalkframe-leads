import "server-only";

export type CurrencyCode = "INR" | "USD";

export const DEFAULT_USD_TO_INR = 95.1341;

export async function getUsdToInrRate(): Promise<number> {
  try {
    const response = await fetch("https://v6.exchangerate-api.com/v6/cb3580f286baa0d068e4bc61/latest/USD", {
      headers: { accept: "application/json" },
      next: { revalidate: 259_200 }, // 3 days (3 * 24 * 60 * 60 seconds)
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return DEFAULT_USD_TO_INR;
    const data = await response.json() as { conversion_rates?: { INR?: number } };
    const rate = Number(data.conversion_rates?.INR);
    return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_TO_INR;
  } catch {
    return DEFAULT_USD_TO_INR;
  }
}

export function formatCurrency(
  valueUsd: number | string | null | undefined,
  currency: CurrencyCode = "INR",
  maxDigits = 2,
  exchangeRate = DEFAULT_USD_TO_INR,
): string {
  const numeric = Number(valueUsd || 0);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return currency === "INR" ? "₹0.00" : "$0.00";
  }

  if (currency === "INR") {
    const inrValue = numeric * exchangeRate;
    if (inrValue < 0.01 && inrValue > 0) {
      return `₹${inrValue.toFixed(3)}`;
    }
    return `₹${inrValue.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDigits > 2 ? maxDigits : 2,
    })}`;
  }

  if (numeric < 0.01 && numeric > 0) {
    return `$${numeric.toFixed(4)}`;
  }
  return `$${numeric.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits,
  })}`;
}

export function formatPerMillion(
  pricePerToken: number | null | undefined,
  currency: CurrencyCode = "INR",
  exchangeRate = DEFAULT_USD_TO_INR,
): string {
  if (pricePerToken === null || pricePerToken === undefined) {
    return "Router pricing";
  }
  const per1MUsd = pricePerToken * 1_000_000;
  if (currency === "INR") {
    const per1MInr = per1MUsd * exchangeRate;
    return `₹${per1MInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}/1M`;
  }
  return `$${per1MUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}/1M`;
}
