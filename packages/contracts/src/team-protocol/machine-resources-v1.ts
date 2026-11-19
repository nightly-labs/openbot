import { isDynamicRecord, isOneOf, isString } from "../runtime-values";
import { adminRoute, count, empty, fields, identifier, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const MACHINE_RESOURCES_CAPABILITY = "machine-resources-v1";

export const MACHINE_RESOURCES_ROUTES = {
  metrics: "/v1/admin/host/machine/metrics",
  alerts: "/v1/admin/host/machine/alerts",
  updateAlerts: "/v1/admin/host/machine/alerts/update",
} as const;

export const MACHINE_METRICS = ["disk", "memory", "cpu"] as const;
export type MachineMetric = (typeof MACHINE_METRICS)[number];

export const MACHINE_ALERT_LEVEL_MIN = 50;
export const MACHINE_ALERT_LEVEL_MAX = 99;

const metrics = fields({
  diskUsedBytes: nullable(count),
  diskFreeBytes: nullable(count),
  diskTotalBytes: nullable(count),
  memoryAvailableBytes: nullable(count),
  memoryTotalBytes: nullable(count),
  cpuPercent: nullable(count),
  cpuMillicores: count,
  checkedAt: string(64),
});

const alerts = fields({
  diskPercent: count,
  memoryPercent: count,
  cpuPercent: count,
  responsibleMemberId: nullable(identifier),
});

export const MACHINE_RESOURCES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MACHINE_RESOURCES_ROUTES.metrics, adminRoute(empty, metrics)],
  [MACHINE_RESOURCES_ROUTES.alerts, adminRoute(empty, alerts)],
  [MACHINE_RESOURCES_ROUTES.updateAlerts, adminRoute(alerts, alerts)],
]);

export const MACHINE_ALERT_EVENT = "machine-alert";

export interface MachineAlertEvent {
  type: typeof MACHINE_ALERT_EVENT;
  alertId: string;
  metric: MachineMetric;
  percent: number;
  level: number;
}

export function machineAlertEvent(value: unknown): MachineAlertEvent | null {
  if (!isDynamicRecord(value) || value.type !== MACHINE_ALERT_EVENT) return null;
  const { alertId, metric, percent, level } = value;
  if (
    !isString(alertId) ||
    !alertId.length ||
    alertId.length > 128 ||
    !isOneOf(MACHINE_METRICS, metric) ||
    !isPercent(percent) ||
    !isPercent(level)
  )
    throw new Error("Invalid machine alert event.");
  return { type: MACHINE_ALERT_EVENT, alertId, metric, percent, level };
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}
