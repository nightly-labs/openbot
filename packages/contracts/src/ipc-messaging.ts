/**
 * Messaging connections: a chat platform workspace, such as a Slack workspace that installed the
 * OpenBot app, where the agents of this computer answer. The router agent picks the agent that
 * answers each new conversation. The connection belongs to the computer that runs the agents.
 * Tokens travel only towards that host; no result carries one.
 */

import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const MESSAGING_PLATFORMS = ["slack"] as const;
export type MessagingPlatform = (typeof MESSAGING_PLATFORMS)[number];

export const MESSAGING_CONNECTION_STATES = [
  "connecting",
  "connected",
  "reconnecting",
  "paused",
  "invalid_token",
  "missing_scope",
  "rate_limited",
  "secret_storage_unavailable",
  "error",
  // Slack sends the workspace's events through Signal, and this host cannot reach it: it is signed
  // out, has no name yet, or Signal is down.
  "relay_unavailable",
] as const;
export type MessagingConnectionState = (typeof MESSAGING_CONNECTION_STATES)[number];

export const MESSAGING_CREDENTIAL_STATES = ["missing", "saved", "unreadable"] as const;
export type MessagingCredentialState = (typeof MESSAGING_CREDENTIAL_STATES)[number];

export const MESSAGING_LIMITS = {
  name: 256,
  scope: 64,
  scopes: 32,
  agents: 1_000,
  connections: 32,
} as const;

export interface MessagingConnection {
  workspaceId: string;
  platform: MessagingPlatform;
  enabled: boolean;
  state: MessagingConnectionState;
  workspaceName: string;
  /** The platform user that OpenBot posts as. */
  botUserId: string | null;
  missingScopes: string[];
  /** When the connection tries again after a rate limit, as an ISO time. */
  retryAt: string | null;
  credentials: MessagingCredentialState;
  /** The agent whose model picks who answers. Null: the first agent that can answer. */
  routerAgentId: string | null;
  /** The agents that can answer. Empty: every agent. */
  agentIds: string[];
}

/** The Slack workspaces connected on this computer. */
export interface SlackOverview {
  connections: MessagingConnection[];
}

export interface SlackWorkspaceInput {
  workspaceId: string;
}

export interface SetSlackEnabledInput {
  workspaceId: string;
  enabled: boolean;
}

export interface SetSlackRoutingInput {
  workspaceId: string;
  routerAgentId: string | null;
  agentIds: string[];
}

function isScopeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MESSAGING_LIMITS.scopes &&
    value.every((scope) => isBoundedString(scope, MESSAGING_LIMITS.scope))
  );
}

export function isMessagingConnection(value: unknown): value is MessagingConnection {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isBoolean(value.enabled) &&
    isOneOf(MESSAGING_CONNECTION_STATES, value.state) &&
    isBoundedString(value.workspaceName, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.botUserId, MESSAGING_LIMITS.name) &&
    isScopeList(value.missingScopes) &&
    isNullableBoundedString(value.retryAt, 64) &&
    isOneOf(MESSAGING_CREDENTIAL_STATES, value.credentials) &&
    (value.routerAgentId === null || isIdentifier(value.routerAgentId)) &&
    Array.isArray(value.agentIds) &&
    value.agentIds.length <= MESSAGING_LIMITS.agents &&
    value.agentIds.every(isIdentifier)
  );
}

export function isSlackOverview(value: unknown): value is SlackOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= MESSAGING_LIMITS.connections &&
    value.connections.every(isMessagingConnection)
  );
}
