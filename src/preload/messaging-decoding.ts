// What main answers for the Slack workspaces, Discord servers, Telegram chats and WhatsApp numbers of
// this computer.
// These guard the renderer.

import {
  type AddMessagingOrchestratorResult,
  type DiscordAccess,
  type DiscordRoleList,
  isAddMessagingOrchestratorResult,
  isDiscordAccess,
  isDiscordRoleList,
  isMessagingOverview,
  isTelegramOverview,
  isWhatsAppGroupList,
  isWhatsAppLinkState,
  isWhatsAppOverview,
  type MessagingOverview,
  type TelegramOverview,
  type WhatsAppGroupList,
  type WhatsAppLinkState,
  type WhatsAppOverview,
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

export function decodeDiscordAccessReply(value: unknown): DiscordAccess {
  if (!isDiscordAccess(value)) throw new Error("Invalid Discord access response.");
  return value;
}

export function decodeDiscordRolesReply(value: unknown): DiscordRoleList {
  if (!isDiscordRoleList(value)) throw new Error("Invalid Discord roles response.");
  return value;
}

export function decodeWhatsAppOverviewReply(value: unknown): WhatsAppOverview {
  if (!isWhatsAppOverview(value)) throw new Error("Invalid WhatsApp overview response.");
  return value;
}

export function decodeWhatsAppLinkStateReply(value: unknown): WhatsAppLinkState {
  if (!isWhatsAppLinkState(value)) throw new Error("Invalid WhatsApp link response.");
  return value;
}

export function decodeWhatsAppGroupsReply(value: unknown): WhatsAppGroupList {
  if (!isWhatsAppGroupList(value)) throw new Error("Invalid WhatsApp groups response.");
  return value;
}
