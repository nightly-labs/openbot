import {
  MACHINE_METRICS,
  type MachineAlertSettings,
  type MachineMetric,
  type MachineMetrics,
  machineAlertLevel,
  machineMetricRatio,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { createMemo, createSignal, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { MACHINE_RESOURCES_SHOWN } from "../files/machine-resources";
import { canManageStorage } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { type SidebarCardsPort, sidebarPort } from "./sidebar-port";

const DISMISSED_KEY_PREFIX = "openbot:machine-card-dismissed:";

interface MachineCardState {
  metric: MachineMetric;
  percent: number;
  level: number;
  freeBytes: number | null;
  critical: boolean;
}

function machineCardState(metrics: MachineMetrics, alerts: MachineAlertSettings): MachineCardState | null {
  let worst: MachineCardState | null = null;
  for (const metric of MACHINE_METRICS) {
    const ratio = machineMetricRatio(metrics, metric);
    if (ratio === null) continue;
    const percent = Math.floor(ratio * 100);
    const level = machineAlertLevel(alerts, metric);
    if (percent < level || (worst && percent - level <= worst.percent - worst.level)) continue;
    worst = {
      metric,
      percent,
      level,
      freeBytes: metric === "disk" ? metrics.diskFreeBytes : metric === "memory" ? metrics.memoryAvailableBytes : null,
      critical: percent >= Math.max(95, level + 10),
    };
  }
  return worst;
}

const signature = (state: MachineCardState) => `${state.metric}:${state.level}`;

function readDismissed(serverId: string): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY_PREFIX + serverId);
  } catch {
    return null;
  }
}

function writeDismissed(serverId: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(DISMISSED_KEY_PREFIX + serverId, value);
    else window.localStorage.removeItem(DISMISSED_KEY_PREFIX + serverId);
  } catch {}
}

export function createMachineCard(server: () => ServerSummary | undefined, port: () => SidebarCardsPort = sidebarPort) {
  const [reading, setReading] = createSignal<{
    serverId: string;
    metrics: MachineMetrics;
    alerts: MachineAlertSettings;
  } | null>(null);
  const [dismissals, setDismissals] = createSignal(0);
  const target = createMemo(() => {
    const current = server();
    return MACHINE_RESOURCES_SHOWN &&
      current &&
      serverSupportsCapability(current, MACHINE_RESOURCES_CAPABILITY) &&
      canManageStorage(current)
      ? current.id
      : null;
  });

  function refresh(serverId: string): void {
    const calls = port();
    Promise.all([calls.storage.getMachineMetrics(serverId), calls.hostAdmin.getMachineAlerts(serverId)]).then(
      ([metrics, alerts]) => {
        if (untrack(target) !== serverId) return;
        setReading(metrics ? { serverId, metrics, alerts } : null);
        if (!metrics || !machineCardState(metrics, alerts)) writeDismissed(serverId, null);
      },
      () => {
        if (untrack(target) === serverId) setReading(null);
      },
    );
  }
  createUsageRefreshPoll({ target, refresh, refreshAtStart: true });

  return {
    card: createMemo(() => {
      const current = reading();
      if (!current || current.serverId !== target()) return null;
      const state = machineCardState(current.metrics, current.alerts);
      if (!state) return null;
      dismissals();
      if (!state.critical && readDismissed(current.serverId) === signature(state)) return null;
      return { ...state, serverId: current.serverId, responsibleMemberId: current.alerts.responsibleMemberId };
    }),
    refresh: () => {
      const serverId = target();
      if (serverId) refresh(serverId);
    },
    dismiss: (serverId: string, state: MachineCardState) => {
      writeDismissed(serverId, signature(state));
      setDismissals((count) => count + 1);
    },
  };
}
