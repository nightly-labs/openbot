export interface RestartReadinessInput {
  agentWork: string[];
  hostBlockers: string[];
  activeBrowserControls: number;
  activeFileTransfers: boolean;
  updaterBusy: boolean;
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
