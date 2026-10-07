// What main answers for the Slack workspaces and Discord servers of this computer. These guard the
// renderer.

import {
  type AddMessagingOrchestratorResult,
  isAddMessagingOrchestratorResult,
  isMessagingOverview,
  isTelegramOverview,
  type MessagingOverview,
  type TelegramOverview,
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

export function decodeTelegramOverviewReply(value: unknown): TelegramOverview {
  if (!isTelegramOverview(value)) throw new Error("Invalid Telegram overview response.");
  return value;
}
