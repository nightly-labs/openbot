// Composition adapted from https://zaidan.carere.dev/r/kobalte/chart-area-interactive.json (MIT).
import type { HostAnalytics } from "@openbot/contracts/ipc";
import { createMemo, For } from "solid-js";
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
} from "../../components/ui/chart";
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
  const chart = createMemo(() => usageSeries(props.result.providerDaily, props.result.daily, props.metric));
  const measure = () => (props.metric === "Cost" ? "estimated cost in USD" : "processed tokens");
  const formatValue = (value: number) =>
    props.metric === "Cost" ? usageExactCost(value) : `${usageNumber(value)} tokens`;
  // A host that reports totals but no split still draws one area, and naming it "Total"
  // twice - as its own row and as the sum - would say the same number to itself.
  const named = () => chart().series[0] !== usageTotalSeries;
  return (
    <ChartContainer label={`Daily ${measure()} by provider. Exact values are available with View daily data.`}>
      <AreaChart
        data={chart().rows}
        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
        accessibilityLayer
        role="img"
        tabIndex={0}
        aria-label={`Daily ${measure()} by provider`}
      >
        <CartesianGrid vertical={false} stroke="var(--openbot-border-strong)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickMargin={12}
          stroke="var(--openbot-text-muted)"
          // Uppercased here rather than in CSS: a .recharts-* rule is a class no component
          // names, which the dead-class scan in check:ui reports.
          tickFormatter={(value) =>
            new Date(`${String(value)}T12:00:00Z`)
              .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
              .toUpperCase()
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={80}
          tickCount={4}
          stroke="var(--openbot-text-muted)"
          tickFormatter={(value) => (props.metric === "Cost" ? usageCost(Number(value)) : usageCompact(Number(value)))}
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
        {/* Overlaid, not stacked: each area is read against the shared baseline. The
            largest is drawn first so the smaller ones paint on top and stay visible. */}
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
