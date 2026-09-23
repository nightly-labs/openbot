import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString, isRequestId } from "./ipc-bounded-values";
import { type BrowserSecretRequest, isBrowserSecretRequest } from "./ipc-browser-secret";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export type AgentApprovalKind = "command" | "file-change" | "permissions";

export interface AgentApprovalPermissions {
  fileSystem: {
    read: string[];
    write: string[];
  };
  network: boolean;
}

function isAgentApprovalPermissions(value: unknown): value is AgentApprovalPermissions {
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.fileSystem) &&
    isPathList(value.fileSystem.read) &&
    isPathList(value.fileSystem.write) &&
    isBoolean(value.network)
  );
}

function isPathList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= INPUT_LIMITS.agents &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path))
  );
}

export interface AgentApproval {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  kind: AgentApprovalKind;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  grantRoot: string | null;
  permissions: AgentApprovalPermissions | null;
}

export function isAgentApproval(value: unknown): value is AgentApproval {
  if (!isDynamicRecord(value)) return false;
  return (
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.turnId) &&
    isOneOf(["command", "file-change", "permissions"] as const, value.kind) &&
    isNullableBoundedString(value.command, INPUT_LIMITS.messageText) &&
    isNullableBoundedString(value.cwd, INPUT_LIMITS.path) &&
    isNullableBoundedString(value.reason, INPUT_LIMITS.messageText) &&
    isNullableBoundedString(value.grantRoot, INPUT_LIMITS.path) &&
    (value.permissions === null || isAgentApprovalPermissions(value.permissions))
  );
}

export interface RespondToApprovalInput {
  requestId: string | number;
  decision: "accept" | "decline";
}

/**
 * Which agents answer approvals without asking, and whether every agent does.
 *
 * This belongs to the computer that runs the agent, not to the approval, and is never carried over
 * the Team API: the released adapters freeze an approval response to `accept` or `decline`. A
 * remote host that has automation on answers its own approvals, so they never reach a client.
 */
export interface ApprovalAutomationPreference {
  /** Turbo mode. Every local agent's eligible approvals are answered automatically. */
  turbo: boolean;
  /** Default for agents without an explicit choice. */
  defaultAutoApprove: boolean;
  /** Saved choices survive Turbo being enabled and disabled. */
  autoApproveOverrides: Record<string, boolean>;
}

export const DEFAULT_APPROVAL_AUTOMATION_PREFERENCE: ApprovalAutomationPreference = {
  turbo: false,
  defaultAutoApprove: true,
  autoApproveOverrides: {},
};

export function isApprovalAutomationPreference(value: unknown): value is ApprovalAutomationPreference {
  if (!isDynamicRecord(value) || !isBoolean(value.turbo) || !isBoolean(value.defaultAutoApprove)) return false;
  if (!isDynamicRecord(value.autoApproveOverrides)) return false;
  const entries = Object.entries(value.autoApproveOverrides);
  return (
    entries.length <= INPUT_LIMITS.agents && entries.every(([id, enabled]) => isIdentifier(id) && isBoolean(enabled))
  );
}

export function agentAutoApprovalEnabled(preference: ApprovalAutomationPreference, agentId: string): boolean {
  if (preference.turbo) return true;
  if (!Object.hasOwn(preference.autoApproveOverrides, agentId)) return preference.defaultAutoApprove;
  return preference.autoApproveOverrides[agentId] === true;
}

/**
 * One call changes one thing: the global switch, or one agent's grant. Both are optional so a
 * caller never has to read the preference back before it can write a single field.
 */
export interface SetApprovalAutomationInput {
  turbo?: boolean;
  agentId?: string;
  autoApprove?: boolean;
}

export function isSetApprovalAutomationInput(value: unknown): value is SetApprovalAutomationInput {
  if (!isDynamicRecord(value)) return false;
  if (value.turbo !== undefined && !isBoolean(value.turbo)) return false;
  // A grant needs both halves. An id without a decision says nothing, and a decision without an id
  // would become a second, unreviewed way to write the global switch.
  const hasGrant = value.agentId !== undefined || value.autoApprove !== undefined;
  if (hasGrant && !(isIdentifier(value.agentId) && isBoolean(value.autoApprove))) return false;
  return value.turbo !== undefined || hasGrant;
}

export interface BrowserTakeoverRequest {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  tabId: string;
  secret?: BrowserSecretRequest;
}

export function isBrowserTakeoverRequest(value: unknown): value is BrowserTakeoverRequest {
  return (
    isDynamicRecord(value) &&
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.turnId) &&
    isIdentifier(value.tabId) &&
    (value.secret === undefined || isBrowserSecretRequest(value.secret))
  );
}

export interface RespondToBrowserTakeoverInput {
  requestId: string | number;
  decision: "complete" | "cancel";
}
