import { isDynamicRecord, isString } from "./runtime-values";
import {
  MACHINE_ALERT_LEVEL_MAX,
  MACHINE_ALERT_LEVEL_MIN,
  MACHINE_METRICS,
  type MachineMetric,
} from "./team-protocol/machine-resources-v1";

export { MACHINE_ALERT_LEVEL_MAX, MACHINE_ALERT_LEVEL_MIN, MACHINE_METRICS, type MachineMetric };

/**
 * The use of the machine that runs a host (`machine-resources-v1`), as the server can use it: in a
 * container, its memory and CPU limits. Each value is null when the host cannot tell. Memory counts
 * what programs can still use, so file caches do not read as used.
 */
export interface MachineMetrics {
  /** As `df` counts it: space that the file system keeps for root is neither used nor free. */
  diskUsedBytes: number | null;
  /** What the server can still write. */
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  memoryTotalBytes: number | null;
  /** The use of the CPUs the server can use, in whole percent, since the reading before. */
  cpuPercent: number | null;
  /** The CPUs the server can use, in thousandths: its CPU limit, or every core. */
  cpuMillicores: number;
  checkedAt: string;
}

/** The alert level of each metric in whole percent of use, and the owner or admin who gets the alert. */
export interface MachineAlertSettings {
  diskPercent: number;
  memoryPercent: number;
  cpuPercent: number;
  /** Null: the owner of the server. */
  responsibleMemberId: string | null;
}

export const DEFAULT_MACHINE_ALERT_SETTINGS: MachineAlertSettings = {
  diskPercent: 90,
  memoryPercent: 90,
  cpuPercent: 95,
  responsibleMemberId: null,
};

/** The level of `metric` in `settings`. */
export function machineAlertLevel(settings: MachineAlertSettings, metric: MachineMetric): number {
  return metric === "disk" ? settings.diskPercent : metric === "memory" ? settings.memoryPercent : settings.cpuPercent;
}

/** The use of `metric` from 0 to 1, or null when the host cannot tell. */
export function machineMetricRatio(metrics: MachineMetrics, metric: MachineMetric): number | null {
  if (metric === "cpu") return metrics.cpuPercent === null ? null : metrics.cpuPercent / 100;
  if (metric === "disk") {
    // As `df` counts it, so the disk is full when nothing is free for the server.
    const { diskUsedBytes: used, diskFreeBytes: free } = metrics;
    if (used === null || free === null || used + free <= 0) return null;
    return Math.min(1, Math.max(0, used / (used + free)));
  }
  const { memoryTotalBytes: total, memoryAvailableBytes: free } = metrics;
  if (total === null || free === null || total <= 0) return null;
  return Math.min(1, Math.max(0, (total - free) / total));
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNullableCount = (value: unknown): value is number | null => value === null || isCount(value);
const isLevel = (value: unknown): value is number =>
  isCount(value) && value >= MACHINE_ALERT_LEVEL_MIN && value <= MACHINE_ALERT_LEVEL_MAX;

export function decodeMachineMetrics(value: unknown): MachineMetrics {
  if (
    !isDynamicRecord(value) ||
    !isNullableCount(value.diskUsedBytes) ||
    !isNullableCount(value.diskFreeBytes) ||
    !isNullableCount(value.diskTotalBytes) ||
    !isNullableCount(value.memoryAvailableBytes) ||
    !isNullableCount(value.memoryTotalBytes) ||
    !(value.cpuPercent === null || (isCount(value.cpuPercent) && value.cpuPercent <= 100)) ||
    !isCount(value.cpuMillicores) ||
    !isString(value.checkedAt) ||
    value.checkedAt.length > 64
  )
    throw new Error("Invalid machine metrics.");
  return {
    diskUsedBytes: value.diskUsedBytes,
    diskFreeBytes: value.diskFreeBytes,
    diskTotalBytes: value.diskTotalBytes,
    memoryAvailableBytes: value.memoryAvailableBytes,
    memoryTotalBytes: value.memoryTotalBytes,
    cpuPercent: value.cpuPercent,
    cpuMillicores: value.cpuMillicores,
    checkedAt: value.checkedAt,
  };
}

/** A remote host without `machine-resources-v1` answers null, and Storage shows no machine part. */
export function decodeOptionalMachineMetrics(value: unknown): MachineMetrics | null {
  return value === null ? null : decodeMachineMetrics(value);
}

/** Fails closed on a level outside the range a host accepts, from a renderer or from a host. */
export function decodeMachineAlertSettings(value: unknown): MachineAlertSettings {
  if (
    !isDynamicRecord(value) ||
    !isLevel(value.diskPercent) ||
    !isLevel(value.memoryPercent) ||
    !isLevel(value.cpuPercent) ||
    !(
      value.responsibleMemberId === null ||
      (isString(value.responsibleMemberId) &&
        value.responsibleMemberId.length > 0 &&
        value.responsibleMemberId.length <= 128)
    )
  )
    throw new Error("Invalid machine alert settings.");
  return {
    diskPercent: value.diskPercent,
    memoryPercent: value.memoryPercent,
    cpuPercent: value.cpuPercent,
    responsibleMemberId: value.responsibleMemberId,
  };
}
