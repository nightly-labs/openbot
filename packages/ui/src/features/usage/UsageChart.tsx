import type { HostAnalytics } from "@openbot/contracts/ipc";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "@openbot/ui/chart";
import { createMemo, For } from "solid-js";
import { useText } from "../../text";
import { UsageProviderMark } from "./UsageProviderMark";
import {
  type UsageMetric,
  usageCompact,
  usageCost,
  usageExactCost,
  usageNumber,
  usageProviderName,
  usageSeries,
  usageSeriesColor,
  usageTotalSeries,
} from "./usage-format";

export function UsageChart(props: { result: HostAnalytics; metric: UsageMetric }) {
  const text = useText();
  const { t, format } = text;
  const chart = createMemo(() => usageSeries(props.result.providerDaily, props.result.daily, props.metric));
  const formatValue = (value: number) =>
    props.metric === "cost"
      ? usageExactCost(value, text)
      : t("usage.tokensAmount", { tokens: usageNumber(value, text) });
  const named = () => chart().series[0] !== usageTotalSeries;
  return (
    <ChartContainer
      label={props.metric === "cost" ? t("usage.chart.costDescription") : t("usage.chart.tokensDescription")}
    >
      <AreaChart
        data={chart().rows}
        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
        accessibilityLayer
        role="img"
        tabIndex={0}
        aria-label={props.metric === "cost" ? t("usage.chart.costLabel") : t("usage.chart.tokensLabel")}
      >
        <CartesianGrid vertical={false} stroke="var(--openbot-border-strong)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickMargin={12}
          stroke="var(--openbot-text-muted)"
          tickFormatter={(value) => {
            const day = new Date(`${String(value)}T12:00:00Z`);
            return Number.isNaN(day.getTime())
              ? String(value)
              : format.date(day, { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width="auto"
          tickCount={4}
          interval={0}
          stroke="var(--openbot-text-muted)"
          tickFormatter={(value) =>
            props.metric === "cost" ? usageCost(Number(value), text) : usageCompact(Number(value), text)
          }
        />
        <ChartTooltip
          cursor={{ stroke: "var(--openbot-text-muted)", strokeWidth: 1 }}
          content={(contentProps: TooltipContentProps) => (
            <ChartTooltipContent
              {...contentProps}
              formatValue={formatValue}
              series={
                named()
                  ? (key: string) => ({ name: usageProviderName(key), mark: <UsageProviderMark provider={key} /> })
                  : undefined
              }
              total={named()}
            />
          )}
        />
        <For each={chart().series}>
          {(provider) => (
            <Area
              dataKey={provider}
              type="monotone"
              stroke={usageSeriesColor(provider)}
              fill={usageSeriesColor(provider)}
              fillOpacity={0.12}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </For>
      </AreaChart>
    </ChartContainer>
  );
}
