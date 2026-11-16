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

/** The approval to read whole: the runtime snapshot carries a cut copy of it. */
export interface ReadPendingApprovalInput {
  agentId: string;
  requestId: string | number;
}

export interface RespondToApprovalInput {
  requestId: string | number;
  decision: "accept" | "decline";
}

/**
 * Which agents answer approvals without asking: the "Full access" permission level.
 *
 * This belongs to the computer that runs the agent, not to the approval, and is never carried over
 * the Team API: the released adapters freeze an approval response to `accept` or `decline`. A
 * remote host answers the approvals of its own Full access agents, so they never reach a client.
 */
export interface ApprovalAutomationPreference {
  /** Default for agents without an explicit choice. */
  defaultAutoApprove: boolean;
  autoApproveOverrides: Record<string, boolean>;
}

export const DEFAULT_APPROVAL_AUTOMATION_PREFERENCE: ApprovalAutomationPreference = {
  defaultAutoApprove: true,
  autoApproveOverrides: {},
};

export function isApprovalAutomationPreference(value: unknown): value is ApprovalAutomationPreference {
  if (!isDynamicRecord(value) || !isBoolean(value.defaultAutoApprove)) return false;
  if (!isDynamicRecord(value.autoApproveOverrides)) return false;
  const entries = Object.entries(value.autoApproveOverrides);
  return (
    entries.length <= INPUT_LIMITS.agents && entries.every(([id, enabled]) => isIdentifier(id) && isBoolean(enabled))
  );
}

export function agentAutoApprovalEnabled(preference: ApprovalAutomationPreference, agentId: string): boolean {
  if (!Object.hasOwn(preference.autoApproveOverrides, agentId)) return preference.defaultAutoApprove;
  return preference.autoApproveOverrides[agentId] === true;
}

/** `sign-in-blocked`: the site refused the sign-in from the host's address. */
export const BROWSER_TAKEOVER_REASONS = ["sign-in-blocked"] as const;
export type BrowserTakeoverReason = (typeof BROWSER_TAKEOVER_REASONS)[number];

/**
 * Why OpenBot did not fill a saved login, so a password or code card asks the user:
 * - `agent-script`: a script that the agent ran can still run in a page of this site.
 * - `field-kind`: the agent's target is not a password field, or not a code field.
 * - `login-choice`: several logins fit and the agent named none, or it named one that this site does not have.
 * - `no-secret`: the login has no password, or no authenticator key.
 * - `vault-unreadable`: the password manager could not be read.
 */
export const BROWSER_VAULT_SKIP_REASONS = [
  "agent-script",
  "field-kind",
  "login-choice",
  "no-secret",
  "vault-unreadable",
] as const;
export type BrowserVaultSkipReason = (typeof BROWSER_VAULT_SKIP_REASONS)[number];

export interface BrowserTakeoverRequest {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  tabId: string;
  secret?: BrowserSecretRequest;
  reason?: BrowserTakeoverReason;
  /** Set on a secret card when OpenBot did not fill a saved login, or could not read a password manager. */
  vaultSkip?: BrowserVaultSkipReason;
}

export function isBrowserTakeoverRequest(value: unknown): value is BrowserTakeoverRequest {
  return (
    isDynamicRecord(value) &&
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.turnId) &&
    isIdentifier(value.tabId) &&
    (value.secret === undefined || isBrowserSecretRequest(value.secret)) &&
    (value.reason === undefined || isOneOf(BROWSER_TAKEOVER_REASONS, value.reason)) &&
    (value.vaultSkip === undefined || isOneOf(BROWSER_VAULT_SKIP_REASONS, value.vaultSkip))
  );
}

export interface RespondToBrowserTakeoverInput {
  requestId: string | number;
  decision: "complete" | "cancel";
}
