import type { HostAnalytics } from "@openbot/contracts/ipc";
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "@openbot/ui/chart";
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { UsageProviderMark } from "./UsageProviderMark";
import {
  type UsageBucket,
  type UsageMetric,
  usageAxisCost,
  usageBucketRows,
  usageCompact,
  usageCost,
  usageNumber,
  usageProviderName,
  usageSeries,
  usageTotalSeries,
} from "./usage-format";

const CURSOR = { className: "ui-chart-cursor" };
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

function chartDay(value: string): Date | null {
  const day = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(day.getTime()) ? null : day;
}

export function UsageChart(props: {
  result: HostAnalytics;
  metric: UsageMetric;
  bucket: UsageBucket;
  label: string;
  seriesColor: (provider: string) => string;
}) {
  const text = useText();
  const { t, format } = text;
  const chart = createMemo(() => {
    const metric = props.metric;
    const bucket = props.bucket;
    const seriesColor = props.seriesColor;
    const daily = usageSeries(props.result.providerDaily, props.result.daily, metric);
    const named = daily.series[0] !== usageTotalSeries;
    return {
      empty: daily.rows.every((row) => daily.series.every((key) => !(Number(row[key]) > 0))),
      series: daily.series,
      rows: usageBucketRows(daily.rows, daily.series, bucket),
      named,
      fill: (provider: string) => (named ? seriesColor(provider) : "var(--openbot-accent)"),
      formatValue: (value: number) =>
        metric === "cost" ? usageCost(value, text) : t("usage.tokensAmount", { tokens: usageNumber(value, text) }),
      formatAxis: (value: unknown) =>
        metric === "cost" ? usageAxisCost(Number(value), text) : usageCompact(Number(value), text),
      formatTick: (value: unknown) => {
        const day = chartDay(String(value));
        if (!day) return String(value);
        return bucket === "month"
          ? format.date(day, { month: "short", timeZone: "UTC" })
          : format.date(day, { month: "short", day: "numeric", timeZone: "UTC" });
      },
      formatLabel: (value: string) => {
        const day = chartDay(value);
        if (!day) return value;
        if (bucket === "month") return format.date(day, { month: "long", year: "numeric", timeZone: "UTC" });
        const date = format.date(day, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
        return bucket === "week" ? t("usage.chart.weekOf", { date }) : date;
      },
      seriesInfo: named
        ? (key: string) => ({ name: usageProviderName(key), mark: <UsageProviderMark provider={key} /> })
        : undefined,
    };
  });
  return (
    <Show
      when={!chart().empty}
      fallback={
        <p class="ui-chart-empty" role="status">
          {props.metric === "cost" ? usageCost(props.result.totals.estimatedCostUsd, text) : chart().formatValue(0)}
        </p>
      }
    >
      <ChartContainer
        label={props.metric === "cost" ? t("usage.chart.costDescription") : t("usage.chart.tokensDescription")}
      >
        <BarChart
          data={chart().rows}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="24%"
          accessibilityLayer
          role="img"
          tabIndex={0}
          aria-label={props.label}
        >
          <CartesianGrid vertical={false} stroke="var(--openbot-border)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={10}
            stroke="var(--openbot-text-muted)"
            tickFormatter={chart().formatTick}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            tickCount={5}
            stroke="var(--openbot-text-muted)"
            tickFormatter={chart().formatAxis}
          />
          <ChartTooltip
            cursor={CURSOR}
            content={(contentProps: TooltipContentProps) => (
              <ChartTooltipContent
                {...contentProps}
                formatValue={chart().formatValue}
                formatLabel={chart().formatLabel}
                series={chart().seriesInfo}
                total={chart().named}
              />
            )}
          />
          <BarStack stackId="usage" radius={BAR_RADIUS}>
            <For each={chart().series}>
              {(provider) => (
                <Bar dataKey={provider} fill={chart().fill(provider)} maxBarSize={28} isAnimationActive={false} />
              )}
            </For>
          </BarStack>
        </BarChart>
      </ChartContainer>
    </Show>
  );
}
