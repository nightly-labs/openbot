// Adapted from Zaidan's chart registry (MIT): https://zaidan.carere.dev/r/kobalte/chart.json
// Keep chart behavior in the shared UI layer; OpenBot supplies its own theme and layout.
import type { ComponentProps } from "@solidjs/web";
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
export function ChartTooltipContent(props: Partial<TooltipContentProps> & { formatValue: (value: number) => string }) {
  return (
    <Show when={props.active && props.payload?.length}>
      <div class="ui-chart-tooltip" role="tooltip">
        <strong>{String(props.label ?? "")}</strong>
        <For each={props.payload}>
          {(item) => (
            <Show when={typeof item.value === "number"}>
              <div>{props.formatValue(Number(item.value))}</div>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
