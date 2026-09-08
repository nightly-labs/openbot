import type { AnalyticsDay, AnalyticsModel, AnalyticsProviderDay } from "@openbot/contracts/ipc";

// The header filters render these lists directly, so the visible label and the
// stored value are one string.
export const usageMetrics = ["Cost", "Tokens"] as const;
export type UsageMetric = (typeof usageMetrics)[number];
export const usagePeriods = ["7 days", "30 days", "90 days", "1 year"] as const;
export type UsagePeriod = (typeof usagePeriods)[number];
// A label is not a number of days once "1 year" is an option, and the host rejects a
// range wider than 367 days, so a year is the 365 the calendar names rather than 366.
export const usagePeriodDays: Record<UsagePeriod, number> = {
  "7 days": 7,
  "30 days": 30,
  "90 days": 90,
  "1 year": 365,
};
// A report row names an agent by id, and the provider is empty when the agent is not in
// the list the panel read, because UsageProviderMark already draws nothing for a string
// it does not recognize.
export interface UsageAgentLabel {
  name: string;
  provider: string;
}
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

// A series wears its provider's colour, never the colour of its rank: the provider list
// re-sorts when the metric changes, and a legend dot that repainted with it would say a
// different area belongs to the row.
const seriesColors: Readonly<Record<string, string>> = {
  codex: "var(--openbot-chart-series-codex)",
  claude: "var(--openbot-chart-series-claude)",
  grok: "var(--openbot-chart-series-grok)",
};
export function usageSeriesColor(provider: string): string {
  return seriesColors[provider] ?? "var(--openbot-chart-series-other)";
}

// The one series a report without a provider split still draws. It cannot collide with a
// provider column: the fallback returns it as the whole series list.
export const usageTotalSeries = "total";

export interface UsageSeriesRow {
  date: string;
  [provider: string]: string | number | null;
}
/**
 * Pivots the daily-by-provider grid into the wide rows the chart reads: one row per day,
 * one column per provider. A provider with no cell for a day spent nothing there, so it
 * reads zero; a cell whose cost is unknown stays null, which is what draws a gap instead
 * of a false zero.
 */
export function usageSeries(
  cells: AnalyticsProviderDay[],
  daily: AnalyticsDay[],
  metric: UsageMetric,
): { series: string[]; rows: UsageSeriesRow[] } {
  const measure = (value: { processedTokens: number; estimatedCostUsd: number | null }) =>
    metric === "Cost" ? value.estimatedCostUsd : value.processedTokens;
  if (cells.length === 0)
    return {
      series: [usageTotalSeries],
      rows: daily.map((day) => ({ date: day.date, [usageTotalSeries]: measure(day) })),
    };
  const totals = new Map<string, number>();
  const byDate = new Map<string, Map<string, number | null>>();
  for (const cell of cells) {
    totals.set(cell.provider, (totals.get(cell.provider) ?? 0) + cell.processedTokens);
    const row = byDate.get(cell.date) ?? new Map<string, number | null>();
    row.set(cell.provider, measure(cell));
    byDate.set(cell.date, row);
  }
  const series = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([provider]) => provider);
  return {
    series,
    rows: daily.map((day) => {
      const row: UsageSeriesRow = { date: day.date };
      const cellsForDay = byDate.get(day.date);
      for (const provider of series) {
        // Absent and unpriced are different answers. No cell means the provider spent nothing
        // that day, which is a real zero; a cell whose cost estimate is null means the day is
        // unavailable, and `connectNulls={false}` draws that as the gap it is.
        const value = cellsForDay?.get(provider);
        row[provider] = value === undefined ? 0 : value;
      }
      return row;
    }),
  };
}
