/**
 * Messaging connections: a chat platform workspace, such as a Slack workspace or a Discord guild that
 * installed the OpenBot app, or a Telegram chat that added the OpenBot bot, where the agents of this
 * computer answer. Each new conversation goes to the
 * workspace's orchestrator agent, which asks its teammates and answers. The connection belongs to the
 * computer that runs the agents. Tokens travel only towards that host; no result carries one.
 */

import type { AgentModelId, AgentReasoningEffort } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";
import { TELEGRAM_ROUTE_CHATS_LIMIT } from "./signal-protocol/telegram-route";

export const MESSAGING_PLATFORMS = ["slack", "discord", "telegram"] as const;
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
  // Slack, Discord and Telegram send their events through Signal, and this host cannot reach it: it
  // is signed out, has no name yet, or Signal is down.
  "relay_unavailable",
  // The OpenBot bot is no longer in the Telegram chat.
  "removed",
] as const;
export type MessagingConnectionState = (typeof MESSAGING_CONNECTION_STATES)[number];

export const MESSAGING_CREDENTIAL_STATES = ["missing", "saved", "unreadable"] as const;
export type MessagingCredentialState = (typeof MESSAGING_CREDENTIAL_STATES)[number];

export const MESSAGING_LIMITS = {
  name: 256,
  scope: 64,
  scopes: 32,
  connections: 32,
} as const;

export interface MessagingConnection {
  /** The Slack workspace ID, the Discord guild ID, or the Telegram chat ID. */
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
  /** The agent that receives every new conversation. Null until the user adds it: nothing answers. */
  orchestratorAgentId: string | null;
}

/** The workspaces of one platform connected on this computer. */
export interface MessagingOverview {
  connections: MessagingConnection[];
}

/** One workspace of a platform: a Slack workspace ID, a Discord guild ID or a Telegram chat ID. */
export interface MessagingWorkspaceInput {
  workspaceId: string;
}

export interface SetMessagingEnabledInput {
  workspaceId: string;
  enabled: boolean;
}

/** Creates the workspace's orchestrator agent. Absent, the provider and model are a new agent's default. */
export interface AddMessagingOrchestratorInput {
  workspaceId: string;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
}

/** The new orchestrator, and the sidebar section it went to, which the screen shows collapsed. */
export interface AddMessagingOrchestratorResult {
  agentId: string;
  sectionId: string | null;
}

/** The Slack workspaces connected on this computer. */
export type SlackOverview = MessagingOverview;
export type SlackWorkspaceInput = MessagingWorkspaceInput;
export type SetSlackEnabledInput = SetMessagingEnabledInput;
export type AddSlackOrchestratorInput = AddMessagingOrchestratorInput;
export type AddSlackOrchestratorResult = AddMessagingOrchestratorResult;

/** The Telegram chats linked to this computer. Each is one connection; one orchestrator answers all. */
export type TelegramOverview = MessagingOverview;
export type TelegramChatInput = MessagingWorkspaceInput;
export type SetTelegramEnabledInput = SetMessagingEnabledInput;

/** Where the user adds the OpenBot bot: a group, or a direct chat with the bot. */
export interface ConnectTelegramChatInput {
  place: "group" | "direct";
}

/** Creates the Telegram Orchestrator, which every Telegram chat shares. */
export type AddTelegramOrchestratorInput = Omit<AddMessagingOrchestratorInput, "workspaceId">;

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
    (value.orchestratorAgentId === null || isIdentifier(value.orchestratorAgentId))
  );
}

export function isMessagingOverview(value: unknown): value is MessagingOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= MESSAGING_LIMITS.connections &&
    value.connections.every(isMessagingConnection)
  );
}

export function isAddMessagingOrchestratorResult(value: unknown): value is AddMessagingOrchestratorResult {
  return (
    isDynamicRecord(value) && isIdentifier(value.agentId) && (value.sectionId === null || isIdentifier(value.sectionId))
  );
}

/** One connection per chat, so a host has as many as the account service links to it. */
export function isTelegramOverview(value: unknown): value is TelegramOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= TELEGRAM_ROUTE_CHATS_LIMIT &&
    value.connections.every(isMessagingConnection)
  );
}
