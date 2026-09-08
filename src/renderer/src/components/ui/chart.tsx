// Adapted from Zaidan's chart registry (MIT): https://zaidan.carere.dev/r/kobalte/chart.json
// Keep chart behavior in the shared UI layer; OpenBot supplies its own theme and layout.
import type { ComponentProps, JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { ResponsiveContainer, Tooltip, type TooltipContentProps } from "solid-recharts";

export { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "solid-recharts";

export function ChartContainer(props: {
  children: ComponentProps<typeof ResponsiveContainer>["children"];
  label: string;
}) {
  return (
    <section class="ui-chart" aria-label={props.label}>
      <ResponsiveContainer initialDimension={{ width: 640, height: 300 }}>{props.children}</ResponsiveContainer>
    </section>
  );
}
export const ChartTooltip = Tooltip;
/**
 * `series` names each payload entry and supplies the mark that carries its identity, so a
 * multi-series card reads as a list rather than a column of bare numbers; `total` adds the
 * sum below it. Both are optional, and without them one series still renders as one value.
 */
export function ChartTooltipContent(
  props: Partial<TooltipContentProps> & {
    formatValue: (value: number) => string;
    series?: (key: string) => { name: string; mark?: JSX.Element };
    total?: boolean;
  },
) {
  const rows = () =>
    (props.payload ?? [])
      .filter((item) => typeof item.value === "number")
      .map((item) => ({ key: String(item.dataKey ?? item.name ?? ""), value: Number(item.value) }))
      .sort((a, b) => b.value - a.value);
  return (
    <Show when={props.active && props.payload?.length}>
      <div class="ui-chart-tooltip" role="tooltip">
        <strong>{String(props.label ?? "")}</strong>
        <For each={rows()}>
          {(row) => (
            <Show when={props.series} fallback={<div>{props.formatValue(row.value)}</div>}>
              {(series) => (
                <div class="ui-chart-tooltip-row">
                  <span class="ui-chart-tooltip-mark">{series()(row.key).mark}</span>
                  <span>{series()(row.key).name}</span>
                  <span class="ui-chart-tooltip-value">{props.formatValue(row.value)}</span>
                </div>
              )}
            </Show>
          )}
        </For>
        <Show when={props.total && rows().length > 1}>
          <div class="ui-chart-tooltip-row ui-chart-tooltip-total">
            <span class="ui-chart-tooltip-mark" />
            <span>Total</span>
            <span class="ui-chart-tooltip-value">
              {props.formatValue(rows().reduce((sum, row) => sum + row.value, 0))}
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
}
