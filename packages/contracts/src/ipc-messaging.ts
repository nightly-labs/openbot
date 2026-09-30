/**
 * Messaging connections: an agent that answers in an external chat platform, such as Slack. The
 * connection belongs to the computer that runs the agent. Tokens travel only towards that host; no
 * result carries one.
 */

import type { AvatarImageInput } from "./ipc-agents";
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
  // A managed Slack app exists, and the user has not installed it in the workspace yet.
  "awaiting_install",
  // A managed Slack app gets its events through Signal, and this host cannot reach it: it is signed
  // out, has no name yet, or Signal is down.
  "relay_unavailable",
] as const;
export type MessagingConnectionState = (typeof MESSAGING_CONNECTION_STATES)[number];

export const MESSAGING_CREDENTIAL_STATES = ["missing", "saved", "unreadable"] as const;
export type MessagingCredentialState = (typeof MESSAGING_CREDENTIAL_STATES)[number];

/** Bounds shared by the IPC guards and the `messaging-v1` wire codec. */
export const MESSAGING_LIMITS = {
  name: 256,
  scope: 64,
  scopes: 32,
  threads: 200,
  threadMessages: 200,
  messageText: 20_000,
  workspaces: 50,
  connections: 1_000,
} as const;

export interface MessagingConnection {
  agentId: string;
  platform: MessagingPlatform;
  enabled: boolean;
  state: MessagingConnectionState;
  workspaceName: string | null;
  /** The platform user that the agent posts as. */
  botUserId: string | null;
  missingScopes: string[];
  /** When the connection tries again after a rate limit, as an ISO time. */
  retryAt: string | null;
  credentials: MessagingCredentialState;
}

/** A Slack workspace where the OpenBot manager app can create an app for each agent. */
export interface SlackWorkspace {
  workspaceId: string;
  name: string;
}

/** One external conversation that the agent answers in its own execution thread. */
export interface MessagingThreadSummary {
  linkId: string;
  title: string;
  isDirect: boolean;
  updatedAt: string;
}

export interface MessagingOverview {
  connection: MessagingConnection | null;
  threads: MessagingThreadSummary[];
  /** The workspaces connected on this host. Empty on a host that cannot create managed apps. */
  slackWorkspaces: SlackWorkspace[];
}

/** Every agent's Slack connection on this computer, and the connected workspaces. */
export interface SlackOverview {
  connections: MessagingConnection[];
  workspaces: SlackWorkspace[];
}

export interface MessagingThreadMessage {
  id: string;
  role: "external" | "agent";
  /** The external author. Null for the agent. */
  authorName: string | null;
  text: string;
  createdAt: string;
}

export interface MessagingThread {
  linkId: string;
  title: string;
  messages: MessagingThreadMessage[];
}

export interface MessagingAgentInput {
  agentId: string;
}

export interface CreateSlackAppInput {
  agentId: string;
  workspaceId: string;
}

export interface SlackWorkspaceInput {
  workspaceId: string;
}

/** The agent's avatar as its Slack app icon: a square PNG of 512 px, which the screen draws. */
export interface SetSlackIconInput {
  agentId: string;
  image: AvatarImageInput;
}

export interface SetMessagingEnabledInput {
  agentId: string;
  enabled: boolean;
}

export interface ReadMessagingThreadInput {
  agentId: string;
  linkId: string;
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
    isIdentifier(value.agentId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isBoolean(value.enabled) &&
    isOneOf(MESSAGING_CONNECTION_STATES, value.state) &&
    isNullableBoundedString(value.workspaceName, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.botUserId, MESSAGING_LIMITS.name) &&
    isScopeList(value.missingScopes) &&
    isNullableBoundedString(value.retryAt, 64) &&
    isOneOf(MESSAGING_CREDENTIAL_STATES, value.credentials)
  );
}

export function isSlackWorkspace(value: unknown): value is SlackWorkspace {
  return (
    isDynamicRecord(value) && isIdentifier(value.workspaceId) && isBoundedString(value.name, MESSAGING_LIMITS.name)
  );
}

export function isMessagingThreadSummary(value: unknown): value is MessagingThreadSummary {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.linkId) &&
    isBoundedString(value.title, MESSAGING_LIMITS.name) &&
    isBoolean(value.isDirect) &&
    isBoundedString(value.updatedAt, 64)
  );
}

export function isMessagingOverview(value: unknown): value is MessagingOverview {
  return (
    isDynamicRecord(value) &&
    (value.connection === null || isMessagingConnection(value.connection)) &&
    Array.isArray(value.threads) &&
    value.threads.length <= MESSAGING_LIMITS.threads &&
    value.threads.every(isMessagingThreadSummary) &&
    Array.isArray(value.slackWorkspaces) &&
    value.slackWorkspaces.length <= MESSAGING_LIMITS.workspaces &&
    value.slackWorkspaces.every(isSlackWorkspace)
  );
}

export function isSlackOverview(value: unknown): value is SlackOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= MESSAGING_LIMITS.connections &&
    value.connections.every(isMessagingConnection) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.length <= MESSAGING_LIMITS.workspaces &&
    value.workspaces.every(isSlackWorkspace)
  );
}

function isMessagingThreadMessage(value: unknown): value is MessagingThreadMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(["external", "agent"] as const, value.role) &&
    isNullableBoundedString(value.authorName, MESSAGING_LIMITS.name) &&
    isBoundedString(value.text, MESSAGING_LIMITS.messageText) &&
    isBoundedString(value.createdAt, 64)
  );
}

export function isMessagingThread(value: unknown): value is MessagingThread {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.linkId) &&
    isBoundedString(value.title, MESSAGING_LIMITS.name) &&
    Array.isArray(value.messages) &&
    value.messages.length <= MESSAGING_LIMITS.threadMessages &&
    value.messages.every(isMessagingThreadMessage)
  );
}

// The replies of a host's `messaging-v1` routes, as the desktop main process and the browser client
// read them. The route codec has already checked their bounds; these give them their IPC types and
// fail closed on anything else. The preload has its own decoders.

export function decodeMessagingOverview(value: unknown): MessagingOverview {
  if (!isMessagingOverview(value)) throw new Error("Invalid messaging overview.");
  return value;
}

export function decodeMessagingThread(value: unknown): MessagingThread {
  if (!isMessagingThread(value)) throw new Error("Invalid messaging thread.");
  return value;
}
