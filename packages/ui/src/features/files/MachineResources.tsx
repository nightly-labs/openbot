import {
  canAdministerServer,
  MACHINE_ALERT_LEVEL_MAX,
  MACHINE_ALERT_LEVEL_MIN,
  MACHINE_METRICS,
  type MachineAlertSettings,
  type MachineMetric,
  type MachineMetrics,
  machineAlertLevel,
  machineMetricPercent,
  machineMetricTone,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SliderField,
  TriangleAlert,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { MACHINE_METRIC_ICONS, MACHINE_METRIC_LABELS, useMachineMetricDetail } from "./machine-metric";

export interface MachineResourcesProps {
  metrics: MachineMetrics | null;
  error?: string | null;
  alerts: MachineAlertSettings | null;
  members: readonly TeamMemberSummary[];
  onChangeAlerts: (settings: MachineAlertSettings) => Promise<void>;
}

const METRIC_ALERT_LABELS = {
  disk: "files.machine.diskAlert",
  memory: "files.machine.memoryAlert",
  cpu: "files.machine.cpuAlert",
} as const satisfies Record<MachineMetric, AppTextKey>;

const LEVEL_FIELDS = {
  disk: "diskPercent",
  memory: "memoryPercent",
  cpu: "cpuPercent",
} as const satisfies Record<MachineMetric, keyof MachineAlertSettings>;

export function MachineResources(props: MachineResourcesProps) {
  const { t, format } = useText();
  const metricDetail = useMachineMetricDetail();
  const headingId = `machine-${createUniqueId()}`;
  const [draftLevels, setDraftLevels] = createSignal<Partial<Record<MachineMetric, number>>>({});
  const level = (metric: MachineMetric): number | null =>
    draftLevels()[metric] ?? (props.alerts ? machineAlertLevel(props.alerts, metric) : null);
  const recipients = createMemo(() =>
    props.members.filter((member) => !member.disabled && canAdministerServer(member.role)),
  );
  const responsible = () => {
    const id = props.alerts?.responsibleMemberId ?? null;
    return recipients().find((member) => member.id === id) ?? recipients().find((member) => member.role === "owner");
  };
  const responsibleName = () => {
    const member = responsible();
    return member ? memberName(member) : "";
  };
  const passed = () =>
    MACHINE_METRICS.filter((metric) => {
      const percent = props.metrics ? machineMetricPercent(props.metrics, metric) : null;
      const limit = level(metric);
      return percent !== null && limit !== null && percent >= limit;
    });

  async function save(change: Partial<MachineAlertSettings>): Promise<void> {
    const saved = props.alerts;
    if (!saved) return;
    const stored = saved.responsibleMemberId;
    const stale = stored !== null && props.members.length > 0 && !recipients().some((member) => member.id === stored);
    await props.onChangeAlerts({ ...saved, ...(stale ? { responsibleMemberId: null } : {}), ...change });
  }

  const clearDraft = (metric: MachineMetric) =>
    setDraftLevels((levels) => {
      const { [metric]: _, ...rest } = levels;
      return rest;
    });

  return (
    <section class="storage-section machine-resources" aria-labelledby={headingId}>
      <div class="storage-section-heading-row">
        <h3 id={headingId} class="storage-section-heading">
          {t("files.machine.title")}
        </h3>
        <span class="storage-section-aside">{t("files.machine.updates")}</span>
      </div>
      <Show
        when={props.metrics}
        fallback={
          <Show when={props.error}>
            {(error) => (
              <div class="storage-message" role="alert">
                <TriangleAlert class="storage-message-icon" aria-hidden="true" />
                <p class="storage-message-description">{error()}</p>
              </div>
            )}
          </Show>
        }
      >
        {(metrics) => (
          <ul class="machine-resources-metrics">
            <For each={MACHINE_METRICS}>
              {(metric) => {
                const percent = () => machineMetricPercent(metrics(), metric);
                const tone = () => machineMetricTone(percent(), level(metric));
                const Icon = MACHINE_METRIC_ICONS[metric];
                return (
                  <li class="machine-resources-metric" data-tone={tone()}>
                    <Icon class="machine-resources-icon" />
                    <span class="machine-resources-copy">
                      <span class="machine-resources-title">{t(MACHINE_METRIC_LABELS[metric])}</span>
                      <span class="machine-resources-meta">{metricDetail(metrics(), metric)}</span>
                    </span>
                    <Show
                      when={percent() !== null}
                      fallback={<span class="machine-resources-meta">{t("files.machine.unknown")}</span>}
                    >
                      {(_) => (
                        <>
                          <span class="machine-resources-bar">
                            <Progress
                              value={percent() ?? 0}
                              aria-label={t(MACHINE_METRIC_LABELS[metric])}
                              getValueLabel={() =>
                                t("files.machine.used", { percent: format.percent((percent() ?? 0) / 100) })
                              }
                            />
                            <Show when={level(metric)} keyed>
                              {(limit) => (
                                <span
                                  class="machine-resources-threshold"
                                  style={{ "inset-inline-start": `${limit}%` }}
                                  aria-hidden="true"
                                />
                              )}
                            </Show>
                          </span>
                          <span class="machine-resources-value">{format.percent((percent() ?? 0) / 100)}</span>
                        </>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        )}
      </Show>
      <Show when={passed()[0]} keyed>
        {(metric) => (
          <div class="storage-message machine-resources-alert" role="status">
            <TriangleAlert class="storage-message-icon" aria-hidden="true" />
            <div>
              <p class="storage-message-title">{aboveText(metric)}</p>
              <Show when={responsible()}>
                {(member) => (
                  <p class="storage-message-description">
                    {t("files.machine.alertSent", { name: memberName(member()) })}
                  </p>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={props.alerts}>
        <h3 class="storage-section-heading">{t("files.machine.alerts")}</h3>
        <div class="machine-resources-settings">
          <Show when={recipients().length > 0}>
            <div class="machine-resources-setting">
              <span class="machine-resources-copy">
                <span class="machine-resources-title">{t("files.machine.notify")}</span>
                <span class="machine-resources-meta">{t("files.machine.notifyDescription")}</span>
              </span>
              <Select<TeamMemberSummary>
                class="settings-modal-select machine-resources-select"
                options={recipients()}
                optionValue="id"
                optionTextValue={memberName}
                value={responsible() ?? null}
                placement="bottom-end"
                onChange={(member) => {
                  if (member) void save({ responsibleMemberId: member.id });
                }}
                itemComponent={(item) => <SelectItem item={item.item}>{memberName(item.item.rawValue)}</SelectItem>}
              >
                <SelectTrigger size="sm" aria-label={t("files.machine.notifyLabel", { name: responsibleName() })}>
                  <SelectValue<TeamMemberSummary>>
                    {(state) => {
                      const member = state.selectedOption();
                      return member ? memberName(member) : "";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </Show>
          <For each={MACHINE_METRICS}>
            {(metric) => (
              <SliderField
                label={t(METRIC_ALERT_LABELS[metric])}
                value={level(metric) ?? MACHINE_ALERT_LEVEL_MAX}
                minValue={MACHINE_ALERT_LEVEL_MIN}
                maxValue={MACHINE_ALERT_LEVEL_MAX}
                formatValue={(value) => t("files.machine.above", { percent: format.percent(value / 100) })}
                onChange={(value) => setDraftLevels((levels) => ({ ...levels, [metric]: value }))}
                onChangeEnd={(value) => {
                  if (props.alerts && value !== machineAlertLevel(props.alerts, metric))
                    void save({ [LEVEL_FIELDS[metric]]: value });
                  clearDraft(metric);
                }}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );

  function aboveText(metric: MachineMetric): string {
    const params = { level: format.percent((level(metric) ?? 0) / 100) };
    if (metric === "disk") return t("files.machine.diskAbove", params);
    return metric === "memory" ? t("files.machine.memoryAbove", params) : t("files.machine.cpuAbove", params);
  }
}

function memberName(member: TeamMemberSummary): string {
  return member.name?.trim() || member.username || member.email || member.id;
}
