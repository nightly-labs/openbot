// The messaging payloads. No message here quotes the input.

import type {
  AddMessagingOrchestratorInput,
  ConnectTelegramInput,
  MessagingWorkspaceInput,
  SetMessagingEnabledInput,
  SetTelegramAgentInput,
  SetTelegramEnabledInput,
  TelegramBotInput,
} from "@openbot/contracts/ipc";
import { isAgentModel, isAgentProvider, isReasoningEffort } from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseMessagingWorkspaceInput(value: unknown): MessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetMessagingEnabledInput(value: unknown): SetMessagingEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseAddMessagingOrchestratorInput(value: unknown): AddMessagingOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddMessagingOrchestratorInput = { workspaceId: requireString(value.workspaceId, "Workspace id") };
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

export function parseConnectTelegramInput(value: unknown): ConnectTelegramInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { botToken: requireString(value.botToken, "Bot token") };
}

export function parseTelegramBotInput(value: unknown): TelegramBotInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetTelegramEnabledInput(value: unknown): SetTelegramEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseSetTelegramAgentInput(value: unknown): SetTelegramAgentInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const agentId =
    value.agentId === null || value.agentId === undefined ? null : requireString(value.agentId, "Agent id");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), agentId };
}
