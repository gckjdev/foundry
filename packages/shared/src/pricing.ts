/**
 * Fallback USD prices per million tokens, used only when a harness or provider doesn't report
 * cost itself. Override or extend with FOUNDRY_PRICING_JSON='{"model-id":{"in":3,"out":15}}'.
 */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet": { in: 3, out: 15 },
  "claude-haiku": { in: 1, out: 5 },
  "claude-opus": { in: 5, out: 25 },
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
};

function loadPrices(): Record<string, { in: number; out: number }> {
  const raw = typeof process !== "undefined" ? process.env.FOUNDRY_PRICING_JSON : undefined;
  if (!raw) return DEFAULT_PRICES;
  try {
    return { ...DEFAULT_PRICES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRICES;
  }
}

/** Longest price-table key that is a prefix of the model id (provider prefix stripped). */
export function priceFor(model: string): { in: number; out: number } | null {
  const prices = loadPrices();
  const id = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  const key = Object.keys(prices)
    .filter((k) => id.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? prices[key]! : null;
}

export function costFromUsage(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
