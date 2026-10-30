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
import { sidebarPort } from "./sidebar-port";

/** A closed card stays closed on this computer, per server, until another metric or level alerts. */
const DISMISSED_KEY_PREFIX = "openbot:machine-card-dismissed:";

interface MachineCardState {
  metric: MachineMetric;
  percent: number;
  level: number;
  freeBytes: number | null;
  critical: boolean;
}

/**
 * The metric furthest above its level, or null when none passed one. Far above the level (95%, or
 * 10 points above a higher level) it is critical, as the Storage panel shows it in red.
 */
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

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
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
  } catch {
    // The card stays closed for this window when browser storage is unavailable.
  }
}

/**
 * The machine use of the selected server against its alert levels, for the sidebar machine card.
 * Only an owner or admin sees it, as only they can read the machine. A remote host without
 * `machine-resources-v1` shows no card; the storage card still warns about its disk.
 */
export function createMachineCard(server: () => ServerSummary | undefined) {
  const [reading, setReading] = createSignal<{
    serverId: string;
    metrics: MachineMetrics;
    alerts: MachineAlertSettings;
  } | null>(null);
  /** Changes on each close, so the card reads the saved choice again. */
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
    const port = sidebarPort();
    Promise.all([port.storage.getMachineMetrics(serverId), port.hostAdmin.getMachineAlerts(serverId)]).then(
      ([metrics, alerts]) => {
        // An answer for a server that is no longer selected is dropped.
        if (untrack(target) !== serverId) return;
        setReading(metrics ? { serverId, metrics, alerts } : null);
        // The use went below every level, so the next alert shows the card again.
        if (!metrics || !machineCardState(metrics, alerts)) writeDismissed(serverId, null);
      },
      // A failed read shows no card. The next poll asks again.
      () => {
        if (untrack(target) === serverId) setReading(null);
      },
    );
  }
  createUsageRefreshPoll({ target, refresh, refreshAtStart: true });

  return {
    /** The metric to show and its server, or null when the card is hidden. */
    card: createMemo(() => {
      const current = reading();
      if (!current || current.serverId !== target()) return null;
      const state = machineCardState(current.metrics, current.alerts);
      if (!state) return null;
      dismissals();
      if (!state.critical && readDismissed(current.serverId) === signature(state)) return null;
      return { ...state, serverId: current.serverId, responsibleMemberId: current.alerts.responsibleMemberId };
    }),
    /** Reads the machine again, for example after Server settings changed a level. */
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
