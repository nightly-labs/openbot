import {
  DEFAULT_MACHINE_ALERT_SETTINGS,
  type MachineMetric,
  type MachineMetrics,
  machineAlertLevel,
} from "@openbot/contracts/ipc";
import { Button, buttonVariants, ChevronRight, Popover, Progress, RadialProgress } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import {
  MACHINE_METRIC_ICONS,
  MACHINE_METRIC_LABELS,
  type MachineMetricTone,
  machineMetricPercent,
  machineMetricTone,
  useMachineMetricDetail,
} from "../files/machine-metric";

export interface UsageMachineMeterProps {
  metrics: MachineMetrics;
  /** Opens Server settings › Storage, where the disk is managed. */
  onOpenStorage: () => void;
}

/** CPU and memory decide whether a turn starts at once, so the closed meter shows only them. */
const HEADER_METRICS = ["cpu", "memory"] as const satisfies readonly MachineMetric[];

/**
 * The machine use of a server in the Usage header: a ring and a percentage for CPU and memory. A
 * click shows each one with its size, then the disk, whose row opens Storage. The colours follow the
 * default machine alert levels. When the host can read neither CPU nor memory, the meter shows nothing.
 */
export function UsageMachineMeter(props: UsageMachineMeterProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const percent = (metric: MachineMetric) => machineMetricPercent(props.metrics, metric);
  const percentText = useMetricPercentText();
  const detail = useMachineMetricDetail();
  const known = () => HEADER_METRICS.some((metric) => percent(metric) !== null);
  return (
    <Show when={known()}>
      {/* As the filter selects beside it: centred under the trigger. */}
      <Popover.Root open={open()} onOpenChange={setOpen} placement="bottom" gutter={8}>
        <Popover.Trigger
          class={buttonVariants({ variant: "ghost", size: "sm", class: "usage-machine-trigger" })}
          aria-label={t("usage.machine.label", {
            cpu: percentText(props.metrics, "cpu"),
            memory: percentText(props.metrics, "memory"),
          })}
        >
          <For each={HEADER_METRICS}>
            {(metric) => {
              const Icon = MACHINE_METRIC_ICONS[metric];
              return (
                <Show when={percent(metric) !== null}>
                  <span class="usage-machine-item" data-tone={metricTone(props.metrics, metric)}>
                    <Icon class="usage-machine-icon" />
                    <RadialProgress
                      class="usage-machine-ring"
                      aria-hidden="true"
                      value={percent(metric) ?? 0}
                      tone={ringTone(metricTone(props.metrics, metric))}
                    />
                    <span class="usage-machine-value">{percentText(props.metrics, metric)}</span>
                  </span>
                </Show>
              );
            }}
          </For>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="ui-popover-menu-surface context-meter-popover usage-machine-popover">
            <header class="context-meter-header">
              <Popover.Title class="context-meter-title">{t("files.machine.title")}</Popover.Title>
            </header>
            <For each={HEADER_METRICS}>
              {(metric) => (
                <div class="usage-machine-detail" data-tone={metricTone(props.metrics, metric)}>
                  <MetricDetail metrics={props.metrics} metric={metric} />
                </div>
              )}
            </For>
            <footer class="context-meter-footer">
              <Button
                variant="ghost"
                type="button"
                class="context-meter-action usage-machine-detail usage-machine-storage"
                data-tone={metricTone(props.metrics, "disk")}
                aria-label={t("usage.machine.openStorage", {
                  percent: percentText(props.metrics, "disk"),
                  detail: detail(props.metrics, "disk"),
                })}
                onClick={() => {
                  setOpen(false);
                  props.onOpenStorage();
                }}
              >
                <MetricDetail metrics={props.metrics} metric="disk" inButton />
              </Button>
            </footer>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Show>
  );
}

/** The percentage of one metric, or "Unknown" when the host could not read it. */
function useMetricPercentText() {
  const { t, format } = useText();
  return (metrics: MachineMetrics, metric: MachineMetric) => {
    const value = machineMetricPercent(metrics, metric);
    return value === null ? t("files.machine.unknown") : format.percent(value / 100);
  };
}

function metricTone(metrics: MachineMetrics, metric: MachineMetric): MachineMetricTone {
  return machineMetricTone(
    machineMetricPercent(metrics, metric),
    machineAlertLevel(DEFAULT_MACHINE_ALERT_SETTINGS, metric),
  );
}

/**
 * The name, the percentage, the bar and the size of one metric. In the Storage button the bar is
 * hidden from screen readers: the button label names the disk use.
 */
function MetricDetail(props: { metrics: MachineMetrics; metric: MachineMetric; inButton?: boolean }): JSX.Element {
  const { t } = useText();
  const percentText = useMetricPercentText();
  const detail = useMachineMetricDetail();
  const Icon = MACHINE_METRIC_ICONS[props.metric];
  return (
    <>
      <span class="usage-machine-detail-heading">
        <span class="usage-machine-detail-name">
          <Icon class="usage-machine-icon" />
          {t(MACHINE_METRIC_LABELS[props.metric])}
        </span>
        <span class="usage-machine-detail-value">
          {percentText(props.metrics, props.metric)}
          <Show when={props.inButton}>
            <ChevronRight class="usage-machine-chevron" aria-hidden="true" />
          </Show>
        </span>
      </span>
      <Progress
        class="usage-machine-bar"
        value={machineMetricPercent(props.metrics, props.metric) ?? 0}
        aria-label={props.inButton ? undefined : t(MACHINE_METRIC_LABELS[props.metric])}
        aria-hidden={props.inButton ? "true" : undefined}
        getValueLabel={() => t("files.machine.used", { percent: percentText(props.metrics, props.metric) })}
      />
      <span class="usage-machine-detail-size">{detail(props.metrics, props.metric)}</span>
    </>
  );
}

/** Below the alert level the ring takes the quiet text colour that the stylesheet sets. */
function ringTone(tone: MachineMetricTone) {
  return tone === "normal" ? "accent" : tone;
}
