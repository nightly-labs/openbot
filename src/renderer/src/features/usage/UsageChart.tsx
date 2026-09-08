// Composition adapted from https://zaidan.carere.dev/r/kobalte/chart-area-interactive.json (MIT).
import type { HostAnalytics } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  XAxis,
  YAxis,
} from "../../components/ui/chart";
import { type UsageMetric, usageCompact, usageCost, usageExactCost, usageNumber } from "./usage-format";

export function UsageChart(props: { result: HostAnalytics; metric: UsageMetric }) {
  const data = createMemo(() =>
    props.result.daily.map((day) => ({
      date: day.date,
      value: props.metric === "Cost" ? day.estimatedCostUsd : day.processedTokens,
    })),
  );
  return (
    <figure class="agent-usage-figure">
      <ChartContainer
        label={`Daily ${props.metric === "Cost" ? "estimated cost in USD" : "processed tokens"}. Exact values are available with View daily data.`}
      >
        <AreaChart
          data={data()}
          margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
          accessibilityLayer
          role="img"
          tabIndex={0}
          aria-label={`Daily ${props.metric === "Cost" ? "estimated cost in USD" : "processed tokens"}`}
        >
          <CartesianGrid vertical={false} stroke="var(--openbot-border-strong)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickMargin={12}
            stroke="var(--openbot-text-muted)"
            tickFormatter={(value) =>
              new Date(`${String(value)}T12:00:00Z`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={80}
            tickCount={4}
            stroke="var(--openbot-text-muted)"
            tickFormatter={(value) =>
              props.metric === "Cost" ? usageCost(Number(value)) : usageCompact(Number(value))
            }
          />
          <ChartTooltip
            cursor={false}
            content={(contentProps) => (
              <ChartTooltipContent
                {...contentProps}
                formatValue={(value) =>
                  props.metric === "Cost" ? usageExactCost(value) : `${usageNumber(value)} tokens`
                }
              />
            )}
          />
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--openbot-text-secondary)"
            fill="var(--openbot-text-secondary)"
            fillOpacity={0.08}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      <figcaption>Daily totals · {props.result.timeZone}. Gaps indicate unavailable data.</figcaption>
    </figure>
  );
}
