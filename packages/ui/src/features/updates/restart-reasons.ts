import type { AppTextKey } from "@openbot/i18n";

/** The restart blockers that `checkRestartReadiness` reports, as the user reads them. */
const RESTART_REASON_LABELS: Record<string, AppTextKey> = {
  "agent-turn": "server.update.reason.agentTurn",
  "queued-delivery": "server.update.reason.queuedDelivery",
  "drain-task": "server.update.reason.drainTask",
  "routine-run": "server.update.reason.routineRun",
  "channel-work": "server.update.reason.channelWork",
  "provider-process": "server.update.reason.providerProcess",
  "remote-desktop": "server.update.reason.remoteDesktop",
  "browser-view": "server.update.reason.browserView",
  "file-transfer": "server.update.reason.fileTransfer",
  "browser-control": "server.update.reason.browserControl",
  "update-operation": "server.update.reason.updateOperation",
  initialization: "server.update.reason.initialization",
};

/** A reason from a newer version has no label here yet. */
export function restartReasonKey(reason: string): AppTextKey {
  return RESTART_REASON_LABELS[reason] ?? "server.update.reason.other";
}
