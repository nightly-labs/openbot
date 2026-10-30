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
  /** The roles one Discord server can allow. */
  allowedRoles: 50,
  /** Discord's own limit of roles in a server. */
  roles: 250,
  roleName: 100,
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

/** One Discord role, by the name it had when the host read it. */
export interface MessagingRole {
  id: string;
  name: string;
}

/**
 * Who can use OpenBot in one Discord server: the members with one of these roles. Empty lets everyone.
 * OpenBot ignores a mention from anyone else.
 */
export interface DiscordAccess {
  allowedRoles: MessagingRole[];
}

/** The roles of a Discord server that a person can have, highest first, to choose from. */
export interface DiscordRoleList {
  roles: MessagingRole[];
}

export interface SetDiscordAccessInput {
  workspaceId: string;
  allowedRoles: MessagingRole[];
}

/** The Discord server of a joined server: its Discord guild ID. */
export interface HostDiscordAccessInput {
  workspaceId: string;
}

export type HostSetDiscordAccessInput = SetDiscordAccessInput;

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

/**
 * The page that a connect opens. A joined server opens no page and returns it to the client. `nonce`
 * names the Slack or Discord install, which ends in a deep link to the client; Telegram has none.
 */
export interface MessagingConnectPage {
  url: string;
  nonce: string | null;
}

/** One platform of a joined server, which an owner or admin manages from their own computer. */
export interface HostMessagingPlatformInput {
  platform: MessagingPlatform;
}

/** `place` is where a Telegram chat adds the bot; Slack and Discord ignore it. */
export interface HostMessagingConnectInput extends HostMessagingPlatformInput {
  place: ConnectTelegramChatInput["place"] | null;
}

export interface HostMessagingWorkspaceInput extends HostMessagingPlatformInput {
  workspaceId: string;
}

export interface HostSetMessagingEnabledInput extends HostMessagingWorkspaceInput {
  enabled: boolean;
}

/** Telegram has one orchestrator for all chats, so its `workspaceId` is null. */
export interface HostAddMessagingOrchestratorInput extends HostMessagingPlatformInput {
  workspaceId: string | null;
}

/** The host of each platform's connect page. A joined server names the page, so nothing else opens. */
const MESSAGING_PAGE_HOSTS: Record<MessagingPlatform, string> = {
  slack: "slack.com",
  discord: "discord.com",
  telegram: "t.me",
};

/** The connect page that a joined server named, when it is the platform's own https page. */
export function messagingPage(platform: MessagingPlatform, address: string | null): string | null {
  const url = address === null ? null : URL.parse(address);
  return url?.protocol === "https:" && url.hostname === MESSAGING_PAGE_HOSTS[platform] && url.port === ""
    ? url.toString()
    : null;
}

/**
 * Reads a joined server's connections. A later host can name a state or a credential state that this
 * build does not know: it shows as an error, and the connection stays in the list.
 */
export function decodeHostMessagingOverview(value: unknown): MessagingOverview {
  const connections =
    isDynamicRecord(value) && Array.isArray(value.connections) && value.connections.length <= TELEGRAM_ROUTE_CHATS_LIMIT
      ? value.connections.map((connection: unknown) =>
          isDynamicRecord(connection)
            ? {
                ...connection,
                state: isOneOf(MESSAGING_CONNECTION_STATES, connection.state) ? connection.state : "error",
                credentials: isOneOf(MESSAGING_CREDENTIAL_STATES, connection.credentials)
                  ? connection.credentials
                  : "unreadable",
              }
            : connection,
        )
      : null;
  const overview = { connections };
  if (!isTelegramOverview(overview)) throw new Error("Invalid messaging response.");
  return overview;
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

const ROLE_ID = /^[0-9]{1,24}$/u;

export function isMessagingRole(value: unknown): value is MessagingRole {
  return (
    isDynamicRecord(value) &&
    typeof value.id === "string" &&
    ROLE_ID.test(value.id) &&
    isBoundedString(value.name, MESSAGING_LIMITS.roleName)
  );
}

function isRoleList(value: unknown, limit: number): value is MessagingRole[] {
  return Array.isArray(value) && value.length <= limit && value.every(isMessagingRole);
}

export function isDiscordAccess(value: unknown): value is DiscordAccess {
  return isDynamicRecord(value) && isRoleList(value.allowedRoles, MESSAGING_LIMITS.allowedRoles);
}

export function isDiscordRoleList(value: unknown): value is DiscordRoleList {
  return isDynamicRecord(value) && isRoleList(value.roles, MESSAGING_LIMITS.roles);
}

/** A new role list, or null when it is too long, repeats a role, or has an invalid role. */
export function parseDiscordAllowedRoles(value: unknown): MessagingRole[] | null {
  if (!isRoleList(value, MESSAGING_LIMITS.allowedRoles)) return null;
  const ids = new Set(value.map((role) => role.id));
  return ids.size === value.length ? value.map((role) => ({ id: role.id, name: role.name })) : null;
}
