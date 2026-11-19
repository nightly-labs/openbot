import { type AnalyticsDay, type AnalyticsProviderDay, analyticsTokens } from "@openbot/contracts/ipc";

export const usageTotalSeries = "total";

export interface UsageSeriesRow {
  date: string;
  [provider: string]: string | number | null;
}
export function usageSeries(
  cells: AnalyticsProviderDay[],
  daily: AnalyticsDay[],
  metric: "cost" | "tokens",
): { series: string[]; rows: UsageSeriesRow[] } {
  const measure = (value: AnalyticsDay | AnalyticsProviderDay) =>
    metric === "cost" ? value.estimatedCostUsd : analyticsTokens(value);
  if (cells.length === 0 || (metric === "tokens" && cells.some((cell) => cell.cachedInput === undefined)))
    return {
      series: [usageTotalSeries],
      rows: daily.map((day) => ({ date: day.date, [usageTotalSeries]: measure(day) })),
    };
  const totals = new Map<string, number>();
  const byDate = new Map<string, Map<string, number | null>>();
  for (const cell of cells) {
    totals.set(cell.provider, (totals.get(cell.provider) ?? 0) + analyticsTokens(cell));
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
        const value = cellsForDay?.get(provider);
        row[provider] = value === undefined ? 0 : value;
      }
      return row;
    }),
  };
}
