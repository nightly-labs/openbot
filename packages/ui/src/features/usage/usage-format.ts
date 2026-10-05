import type { AnalyticsModel } from "@openbot/contracts/ipc";
import { agentProviderCliName, isAgentProvider } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText, type TextValue } from "../../text";

type UsageText = Pick<TextValue, "t" | "format">;

// The header filters keep these ids in memory only. The labels come from the maps below.
export const usageMetrics = ["cost", "tokens"] as const;
export type UsageMetric = (typeof usageMetrics)[number];
export const usageMetricLabels = {
  cost: "usage.metric.cost",
  tokens: "usage.metric.tokens",
} as const satisfies Record<UsageMetric, AppTextKey>;
export const usagePeriods = ["7d", "30d", "90d", "1y"] as const;
export type UsagePeriod = (typeof usagePeriods)[number];
export const usagePeriodLabels = {
  "7d": "usage.period.days7",
  "30d": "usage.period.days30",
  "90d": "usage.period.days90",
  "1y": "usage.period.year",
} as const satisfies Record<UsagePeriod, AppTextKey>;
// A label is not a number of days once "1 year" is an option, and the host rejects a
// range wider than 367 days, so a year is the 365 the calendar names rather than 366.
export const usagePeriodDays: Record<UsagePeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
// A report row names an agent by id, and the provider is empty when the agent is not in
// the list the panel read, because UsageProviderMark already draws nothing for a string
// it does not recognize.
export interface UsageAgentLabel {
  name: string;
  provider: string;
}
export function usageNumber(value: number | null, text: UsageText = currentText()): string {
  return value === null ? text.t("usage.unavailable") : text.format.number(value);
}
export function usageCompact(value: number | null, text: UsageText = currentText()): string {
  return value === null
    ? text.t("usage.unavailable")
    : text.format.number(value, { notation: "compact", maximumFractionDigits: 2 });
}
export function usageCost(value: number | null, text: UsageText = currentText()): string {
  if (value !== null && value > 0 && value < 1e-12)
    return `<${text.format.currencyUsd(1e-12, { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`;
  return value === null
    ? text.t("usage.unavailable")
    : text.format.currencyUsd(value, {
        minimumFractionDigits: 2,
        maximumFractionDigits: value > 0 && value < 0.01 ? Math.min(12, -Math.floor(Math.log10(value)) + 1) : 2,
      });
}
export function usageExactCost(value: number | null, text: UsageText = currentText()): string {
  return value === null
    ? text.t("usage.unavailable")
    : text.t("usage.exactCost", { amount: text.format.number(value, { maximumFractionDigits: 12 }) });
}
/**
 * Usage rows name the tool rather than the account: a cost line is about what ran, not about who
 * paid. A provider this build does not know is shown as the raw id, because usage history outlives
 * the provider list.
 */
export function usageProviderName(provider: string): string {
  return isAgentProvider(provider) ? agentProviderCliName(provider) : provider;
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

export { type UsageSeriesRow, usageSeries, usageTotalSeries } from "@openbot/team-client/usage-series";
