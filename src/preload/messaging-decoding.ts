// What main answers for the Slack workspaces and Discord servers of this computer. These guard the
// renderer.

import {
  type AddMessagingOrchestratorResult,
  isAddMessagingOrchestratorResult,
  isMessagingOverview,
  type MessagingOverview,
} from "@openbot/contracts/ipc";

/** The orchestrator that main created, and the sidebar section it went to. */
export function decodeAddOrchestratorReply(value: unknown): AddMessagingOrchestratorResult {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
}

export function decodeMessagingOverviewReply(value: unknown): MessagingOverview {
  if (!isMessagingOverview(value)) throw new Error("Invalid messaging overview response.");
  return value;
}
