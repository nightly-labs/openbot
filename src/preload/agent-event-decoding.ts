// What main forwards from an agent service, local or remote, with the server it came from.
//
// An approval is checked field by field, not with `isAgentEvent`. That guard carries the Team API
// size limits, and a local provider can ask to approve a command longer than 100,000 characters or
// write access to more than 100 paths. The user must see that approval in full, so it must not fail
// here.

import {
  type AgentApproval,
  type AgentApprovalPermissions,
  type AgentEvent,
  isAgentEvent,
  type ScopedAgentEvent,
} from "@openbot/contracts/ipc";
import { decodeRecord, nullableString, requiredString } from "@openbot/contracts/ipc-decoding";
import { isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

const APPROVAL_KINDS = ["command", "file-change", "permissions"] as const;

export function decodeScopedAgentEvent(value: unknown): ScopedAgentEvent {
  const scoped = decodeRecord(value, "agent event");
  const serverId = requiredString(scoped, "serverId");
  const { bufferedLive } = scoped;
  const event = agentEvent(scoped.event);
  if (bufferedLive === undefined) return { serverId, event };
  if (!isBoolean(bufferedLive)) throw new Error("Invalid agent event.");
  return { serverId, event, bufferedLive };
}

function agentEvent(value: unknown): AgentEvent {
  const event = decodeRecord(value, "agent event");
  if (event.type === "approval") return { type: "approval", approval: approval(event.approval) };
  if (!isAgentEvent(event)) throw new Error("Invalid agent event.");
  return event;
}

function approval(value: unknown): AgentApproval {
  const approval = decodeRecord(value, "agent approval");
  const { requestId, kind, permissions } = approval;
  if (!isString(requestId) && !isNumber(requestId)) throw new Error("Invalid requestId.");
  if (!isOneOf(APPROVAL_KINDS, kind)) throw new Error("Invalid kind.");
  return {
    requestId,
    agentId: requiredString(approval, "agentId"),
    threadId: requiredString(approval, "threadId"),
    turnId: requiredString(approval, "turnId"),
    kind,
    command: nullableString(approval, "command"),
    cwd: nullableString(approval, "cwd"),
    reason: nullableString(approval, "reason"),
    grantRoot: nullableString(approval, "grantRoot"),
    permissions: permissions === null ? null : approvalPermissions(permissions),
  };
}

function approvalPermissions(value: unknown): AgentApprovalPermissions {
  const permissions = decodeRecord(value, "approval permissions");
  const fileSystem = decodeRecord(permissions.fileSystem, "approval file system permissions");
  if (!isBoolean(permissions.network)) throw new Error("Invalid network.");
  return {
    fileSystem: { read: pathList(fileSystem.read), write: pathList(fileSystem.write) },
    network: permissions.network,
  };
}

function pathList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(isString)) throw new Error("Invalid approval path list.");
  return value;
}
