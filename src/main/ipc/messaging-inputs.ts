// The messaging payloads. No message here quotes the input.

import type { SetSlackEnabledInput, SetSlackRoutingInput, SlackWorkspaceInput } from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
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

export function parseSetSlackRoutingInput(value: unknown): SetSlackRoutingInput {
  if (!isObject(value) || !Array.isArray(value.agentIds) || value.agentIds.length > MESSAGING_LIMITS.agents)
    throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    routerAgentId: value.routerAgentId === null ? null : requireString(value.routerAgentId, "Agent id"),
    agentIds: value.agentIds.map((agentId) => requireString(agentId, "Agent id")),
  };
}
