import type { AnalyticsModel } from "@openbot/contracts/ipc";
import { AGENT_PROVIDERS, agentProviderName, analyticsTokens, isAgentProvider } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { UsageSeriesRow } from "@openbot/team-client/usage-series";
import { currentText, type TextValue } from "../../text";

type UsageText = Pick<TextValue, "t" | "format">;

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
export const usagePeriodDays: Record<UsagePeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
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
    ? text.t("usage.noCostEstimate")
    : text.format.currencyUsd(value, {
        minimumFractionDigits: 2,
        maximumFractionDigits: value > 0 && value < 0.01 ? Math.min(12, -Math.floor(Math.log10(value)) + 1) : 2,
      });
}
export function usageAxisCost(value: number, text: UsageText = currentText()): string {
  return Math.abs(value) >= 1000
    ? text.format.currencyUsd(value, { notation: "compact", maximumFractionDigits: 1 })
    : usageCost(value, text);
}
export function usageExactCost(value: number | null, text: UsageText = currentText()): string {
  return value === null
    ? text.t("usage.noCostEstimate")
    : text.t("usage.exactCost", { amount: text.format.number(value, { maximumFractionDigits: 12 }) });
}
export function usageProviderName(provider: string): string {
  return isAgentProvider(provider) ? agentProviderName(provider) : provider;
}
export function usageProviders(models: AnalyticsModel[]) {
  const providers = new Map<string, { provider: string; tokens: number; cost: number | null }>();
  for (const model of models) {
    const row = providers.get(model.provider) ?? { provider: model.provider, tokens: 0, cost: null };
    row.tokens += analyticsTokens(model);
    if (model.estimatedCostUsd !== null) row.cost = (row.cost ?? 0) + model.estimatedCostUsd;
    providers.set(model.provider, row);
  }
  return [...providers.values()];
}

const seriesColors: Readonly<Record<string, string>> = {
  codex: "var(--openbot-chart-series-codex)",
  claude: "var(--openbot-chart-series-claude)",
  grok: "var(--openbot-chart-series-grok)",
};
const extraSeriesColors = [
  "var(--openbot-chart-series-extra-1)",
  "var(--openbot-chart-series-extra-2)",
  "var(--openbot-chart-series-extra-3)",
  "var(--openbot-chart-series-extra-4)",
] as const;
const otherSeriesColor = "var(--openbot-chart-series-other)";

export function usageSeriesColor(provider: string): string {
  return seriesColors[provider] ?? otherSeriesColor;
}
function providerOrder(provider: string): number {
  const index = AGENT_PROVIDERS.findIndex((candidate) => candidate === provider);
  return index === -1 ? AGENT_PROVIDERS.length : index;
}
export function usageSeriesColors(providers: Iterable<string>): (provider: string) => string {
  const extras = [...new Set(providers)]
    .filter((provider) => !(provider in seriesColors))
    .sort((a, b) => providerOrder(a) - providerOrder(b) || a.localeCompare(b));
  const colors = new Map(extras.map((provider, index) => [provider, extraSeriesColors[index] ?? otherSeriesColor]));
  return (provider) => seriesColors[provider] ?? colors.get(provider) ?? otherSeriesColor;
}

export type UsageBucket = "day" | "week" | "month";
export function usageBucket(days: number): UsageBucket {
  if (days <= 45) return "day";
  return days <= 120 ? "week" : "month";
}
function bucketStart(date: string, bucket: UsageBucket): string {
  if (bucket === "day") return date;
  if (bucket === "month") return `${date.slice(0, 7)}-01`;
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
export function usageBucketRows(rows: UsageSeriesRow[], series: string[], bucket: UsageBucket): UsageSeriesRow[] {
  if (bucket === "day") return rows;
  const buckets = new Map<string, UsageSeriesRow>();
  for (const row of rows) {
    const date = bucketStart(row.date, bucket);
    let target = buckets.get(date);
    if (!target) {
      target = { date };
      for (const key of series) target[key] = null;
      buckets.set(date, target);
    }
    for (const key of series) {
      const value = row[key];
      if (typeof value === "number") {
        const current = target[key];
        target[key] = (typeof current === "number" ? current : 0) + value;
      }
    }
  }
  return [...buckets.values()];
}

export { type UsageSeriesRow, usageSeries, usageTotalSeries } from "@openbot/team-client/usage-series";
