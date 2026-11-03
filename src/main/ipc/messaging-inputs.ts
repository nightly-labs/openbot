// The messaging payloads. No message here quotes the input.

import type {
  AddMessagingOrchestratorInput,
  AddTelegramOrchestratorInput,
  AnswerWhatsAppRequestInput,
  ConnectorMessagingPlatform,
  ConnectTelegramChatInput,
  HostAddMessagingOrchestratorInput,
  HostMessagingConnectInput,
  HostMessagingPlatformInput,
  HostMessagingWorkspaceInput,
  HostSetMessagingEnabledInput,
  MessagingWorkspaceInput,
  RemoveWhatsAppSenderInput,
  SetDiscordAccessInput,
  SetMessagingEnabledInput,
  SetWhatsAppOwnNumberInput,
  StartWhatsAppLinkInput,
  WhatsAppSenderInput,
} from "@openbot/contracts/ipc";
import {
  CONNECTOR_MESSAGING_PLATFORMS,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  isWhatsAppSender,
  parseDiscordAllowedRoles,
  parseWhatsAppPhoneNumber,
  parseWhatsAppRequestCode,
} from "@openbot/contracts/ipc";
import { isBoolean, isOneOf } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseMessagingWorkspaceInput(value: unknown): MessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetMessagingEnabledInput(value: unknown): SetMessagingEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseConnectTelegramChatInput(value: unknown): ConnectTelegramChatInput {
  if (!isObject(value) || (value.place !== "group" && value.place !== "direct"))
    throw new Error("A messaging request is invalid.");
  return { place: value.place };
}

export function parseAddMessagingOrchestratorInput(value: unknown): AddMessagingOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), ...parseAddTelegramOrchestratorInput(value) };
}

export function parseAddTelegramOrchestratorInput(value: unknown): AddTelegramOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddTelegramOrchestratorInput = {};
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) throw new Error("A messaging request is invalid.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("A messaging request is invalid.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("A messaging request is invalid.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

/** A platform that a joined server's `connectors-v1` carries. WhatsApp is managed only on its host. */
function parsePlatform(value: unknown): ConnectorMessagingPlatform {
  if (!isOneOf(CONNECTOR_MESSAGING_PLATFORMS, value)) throw new Error("A messaging request is invalid.");
  return value;
}

export function parseHostMessagingPlatformInput(value: unknown): HostMessagingPlatformInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform) };
}

export function parseHostMessagingConnectInput(value: unknown): HostMessagingConnectInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  if (value.place !== null && value.place !== "group" && value.place !== "direct")
    throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), place: value.place };
}

export function parseHostMessagingWorkspaceInput(value: unknown): HostMessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), ...parseMessagingWorkspaceInput(value) };
}

export function parseHostSetMessagingEnabledInput(value: unknown): HostSetMessagingEnabledInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), ...parseSetMessagingEnabledInput(value) };
}

export function parseHostAddMessagingOrchestratorInput(value: unknown): HostAddMessagingOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    platform: parsePlatform(value.platform),
    workspaceId: value.workspaceId === null ? null : requireString(value.workspaceId, "Workspace id"),
  };
}

export function parseSetDiscordAccessInput(value: unknown): SetDiscordAccessInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const allowedRoles = parseDiscordAllowedRoles(value.allowedRoles);
  if (!allowedRoles) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), allowedRoles };
}

export function parseStartWhatsAppLinkInput(value: unknown): StartWhatsAppLinkInput {
  if (!isObject(value) || (value.method !== "qr" && value.method !== "code") || !isBoolean(value.ownNumber))
    throw new Error("A messaging request is invalid.");
  if (value.method === "qr") return { method: "qr", phoneNumber: null, ownNumber: value.ownNumber };
  const phoneNumber = parseWhatsAppPhoneNumber(value.phoneNumber);
  if (!phoneNumber) throw new Error("A messaging request is invalid.");
  return { method: "code", phoneNumber, ownNumber: value.ownNumber };
}

export function parseWhatsAppSenderInput(value: unknown): WhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  // A contact can be typed with spaces, a plus or brackets; it is stored in digits.
  const sender =
    isObject(value.sender) && value.sender.kind === "contact"
      ? { ...value.sender, id: parseWhatsAppPhoneNumber(value.sender.id) ?? "" }
      : value.sender;
  if (!isWhatsAppSender(sender)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    sender: { id: sender.id, kind: sender.kind, name: sender.name.trim() || sender.id },
  };
}

export function parseRemoveWhatsAppSenderInput(value: unknown): RemoveWhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    senderId: requireString(value.senderId, "Sender id"),
  };
}

export function parseAnswerWhatsAppRequestInput(value: unknown): AnswerWhatsAppRequestInput {
  if (!isObject(value) || !isBoolean(value.approve)) throw new Error("A messaging request is invalid.");
  const code = parseWhatsAppRequestCode(value.code);
  if (!code) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), code, approve: value.approve };
}

export function parseSetWhatsAppOwnNumberInput(value: unknown): SetWhatsAppOwnNumberInput {
  if (!isObject(value) || !isBoolean(value.ownNumber)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), ownNumber: value.ownNumber };
}
