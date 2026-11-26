import type { AgentModelId, AgentReasoningEffort } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";
import { TELEGRAM_ROUTE_CHATS_LIMIT } from "./signal-protocol/telegram-route";

export const MESSAGING_PLATFORMS = ["slack", "discord", "telegram", "whatsapp"] as const;
export type MessagingPlatform = (typeof MESSAGING_PLATFORMS)[number];
export const CONNECTOR_MESSAGING_PLATFORMS = ["slack", "discord", "telegram"] as const;
export type ConnectorMessagingPlatform = (typeof CONNECTOR_MESSAGING_PLATFORMS)[number];

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
  "relay_unavailable",
  "removed",
  "not_linked",
] as const;
export type MessagingConnectionState = (typeof MESSAGING_CONNECTION_STATES)[number];

export const MESSAGING_CREDENTIAL_STATES = ["missing", "saved", "unreadable"] as const;
export type MessagingCredentialState = (typeof MESSAGING_CREDENTIAL_STATES)[number];

export const MESSAGING_LIMITS = {
  name: 256,
  scope: 64,
  scopes: 32,
  connections: 32,
  allowedRoles: 50,
  allowedSenders: 200,
  pendingRequests: 3,
  groups: 500,
  roles: 250,
  roleName: 100,
} as const;

export interface MessagingConnection {
  workspaceId: string;
  platform: MessagingPlatform;
  enabled: boolean;
  state: MessagingConnectionState;
  workspaceName: string;
  botUserId: string | null;
  missingScopes: string[];
  retryAt: string | null;
  credentials: MessagingCredentialState;
  orchestratorAgentId: string | null;
}

export interface MessagingOverview {
  connections: MessagingConnection[];
}

export interface MessagingWorkspaceInput {
  workspaceId: string;
}

export interface SetMessagingEnabledInput {
  workspaceId: string;
  enabled: boolean;
}

export interface AddMessagingOrchestratorInput {
  workspaceId: string;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
}

export interface AddMessagingOrchestratorResult {
  agentId: string;
  sectionId: string | null;
}

export interface MessagingRole {
  id: string;
  name: string;
}

export interface DiscordAccess {
  allowedRoles: MessagingRole[];
}

export interface DiscordRoleList {
  roles: MessagingRole[];
}

export interface SetDiscordAccessInput {
  workspaceId: string;
  allowedRoles: MessagingRole[];
}

export interface HostDiscordAccessInput {
  workspaceId: string;
}

export type HostSetDiscordAccessInput = SetDiscordAccessInput;

export type SlackOverview = MessagingOverview;
export type SlackWorkspaceInput = MessagingWorkspaceInput;
export type SetSlackEnabledInput = SetMessagingEnabledInput;
export type AddSlackOrchestratorInput = AddMessagingOrchestratorInput;
export type AddSlackOrchestratorResult = AddMessagingOrchestratorResult;

export type TelegramOverview = MessagingOverview;
export type TelegramChatInput = MessagingWorkspaceInput;
export type SetTelegramEnabledInput = SetMessagingEnabledInput;

export interface ConnectTelegramChatInput {
  place: "group" | "direct";
}

export interface MessagingConnectPage {
  url: string;
  nonce: string | null;
}

export interface HostMessagingPlatformInput {
  platform: ConnectorMessagingPlatform;
}

export interface HostMessagingConnectInput extends HostMessagingPlatformInput {
  place: ConnectTelegramChatInput["place"] | null;
}

export interface HostMessagingWorkspaceInput extends HostMessagingPlatformInput {
  workspaceId: string;
}

export interface HostSetMessagingEnabledInput extends HostMessagingWorkspaceInput {
  enabled: boolean;
}

export interface HostAddMessagingOrchestratorInput extends HostMessagingPlatformInput {
  workspaceId: string | null;
}

const MESSAGING_PAGE_HOSTS: Record<ConnectorMessagingPlatform, string> = {
  slack: "slack.com",
  discord: "discord.com",
  telegram: "t.me",
};

export function messagingPage(platform: ConnectorMessagingPlatform, address: string | null): string | null {
  const url = address === null ? null : URL.parse(address);
  return url?.protocol === "https:" && url.hostname === MESSAGING_PAGE_HOSTS[platform] && url.port === ""
    ? url.toString()
    : null;
}

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

export function parseDiscordAllowedRoles(value: unknown): MessagingRole[] | null {
  if (!isRoleList(value, MESSAGING_LIMITS.allowedRoles)) return null;
  const ids = new Set(value.map((role) => role.id));
  return ids.size === value.length ? value.map((role) => ({ id: role.id, name: role.name })) : null;
}

export interface WhatsAppSender {
  id: string;
  kind: "contact" | "group";
  name: string;
  readOnly?: boolean;
}

export interface WhatsAppPairingRequest {
  code: string;
  senderId: string;
  name: string;
  expiresAt: string;
}

export interface WhatsAppAccount {
  workspaceId: string;
  ownNumber: boolean;
  workingMessage?: boolean;
  statusReactions?: boolean;
  allowedSenders: WhatsAppSender[];
  pendingRequests: WhatsAppPairingRequest[];
}

export interface WhatsAppOverview extends MessagingOverview {
  accounts: WhatsAppAccount[];
}

export interface StartWhatsAppLinkInput {
  method: "qr" | "code";
  phoneNumber: string | null;
  ownNumber: boolean;
}

export interface WhatsAppLinkState {
  status: "idle" | "waiting" | "linked" | "failed";
  qr: string | null;
  code: string | null;
  workspaceId: string | null;
  error: "timeout" | "refused" | "busy" | "unavailable" | null;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
}

export interface WhatsAppGroupList {
  groups: WhatsAppGroup[];
}

export interface WhatsAppSenderInput {
  workspaceId: string;
  sender: WhatsAppSender;
}

export interface RemoveWhatsAppSenderInput {
  workspaceId: string;
  senderId: string;
}

export interface AnswerWhatsAppRequestInput {
  workspaceId: string;
  code: string;
  approve: boolean;
}

export interface SetWhatsAppOwnNumberInput {
  workspaceId: string;
  ownNumber: boolean;
}

export interface SetWhatsAppWorkingMessageInput {
  workspaceId: string;
  workingMessage: boolean;
}

export interface WhatsAppWorkingMessageList {
  numbers: { workspaceId: string; workingMessage: boolean }[];
}

export interface SetWhatsAppStatusReactionsInput {
  workspaceId: string;
  statusReactions: boolean;
}

export interface WhatsAppStatusReactionsList {
  numbers: { workspaceId: string; statusReactions: boolean }[];
}

export interface SetWhatsAppSenderReadOnlyInput {
  workspaceId: string;
  senderId: string;
  readOnly: boolean;
}

export interface WhatsAppReadOnlyList {
  numbers: { workspaceId: string; readOnly: string[] }[];
}

export type AddWhatsAppOrchestratorInput = Omit<AddMessagingOrchestratorInput, "workspaceId">;

const WHATSAPP_NUMBER = /^[0-9]{5,20}$/u;
const WHATSAPP_GROUP = /^[0-9-]{5,64}@g\.us$/u;
const WHATSAPP_CODE = /^[A-Z0-9]{6}$/u;
const PAIRING_CODE = /^[A-Z0-9]{8}$/u;

export function isWhatsAppSender(value: unknown): value is WhatsAppSender {
  return (
    isDynamicRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "contact"
      ? WHATSAPP_NUMBER.test(value.id)
      : value.kind === "group" && WHATSAPP_GROUP.test(value.id)) &&
    isBoundedString(value.name, MESSAGING_LIMITS.name) &&
    (value.readOnly === undefined || isBoolean(value.readOnly))
  );
}

function isWhatsAppPairingRequest(value: unknown): value is WhatsAppPairingRequest {
  return (
    isDynamicRecord(value) &&
    typeof value.code === "string" &&
    WHATSAPP_CODE.test(value.code) &&
    typeof value.senderId === "string" &&
    WHATSAPP_NUMBER.test(value.senderId) &&
    isBoundedString(value.name, MESSAGING_LIMITS.name) &&
    isBoundedString(value.expiresAt, 64)
  );
}

function isWhatsAppAccount(value: unknown): value is WhatsAppAccount {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isBoolean(value.ownNumber) &&
    (value.workingMessage === undefined || isBoolean(value.workingMessage)) &&
    (value.statusReactions === undefined || isBoolean(value.statusReactions)) &&
    Array.isArray(value.allowedSenders) &&
    value.allowedSenders.length <= MESSAGING_LIMITS.allowedSenders &&
    value.allowedSenders.every(isWhatsAppSender) &&
    Array.isArray(value.pendingRequests) &&
    value.pendingRequests.length <= MESSAGING_LIMITS.pendingRequests &&
    value.pendingRequests.every(isWhatsAppPairingRequest)
  );
}

export function isWhatsAppOverview(value: unknown): value is WhatsAppOverview {
  return (
    isMessagingOverview(value) &&
    isDynamicRecord(value) &&
    Array.isArray(value.accounts) &&
    value.accounts.length <= MESSAGING_LIMITS.connections &&
    value.accounts.every(isWhatsAppAccount)
  );
}

export function isWhatsAppLinkState(value: unknown): value is WhatsAppLinkState {
  return (
    isDynamicRecord(value) &&
    isOneOf(["idle", "waiting", "linked", "failed"] as const, value.status) &&
    isNullableBoundedString(value.qr, 1_024) &&
    (value.code === null || (typeof value.code === "string" && PAIRING_CODE.test(value.code))) &&
    (value.workspaceId === null || isIdentifier(value.workspaceId)) &&
    (value.error === null || isOneOf(WHATSAPP_LINK_ERRORS, value.error))
  );
}

const WHATSAPP_LINK_ERRORS = ["timeout", "refused", "busy", "unavailable"] as const;

export function decodeHostWhatsAppOverview(value: unknown): WhatsAppOverview {
  const overview = { ...decodeHostMessagingOverview(value), accounts: isDynamicRecord(value) ? value.accounts : null };
  if (!isWhatsAppOverview(overview)) throw new Error("Invalid WhatsApp response.");
  return overview;
}

export function isWhatsAppWorkingMessageList(value: unknown): value is WhatsAppWorkingMessageList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.numbers) &&
    value.numbers.length <= MESSAGING_LIMITS.connections &&
    value.numbers.every(
      (entry: unknown) => isDynamicRecord(entry) && isIdentifier(entry.workspaceId) && isBoolean(entry.workingMessage),
    )
  );
}

export function withWhatsAppWorkingMessages(
  overview: WhatsAppOverview,
  settings: WhatsAppWorkingMessageList | null,
): WhatsAppOverview {
  if (!settings) return overview;
  const values = new Map(settings.numbers.map((entry) => [entry.workspaceId, entry.workingMessage]));
  return {
    ...overview,
    accounts: overview.accounts.map((account) => {
      const workingMessage = values.get(account.workspaceId);
      return workingMessage === undefined ? account : { ...account, workingMessage };
    }),
  };
}

export function isWhatsAppStatusReactionsList(value: unknown): value is WhatsAppStatusReactionsList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.numbers) &&
    value.numbers.length <= MESSAGING_LIMITS.connections &&
    value.numbers.every(
      (entry: unknown) => isDynamicRecord(entry) && isIdentifier(entry.workspaceId) && isBoolean(entry.statusReactions),
    )
  );
}

export function withWhatsAppStatusReactions(
  overview: WhatsAppOverview,
  settings: WhatsAppStatusReactionsList | null,
): WhatsAppOverview {
  if (!settings) return overview;
  const values = new Map(settings.numbers.map((entry) => [entry.workspaceId, entry.statusReactions]));
  return {
    ...overview,
    accounts: overview.accounts.map((account) => {
      const statusReactions = values.get(account.workspaceId);
      return statusReactions === undefined ? account : { ...account, statusReactions };
    }),
  };
}

export function isWhatsAppReadOnlyList(value: unknown): value is WhatsAppReadOnlyList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.numbers) &&
    value.numbers.length <= MESSAGING_LIMITS.connections &&
    value.numbers.every(
      (entry: unknown) =>
        isDynamicRecord(entry) &&
        isIdentifier(entry.workspaceId) &&
        Array.isArray(entry.readOnly) &&
        entry.readOnly.length <= MESSAGING_LIMITS.allowedSenders &&
        entry.readOnly.every((id: unknown) => isBoundedString(id, 128)),
    )
  );
}

export function withWhatsAppReadOnly(
  overview: WhatsAppOverview,
  settings: WhatsAppReadOnlyList | null,
): WhatsAppOverview {
  if (!settings) return overview;
  const values = new Map(settings.numbers.map((entry) => [entry.workspaceId, new Set(entry.readOnly)]));
  return {
    ...overview,
    accounts: overview.accounts.map((account) => {
      const readOnly = values.get(account.workspaceId);
      return readOnly
        ? {
            ...account,
            allowedSenders: account.allowedSenders.map((sender) => ({ ...sender, readOnly: readOnly.has(sender.id) })),
          }
        : account;
    }),
  };
}

export function decodeHostWhatsAppLinkState(value: unknown): WhatsAppLinkState {
  const state =
    isDynamicRecord(value) && value.error !== null && !isOneOf(WHATSAPP_LINK_ERRORS, value.error)
      ? { ...value, error: "unavailable" }
      : value;
  if (!isWhatsAppLinkState(state)) throw new Error("Invalid WhatsApp response.");
  return state;
}

export function isWhatsAppGroupList(value: unknown): value is WhatsAppGroupList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.groups) &&
    value.groups.length <= MESSAGING_LIMITS.groups &&
    value.groups.every(
      (group: unknown) =>
        isDynamicRecord(group) &&
        typeof group.id === "string" &&
        WHATSAPP_GROUP.test(group.id) &&
        isBoundedString(group.name, MESSAGING_LIMITS.name),
    )
  );
}

export function parseWhatsAppPhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s()+-]/gu, "");
  return WHATSAPP_NUMBER.test(digits) ? digits : null;
}

export function parseWhatsAppRequestCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return WHATSAPP_CODE.test(code) ? code : null;
}
