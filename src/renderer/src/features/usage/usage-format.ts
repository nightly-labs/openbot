import type { AnalyticsModel } from "@openbot/contracts/ipc";

export type UsageMetric = "Cost" | "Tokens";
export function usageNumber(value: number | null): string {
  return value === null ? "Unavailable" : value.toLocaleString();
}
export function usageCompact(value: number | null): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
export function usageCost(value: number | null): string {
  if (value !== null && value > 0 && value < 1e-12) return "<$0.000000000001";
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: value > 0 && value < 0.01 ? Math.min(12, -Math.floor(Math.log10(value)) + 1) : 2,
      }).format(value);
}
export function usageExactCost(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toLocaleString(undefined, { maximumFractionDigits: 12 })} USD`;
}
export function usageProviderName(provider: string): string {
  return provider === "codex"
    ? "Codex"
    : provider === "claude"
      ? "Claude Code"
      : provider === "grok"
        ? "Grok"
        : provider;
}
export function usageProviders(models: AnalyticsModel[]) {
  const providers = new Map<string, { provider: string; tokens: number; cost: number | null }>();
  for (const model of models) {
    const row = providers.get(model.provider) ?? { provider: model.provider, tokens: 0, cost: null };
    row.tokens += model.processedTokens;
    if (model.estimatedCostUsd !== null) row.cost = (row.cost ?? 0) + model.estimatedCostUsd;
    providers.set(model.provider, row);
  }
  return [...providers.values()];
}
