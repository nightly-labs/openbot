import { hostedPlanMachineMetrics } from "@openbot/contracts/hosted-servers";
import {
  DEFAULT_MACHINE_ALERT_SETTINGS,
  type MachineMetric,
  type MachineMetrics,
  type MachineMetricTone,
  machineAlertLevel,
  machineMetricPercent,
  machineMetricTone,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import Cpu from "lucide-react-native/icons/cpu";
import HardDrive from "lucide-react-native/icons/hard-drive";
import MemoryStick from "lucide-react-native/icons/memory-stick";
import { Pressable, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { RingArc } from "@/features/servers/components/plan-limit-ring";
import { useMachineMetrics } from "@/features/servers/model/use-machine-metrics";
import { useServerDisk } from "@/features/servers/model/use-server-storage";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

const RING_SIZE = 36;
const RING_STROKE = 2.5;
const ICON_SIZE = 14;

const METRIC_LABELS = {
  cpu: "mobile.server.machine.cpu",
  memory: "mobile.server.machine.memory",
  disk: "mobile.server.machine.disk",
} as const satisfies Record<MachineMetric, MobileTextKey>;

const METRIC_ICONS: Record<MachineMetric, LucideIcon> = { cpu: Cpu, memory: MemoryStick, disk: HardDrive };

const METRIC_ORDER = ["cpu", "memory", "disk"] as const satisfies readonly MachineMetric[];

const TONE_TEXT = {
  normal: "",
  warning: "text-warning-text",
  danger: "text-danger-text",
} as const satisfies Record<MachineMetricTone, string>;

export function MachineUsageSummary({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { canReadServerStorage, servers } = useMobileWorkspace();
  const { available, query } = useMachineMetrics(serverId);
  const server = servers.find((item) => item.id === serverId);
  const planGb = server?.hosted === true ? (server.storageGb ?? null) : null;
  const disk = useServerDisk(serverId, available && planGb !== null);
  const reading = query.data;
  if (!available || !reading || query.isError) return null;
  const metrics =
    planGb === null
      ? reading
      : disk.isPending
        ? { ...reading, diskUsedBytes: null, diskFreeBytes: null, diskTotalBytes: null }
        : hostedPlanMachineMetrics(reading, planGb, disk.data?.userBytes ?? null);
  if (METRIC_ORDER.every((metric) => machineMetricPercent(metrics, metric) === null)) return null;
  const openStorage = canReadServerStorage(serverId)
    ? () => {
        void haptics.impact("soft");
        router.push({ pathname: "/server-settings/storage", params: { serverId } });
      }
    : undefined;
  return (
    <SettingsSection title={t("mobile.server.machine.title")}>
      <View className="flex-row px-2 py-3">
        {METRIC_ORDER.map((metric) => (
          <MachineMetricItem
            key={metric}
            metrics={metrics}
            metric={metric}
            hostedPlan={planGb !== null}
            onPress={metric === "disk" ? openStorage : undefined}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function MachineMetricItem({
  metrics,
  metric,
  hostedPlan,
  onPress,
}: {
  metrics: MachineMetrics;
  metric: MachineMetric;
  hostedPlan: boolean;
  onPress: (() => void) | undefined;
}) {
  const text = useText();
  const percent = machineMetricPercent(metrics, metric);
  const tone = machineMetricTone(percent, machineAlertLevel(DEFAULT_MACHINE_ALERT_SETTINGS, metric));
  const name = text.t(METRIC_LABELS[metric]);
  const percentText = percent === null ? text.t("mobile.server.machine.unknown") : text.format.percent(percent / 100);
  const detail = metricDetail(metrics, metric, hostedPlan, text);
  const content = (
    <>
      <MachineMetricRing metric={metric} percent={percent ?? 0} tone={tone} />
      <View className="min-w-0 shrink">
        <Typography.Paragraph
          className={`font-semibold ${TONE_TEXT[tone]}`}
          numberOfLines={1}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {percentText}
        </Typography.Paragraph>
        <Typography type="body-xs" className="text-grouped-secondary" numberOfLines={1}>
          {name}
        </Typography>
      </View>
    </>
  );
  const label = [name, percentText, detail].join(", ");
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-w-0 flex-1 flex-row items-center justify-center gap-2 px-1"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityLabel={label}
      className="min-w-0 flex-1 flex-row items-center justify-center gap-2 px-1"
    >
      {content}
    </View>
  );
}

function metricDetail(
  metrics: MachineMetrics,
  metric: MachineMetric,
  hostedPlan: boolean,
  { t, format }: MobileText,
): string {
  if (metric === "cpu") {
    const cores = metrics.cpuMillicores / 1000;
    return t("mobile.server.machine.cores", {
      count: cores,
      cores: format.number(cores, { maximumFractionDigits: 2 }),
    });
  }
  if (metric === "disk") {
    const { diskUsedBytes: used, diskTotalBytes: total } = metrics;
    if (used === null || total === null) return t("mobile.server.machine.unknown");
    const size = hostedPlan ? format.fileSize : format.diskSize;
    return t("mobile.server.machine.sizeDetail", { used: size(used), total: size(total) });
  }
  const { memoryTotalBytes: total, memoryAvailableBytes: free } = metrics;
  if (total === null || free === null) return t("mobile.server.machine.unknown");
  return t("mobile.server.machine.sizeDetail", {
    used: format.fileSize(Math.max(0, total - free)),
    total: format.fileSize(total),
  });
}

function MachineMetricRing({
  metric,
  percent,
  tone,
}: {
  metric: MachineMetric;
  percent: number;
  tone: MachineMetricTone;
}) {
  const [muted, warning, danger] = useCSSVariable([
    "--openbot-text-grouped-secondary",
    "--openbot-warning",
    "--openbot-danger",
  ]);
  const color = String(tone === "danger" ? danger : tone === "warning" ? warning : muted);
  const track = String(useThemeColor("foreground"));
  const Icon = METRIC_ICONS[metric];
  const center = RING_SIZE / 2;
  const radius = (RING_SIZE - RING_STROKE) / 2;
  return (
    <View
      style={{ width: RING_SIZE, height: RING_SIZE }}
      className="items-center justify-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: "absolute" }}>
        <G rotation={-90} origin={`${center}, ${center}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={track}
            strokeOpacity={0.15}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <RingArc center={center} radius={radius} stroke={RING_STROKE} color={color} percent={percent} />
        </G>
      </Svg>
      <Icon size={ICON_SIZE} color={color} strokeWidth={1.75} />
    </View>
  );
}
