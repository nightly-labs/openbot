/**
 * Whether this instance may restart for a host-managed update right now.
 *
 * Every input is a point-in-time fact owned somewhere else; this module only combines them, so
 * the coordinator can poll one function. An open browser tab or a connected Team API client with
 * nothing moving never blocks: the clients reconnect after the restart.
 */
export interface RestartReadinessInput {
  /** Reasons from AgentService.hasActiveWork: turns, queued deliveries, drains, routines, channels, provider processes. */
  agentWork: string[];
  /** Reasons from HostService.describeRestartBlockers: connected streams, live browser views, moving host-side transfers. */
  hostBlockers: string[];
  /** Agent browser control sessions. */
  activeBrowserControls: number;
  /** A client-side file transfer moving in either direction. */
  activeFileTransfers: boolean;
  /** The updater itself is checking, downloading or installing. */
  updaterBusy: boolean;
  /** First initialization — including database migrations — has not succeeded yet. */
  initializationPending: boolean;
}

export interface RestartReadiness {
  safeToRestart: boolean;
  reasons: string[];
}

export function checkRestartReadiness(input: RestartReadinessInput): RestartReadiness {
  const reasons = [...input.agentWork, ...input.hostBlockers];
  if (input.activeBrowserControls > 0) reasons.push("browser-control");
  if (input.activeFileTransfers) reasons.push("file-transfer");
  if (input.updaterBusy) reasons.push("update-operation");
  if (input.initializationPending) reasons.push("initialization");
  return { safeToRestart: reasons.length === 0, reasons };
}
