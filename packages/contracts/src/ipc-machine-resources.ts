import { isDynamicRecord, isString } from "./runtime-values";
import {
  MACHINE_ALERT_LEVEL_MAX,
  MACHINE_ALERT_LEVEL_MIN,
  MACHINE_METRICS,
  type MachineMetric,
} from "./team-protocol/machine-resources-v1";

export { MACHINE_ALERT_LEVEL_MAX, MACHINE_ALERT_LEVEL_MIN, MACHINE_METRICS, type MachineMetric };

export interface MachineMetrics {
  diskUsedBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  memoryTotalBytes: number | null;
  cpuPercent: number | null;
  cpuMillicores: number;
  checkedAt: string;
}

export interface MachineAlertSettings {
  diskPercent: number;
  memoryPercent: number;
  cpuPercent: number;
  responsibleMemberId: string | null;
}

export const DEFAULT_MACHINE_ALERT_SETTINGS: MachineAlertSettings = {
  diskPercent: 90,
  memoryPercent: 90,
  cpuPercent: 95,
  responsibleMemberId: null,
};

export function machineAlertLevel(settings: MachineAlertSettings, metric: MachineMetric): number {
  return metric === "disk" ? settings.diskPercent : metric === "memory" ? settings.memoryPercent : settings.cpuPercent;
}

export function machineMetricRatio(metrics: MachineMetrics, metric: MachineMetric): number | null {
  if (metric === "cpu") return metrics.cpuPercent === null ? null : metrics.cpuPercent / 100;
  if (metric === "disk") {
    const { diskUsedBytes: used, diskFreeBytes: free } = metrics;
    if (used === null || free === null || used + free <= 0) return null;
    return Math.min(1, Math.max(0, used / (used + free)));
  }
  const { memoryTotalBytes: total, memoryAvailableBytes: free } = metrics;
  if (total === null || free === null || total <= 0) return null;
  return Math.min(1, Math.max(0, (total - free) / total));
}

export type MachineMetricTone = "normal" | "warning" | "danger";

export function machineMetricPercent(metrics: MachineMetrics, metric: MachineMetric): number | null {
  const ratio = machineMetricRatio(metrics, metric);
  return ratio === null ? null : Math.floor(ratio * 100);
}

export function machineMetricTone(percent: number | null, level: number | null): MachineMetricTone {
  if (percent === null || level === null || percent < level) return "normal";
  return percent >= Math.max(95, level + 10) ? "danger" : "warning";
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

export function decodeOptionalMachineMetrics(value: unknown): MachineMetrics | null {
  return value === null ? null : decodeMachineMetrics(value);
}

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
