import type { MachineMetric, MachineMetrics } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Cpu, HardDrive, MemoryStick } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";

/** The name, icon, use and colour of one machine metric, as Storage and the Usage header show them. */

export const MACHINE_METRIC_LABELS = {
  disk: "files.machine.disk",
  memory: "files.machine.memory",
  cpu: "files.machine.cpu",
} as const satisfies Record<MachineMetric, AppTextKey>;

export const MACHINE_METRIC_ICONS: Record<MachineMetric, (props: { class: string }) => JSX.Element> = {
  disk: (props) => <HardDrive class={props.class} aria-hidden="true" />,
  memory: (props) => <MemoryStick class={props.class} aria-hidden="true" />,
  cpu: (props) => <Cpu class={props.class} aria-hidden="true" />,
};

/**
 * "4 cores", "5.1 GB of 7.6 GB", or "31 GB of 76 GB · 45 GB free". A disk shows decimal units, as macOS
 * counts it, except the disk of a hosted plan (`hostedPlan`), which counts in binary units.
 */
export function useMachineMetricDetail() {
  const { t, format } = useText();
  return (metrics: MachineMetrics, metric: MachineMetric, hostedPlan = false): string => {
    // A container limit can be part of a core, such as 1.5.
    if (metric === "cpu") {
      const cores = metrics.cpuMillicores / 1000;
      return t("files.machine.cores", { count: cores, cores: format.number(cores, { maximumFractionDigits: 2 }) });
    }
    if (metric === "disk") {
      const { diskUsedBytes: used, diskFreeBytes: free, diskTotalBytes: total } = metrics;
      if (used === null || free === null || total === null) return t("files.machine.unknown");
      const size = hostedPlan ? format.fileSize : format.diskSize;
      return t("files.machine.diskDetail", { used: size(used), total: size(total), free: size(free) });
    }
    const { memoryTotalBytes: total, memoryAvailableBytes: free } = metrics;
    if (total === null || free === null) return t("files.machine.unknown");
    return t("files.machine.memoryDetail", {
      used: format.fileSize(Math.max(0, total - free)),
      total: format.fileSize(total),
    });
  };
}
