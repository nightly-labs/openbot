import type { AnalyticsDay, AnalyticsProviderDay } from "@openbot/contracts/ipc";

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
  metric: "cost" | "tokens",
): { series: string[]; rows: UsageSeriesRow[] } {
  const measure = (value: { processedTokens: number; estimatedCostUsd: number | null }) =>
    metric === "cost" ? value.estimatedCostUsd : value.processedTokens;
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
