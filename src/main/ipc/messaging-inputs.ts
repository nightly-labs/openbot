// The messaging payloads. No message here quotes the input.

import type {
  AddMessagingOrchestratorInput,
  AddTelegramOrchestratorInput,
  ConnectTelegramChatInput,
  HostAddMessagingOrchestratorInput,
  HostMessagingConnectInput,
  HostMessagingPlatformInput,
  HostMessagingWorkspaceInput,
  HostSetMessagingEnabledInput,
  MessagingPlatform,
  MessagingWorkspaceInput,
  SetDiscordAccessInput,
  SetMessagingEnabledInput,
} from "@openbot/contracts/ipc";
import {
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  MESSAGING_PLATFORMS,
  parseDiscordAllowedRoles,
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

function parsePlatform(value: unknown): MessagingPlatform {
  if (!isOneOf(MESSAGING_PLATFORMS, value)) throw new Error("A messaging request is invalid.");
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
