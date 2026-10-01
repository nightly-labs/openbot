// The messaging payloads. No message here quotes the input.

import type { AddSlackOrchestratorInput, SetSlackEnabledInput, SlackWorkspaceInput } from "@openbot/contracts/ipc";
import { isAgentModel, isAgentProvider, isReasoningEffort } from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseSlackWorkspaceInput(value: unknown): SlackWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetSlackEnabledInput(value: unknown): SetSlackEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseAddSlackOrchestratorInput(value: unknown): AddSlackOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddSlackOrchestratorInput = { workspaceId: requireString(value.workspaceId, "Workspace id") };
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
