import { BROWSER_SECRET_CAPABILITY } from "../ipc-browser-secret";
import { CHANNEL_DELETE_CAPABILITY } from "../ipc-chat-channels";
import { MCP_SERVERS_CAPABILITY } from "../ipc-mcp-servers";
import { STORAGE_CAPABILITY } from "../ipc-storage";
import { ACP_REGISTRY_CAPABILITY } from "./acp-registry-v1";
import { AGENT_ACCESS_CAPABILITY } from "./agent-access-v1";
import { AGENT_ADMIN_CAPABILITY } from "./agent-admin-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "./agent-backup-models-v1";
import { AGENT_HIDDEN_CAPABILITY } from "./agent-hidden-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "./agent-host-settings-v1";
import { AGENT_IMPORT_CAPABILITY } from "./agent-import-v1";
import { AGENT_INSTALL_CAPABILITY } from "./agent-install-v1";
import { AGENT_MEMORIES_CAPABILITY } from "./agent-memories-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "./agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "./agent-notification-levels-v1";
import { AGENT_PUBLISH_CAPABILITY } from "./agent-publish-v1";
import { AGENT_SESSION_SETTINGS_CAPABILITY } from "./agent-session-settings-v1";
import { AGENT_TASK_LIMIT_CAPABILITY } from "./agent-task-limit-v1";
import { AGENT_TASK_UI_BLOCKS_CAPABILITY } from "./agent-task-ui-blocks-v1";
import { AGENT_TASKS_CAPABILITY } from "./agent-tasks-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "./agent-thread-files-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "./agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY } from "./agent-threads-v1";
import { AGENT_UPDATE_CAPABILITY } from "./agent-update-v1";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "./bitwarden-connector-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "./browser-navigation-v1";
import { BROWSER_PAGE_STATE_CAPABILITY } from "./browser-page-state-v1";
import { BROWSER_PROFILES_CAPABILITY } from "./browser-profiles-v1";
import { BROWSER_SECRET_VAULT_CAPABILITY } from "./browser-secret-vault-v1";
import { BROWSER_SIGN_IN_CAPABILITY } from "./browser-sign-in-v1";
import { BROWSER_USER_CONTROL_CAPABILITY } from "./browser-user-control-v1";
import {
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY,
  TEAM_BROWSER_VIEW_CURSOR_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY,
} from "./browser-view-v1";
import { TEAM_CHANNEL_ATTENTION_CAPABILITY } from "./channel-attention-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "./claude-api-key-v1";
import { CONNECTORS_CAPABILITY } from "./connectors-v1";
import { CONTEXT_RESET_CAPABILITY } from "./context-reset-v1";
import { TEAM_CONTEXT_USAGE_CAPABILITY } from "./context-usage-v1";
import { CONVERSATION_FILE_SEARCH_CAPABILITY } from "./conversation-file-search-v1";
import { CUSTOM_PROVIDER_HARNESS_CAPABILITY } from "./custom-provider-harness-v1";
import { DISCORD_ACCESS_CAPABILITY } from "./discord-access-v1";
import { EVENTS_CAPABILITY } from "./events-v1";
import { FOCUS_USE_CAPABILITY } from "./focus-use-v1";
import { TEAM_HISTORY_EXTENT_CAPABILITY } from "./history-extent-v1";
import { HOST_ADMIN_CAPABILITY } from "./host-admin-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "./host-member-update-v1";
import { HOST_RELEASE_CAPABILITY } from "./host-release-v1";
import { HOST_TIMEZONE_CAPABILITY } from "./host-timezone-v1";
import { HOST_UPDATE_CAPABILITY } from "./host-update-v1";
import { HOSTED_SITES_CAPABILITY } from "./hosted-sites-v1";
import { INSTANCE_TRANSFER_CAPABILITY } from "./instance-transfer-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "./live-activity-push-v1";
import { MACHINE_RESOURCES_CAPABILITY } from "./machine-resources-v1";
import { MCP_SIGN_IN_APP_CAPABILITY } from "./mcp-sign-in-app-v1";
import { MCP_SIGN_IN_CAPABILITY } from "./mcp-sign-in-v1";
import { MEMORY_REVIEW_CAPABILITY } from "./memory-review-v1";
import { TEAM_MESSAGE_CLIENT_ID_CAPABILITY } from "./message-client-id-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "./onepassword-connector-v1";
import { PROMPT_CACHE_TTL_CAPABILITY } from "./prompt-cache-ttl-v1";
import { TEAM_PROMPT_MULTI_SELECT_CAPABILITY } from "./prompt-multi-select-v1";
import { PROVIDER_ACCOUNT_RELAY_CAPABILITY } from "./provider-account-relay-v1";
import { PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY } from "./provider-account-relay-v2";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "./provider-accounts-v1";
import { PROVIDER_DEFAULT_CAPABILITY } from "./provider-default-v1";
import { PROVIDER_HOST_SIGN_IN_CAPABILITY } from "./provider-host-sign-in-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "./provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "./provider-usage-reset-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "./providers-v1";
import { PROVIDERS_RUNTIMES_V2_CAPABILITY } from "./providers-v2";
import { PROVIDERS_SIGN_IN_V3_CAPABILITY } from "./providers-v3";
import { PROVIDERS_V4_CAPABILITY } from "./providers-v4";
import { PROVIDERS_V5_CAPABILITY } from "./providers-v5";
import { PROVIDERS_V8_CAPABILITY } from "./providers-v8";
import { ANDROID_PUSH_NOTIFICATIONS_CAPABILITY } from "./push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_CAPABILITY } from "./push-notifications-v1";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "./queue-edit-v1";
import { QUIET_TURN_CAPABILITY } from "./quiet-turn-v1";
import { ROUTINE_FLOWS_CAPABILITY } from "./routine-flows-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "./routine-recovery-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "./routine-results-v1";
import { SHARED_TABLES_CAPABILITY } from "./shared-tables-v1";
import { SIDE_QUESTION_CAPABILITY } from "./side-question-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "./sign-in-relay-v1";
import { SKILLS_ADMIN_CAPABILITY } from "./skills-admin-v1";
import { SKILLS_EVENTS_CAPABILITY } from "./skills-events-v1";
import { STORAGE_DISK_CAPABILITY } from "./storage-disk-v1";
import { TEAM_SUBAGENTS_CAPABILITY } from "./subagents-v1";
import { TEAM_UI_BLOCKS_CAPABILITY } from "./ui-blocks-v1";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "./v8";
import { TEAM_LONG_CAPABILITY_LISTS_CAPABILITY, TEAM_PROTOCOL_V9_CAPABILITIES } from "./v9";
import { VAULT_IMPORT_CAPABILITY } from "./vault-import-v1";
import { VAULT_CAPABILITY } from "./vault-v1";
import { VAULT_V2_CAPABILITY } from "./vault-v2";
import { WEBHOOK_TESTS_CAPABILITY } from "./webhook-tests-v1";
import { WORKFLOWS_CAPABILITY } from "./workflows-v1";
import { WORKSPACE_DIRECTORY_CAPABILITY } from "./workspace-directory-v1";

export const TEAM_SEMANTIC_TAGS_CAPABILITY = "installed-skills";
export const TEAM_AGENT_ACTIVITY_CAPABILITY = "agent-activity";
export const TEAM_CONVERSATION_UNREAD_CAPABILITY = "conversation-unread";
export const TEAM_MODEL_SCOPED_USAGE_CAPABILITY = "model-scoped-usage";
/**
 * A host that accepts a provider, model and reasoning effort on agent creation. Older hosts drop
 * the fields in their frozen request projection and start the agent on their own default, so the
 * client only sends a chosen pair — and only offers the choice — when the host advertises this.
 */
export const TEAM_AGENT_CREATE_MODEL_CAPABILITY = "agent-create-model";
export const TEAM_MEDIA_ATTACHMENTS_CAPABILITY = "media-attachments";
export const TEAM_EML_ATTACHMENTS_CAPABILITY = "eml-attachments";
export const TEAM_ZIP_ATTACHMENTS_CAPABILITY = "zip-attachments";
export const TEAM_MP4_ATTACHMENTS_CAPABILITY = "mp4-attachments";
/**
 * Frozen optional member-leave-v1 contract: a bodyless `POST /v1/team/leave` answered with 204. The
 * caller, a member or an admin, removes their own membership with the same effects as an admin's
 * `DELETE /v1/team/members/:id`: the member row and every session of it go, on every device. The
 * owner is refused. A host without the capability answers 404, and the client only logs out.
 * Widening any of it needs a second capability string.
 */
export const TEAM_MEMBER_LEAVE_CAPABILITY = "member-leave-v1";
/**
 * Frozen optional queue-window-v1 contract: a bounded queue snapshot. On a protocol 7 request that
 * advertises it, `GET /v1/agents/:agentId/queue` and `POST /v1/agents/:agentId/queue/edit` keep every
 * queued, starting and running delivery. Then they keep every failed, interrupted and cancelled
 * delivery, newest first, while it fits in one WebRTC frame. Then they keep the newest completed
 * deliveries: at most 100, while they fit. The kept
 * deliveries stay in queue order, and the response keeps the frozen shape and keys. A request
 * without the capability gets the full list, as before. Widening any of it needs a second
 * capability string.
 */
export const TEAM_QUEUE_WINDOW_CAPABILITY = "queue-window-v1";
export {
  ACP_REGISTRY_CAPABILITY,
  AGENT_ACCESS_CAPABILITY,
  AGENT_ADMIN_CAPABILITY,
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_HIDDEN_CAPABILITY,
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  AGENT_MEMORIES_CAPABILITY,
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  AGENT_SESSION_SETTINGS_CAPABILITY,
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_UI_BLOCKS_CAPABILITY,
  AGENT_TASKS_CAPABILITY,
  AGENT_THREAD_FILES_CAPABILITY,
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREADS_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  BITWARDEN_CONNECTOR_CAPABILITY,
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PROFILES_CAPABILITY,
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_USER_CONTROL_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CONNECTORS_CAPABILITY,
  CONTEXT_RESET_CAPABILITY,
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  DISCORD_ACCESS_CAPABILITY,
  EVENTS_CAPABILITY,
  FOCUS_USE_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  HOST_TIMEZONE_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  INSTANCE_TRANSFER_CAPABILITY,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  MACHINE_RESOURCES_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  MCP_SIGN_IN_APP_CAPABILITY,
  MCP_SIGN_IN_CAPABILITY,
  MEMORY_REVIEW_CAPABILITY,
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  PROMPT_CACHE_TTL_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V5_CAPABILITY,
  PROVIDERS_V8_CAPABILITY,
  PUSH_NOTIFICATIONS_CAPABILITY,
  QUIET_TURN_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  ROUTINE_RECOVERY_CAPABILITY,
  ROUTINE_RESULTS_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  SIDE_QUESTION_CAPABILITY,
  SIGN_IN_RELAY_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  STORAGE_CAPABILITY,
  STORAGE_DISK_CAPABILITY,
  TEAM_BROWSER_NAVIGATION_CAPABILITY,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY,
  TEAM_BROWSER_VIEW_CURSOR_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  VAULT_CAPABILITY,
  VAULT_IMPORT_CAPABILITY,
  VAULT_V2_CAPABILITY,
  WEBHOOK_TESTS_CAPABILITY,
  WORKFLOWS_CAPABILITY,
  WORKSPACE_DIRECTORY_CAPABILITY,
};

export const TEAM_CURRENT_CAPABILITIES = [
  BROWSER_SECRET_CAPABILITY,
  ...TEAM_PROTOCOL_V9_CAPABILITIES,
  "remote-desktop-setup",
  TEAM_QUEUE_EDIT_CAPABILITY,
  TEAM_BROWSER_NAVIGATION_CAPABILITY,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_BROWSER_VIEW_CURSOR_CAPABILITY,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_VIEWPORT_CAPABILITY,
  TEAM_BROWSER_VIEW_CONTEXT_MENU_CAPABILITY,
  "agent-profile-generation",
  "agent-analytics",
  "host-analytics",
  TEAM_SEMANTIC_TAGS_CAPABILITY,
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
  TEAM_MODEL_SCOPED_USAGE_CAPABILITY,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_ZIP_ATTACHMENTS_CAPABILITY,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  "channel-chats-v1",
  CHANNEL_DELETE_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  STORAGE_CAPABILITY,
  AGENT_ADMIN_CAPABILITY,
  AGENT_MEMORIES_CAPABILITY,
  AGENT_SESSION_SETTINGS_CAPABILITY,
  ACP_REGISTRY_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V5_CAPABILITY,
  PROVIDERS_V8_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  TEAM_MEMBER_LEAVE_CAPABILITY,
  CONTEXT_RESET_CAPABILITY,
  EVENTS_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  QUIET_TURN_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  INSTANCE_TRANSFER_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  WORKSPACE_DIRECTORY_CAPABILITY,
  AGENT_HOST_SETTINGS_CAPABILITY,
  MCP_SIGN_IN_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  MCP_SIGN_IN_APP_CAPABILITY,
  SIGN_IN_RELAY_CAPABILITY,
  CONNECTORS_CAPABILITY,
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  PUSH_NOTIFICATIONS_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  PROVIDER_ACCOUNTS_CAPABILITY,
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  HOST_TIMEZONE_CAPABILITY,
  ROUTINE_RECOVERY_CAPABILITY,
  FOCUS_USE_CAPABILITY,
  AGENT_HIDDEN_CAPABILITY,
  TEAM_QUEUE_WINDOW_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  AGENT_TASKS_CAPABILITY,
  BROWSER_USER_CONTROL_CAPABILITY,
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_SIGN_IN_CAPABILITY,
  AGENT_MEMORY_LIMIT_CAPABILITY,
  DISCORD_ACCESS_CAPABILITY,
  SIDE_QUESTION_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  AGENT_ACCESS_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
  AGENT_BACKUP_MODELS_CAPABILITY,
  ROUTINE_RESULTS_CAPABILITY,
  WEBHOOK_TESTS_CAPABILITY,
  PROVIDER_USAGE_RESET_CAPABILITY,
  BITWARDEN_CONNECTOR_CAPABILITY,
  AGENT_TASK_LIMIT_CAPABILITY,
  BROWSER_PROFILES_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  STORAGE_DISK_CAPABILITY,
  MACHINE_RESOURCES_CAPABILITY,
  PROMPT_CACHE_TTL_CAPABILITY,
  PROVIDER_DEFAULT_CAPABILITY,
  CLAUDE_API_KEY_CAPABILITY,
  WORKFLOWS_CAPABILITY,
  AGENT_THREADS_CAPABILITY,
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_FILES_CAPABILITY,
  VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_CAPABILITY,
  VAULT_IMPORT_CAPABILITY,
  VAULT_V2_CAPABILITY,
  AGENT_TASK_UI_BLOCKS_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  MEMORY_REVIEW_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  PROVIDER_SIGN_OUT_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
] as const;

export type TeamCurrentCapability = (typeof TEAM_CURRENT_CAPABILITIES)[number];

const TEAM_CURRENT_CAPABILITY_SET = new Set<string>(TEAM_CURRENT_CAPABILITIES);

export function isTeamCurrentCapability(value: string): value is TeamCurrentCapability {
  return TEAM_CURRENT_CAPABILITY_SET.has(value);
}

export function supportsTeamSemanticTags(capabilities: readonly string[] | ReadonlySet<string>): boolean {
  return [...capabilities].includes(TEAM_SEMANTIC_TAGS_CAPABILITY);
}

export function isConversationUnreadRoute(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/v1\/agents\/[^/]+\/conversation\/unread$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

/** The queue snapshot route. Its response carries the `editing` mark beside the frozen keys. */
export function isQueueSnapshotRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/queue$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

/**
 * The agent conversation routes. Their responses carry the `expectsReply` mark beside the frozen
 * keys. The read and unread routes keep their own paths and are not included.
 */
export function isConversationRoute(method: string, path: string): boolean {
  return (
    method === "GET" &&
    /^\/v1\/agents\/[^/]+\/conversation(?:-page)?$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

export function isAgentProfileRoute(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/v1\/agents\/profile\/(generate|save)$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

export function isAgentAnalyticsRoute(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/agents\/[^/]+\/analytics$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

export function isHostAnalyticsRoute(method: string, path: string): boolean {
  return method === "GET" && new URL(path, "http://openbot.invalid").pathname === "/v1/analytics";
}

export function isAgentCreateRoute(method: string, path: string): boolean {
  return method === "POST" && new URL(path, "http://openbot.invalid").pathname === "/v1/agents";
}

/**
 * The agent message route. Its request carries the sender's `timezone` and `clientMessageId` beside
 * the frozen keys.
 */
export function isAgentMessageRoute(method: string, path: string): boolean {
  return method === "POST" && /^\/v1\/agents\/[^/]+\/messages$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

// Keep the first request readable by every released peer. The v7 marker lets a current
// host return the expanded list; older hosts ignore the marker and retain all old features.
// A protocol 6 peer reads at most 64 capabilities, so each new capability is v7 only.
// The v8 marker stays out: a client sends it only after the host reports protocol 8.
export const TEAM_BOOTSTRAP_CAPABILITIES = TEAM_CURRENT_CAPABILITIES.filter(
  (capability) =>
    capability !== TEAM_OPEN_PROVIDERS_CAPABILITY &&
    capability !== AGENT_MEMORIES_CAPABILITY &&
    capability !== AGENT_SESSION_SETTINGS_CAPABILITY &&
    capability !== ACP_REGISTRY_CAPABILITY &&
    capability !== PROVIDERS_V5_CAPABILITY &&
    capability !== PROVIDERS_V8_CAPABILITY &&
    capability !== PROVIDER_HOST_SIGN_IN_CAPABILITY &&
    capability !== MCP_SIGN_IN_APP_CAPABILITY &&
    capability !== SIGN_IN_RELAY_CAPABILITY &&
    capability !== CONNECTORS_CAPABILITY &&
    capability !== CONVERSATION_FILE_SEARCH_CAPABILITY &&
    capability !== ROUTINE_FLOWS_CAPABILITY &&
    capability !== TEAM_HISTORY_EXTENT_CAPABILITY &&
    capability !== PUSH_NOTIFICATIONS_CAPABILITY &&
    capability !== ANDROID_PUSH_NOTIFICATIONS_CAPABILITY &&
    capability !== PROVIDER_ACCOUNTS_CAPABILITY &&
    capability !== ONEPASSWORD_CONNECTOR_CAPABILITY &&
    capability !== HOST_TIMEZONE_CAPABILITY &&
    capability !== ROUTINE_RECOVERY_CAPABILITY &&
    capability !== INSTANCE_TRANSFER_CAPABILITY &&
    capability !== FOCUS_USE_CAPABILITY &&
    capability !== AGENT_HIDDEN_CAPABILITY &&
    capability !== TEAM_QUEUE_WINDOW_CAPABILITY &&
    capability !== BROWSER_USER_CONTROL_CAPABILITY &&
    capability !== BROWSER_PAGE_STATE_CAPABILITY &&
    capability !== BROWSER_SIGN_IN_CAPABILITY &&
    capability !== TEAM_UI_BLOCKS_CAPABILITY &&
    capability !== AGENT_TASKS_CAPABILITY &&
    capability !== AGENT_MEMORY_LIMIT_CAPABILITY &&
    capability !== DISCORD_ACCESS_CAPABILITY &&
    capability !== SIDE_QUESTION_CAPABILITY &&
    capability !== TEAM_SUBAGENTS_CAPABILITY &&
    capability !== AGENT_ACCESS_CAPABILITY &&
    capability !== TEAM_PROMPT_MULTI_SELECT_CAPABILITY &&
    capability !== TEAM_CHANNEL_ATTENTION_CAPABILITY &&
    capability !== AGENT_BACKUP_MODELS_CAPABILITY &&
    capability !== ROUTINE_RESULTS_CAPABILITY &&
    capability !== WEBHOOK_TESTS_CAPABILITY &&
    capability !== PROVIDER_USAGE_RESET_CAPABILITY &&
    capability !== BITWARDEN_CONNECTOR_CAPABILITY &&
    capability !== AGENT_TASK_LIMIT_CAPABILITY &&
    capability !== BROWSER_PROFILES_CAPABILITY &&
    capability !== PROVIDER_ACCOUNT_RELAY_CAPABILITY &&
    capability !== PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY &&
    capability !== STORAGE_DISK_CAPABILITY &&
    capability !== MACHINE_RESOURCES_CAPABILITY &&
    capability !== PROMPT_CACHE_TTL_CAPABILITY &&
    capability !== PROVIDER_DEFAULT_CAPABILITY &&
    capability !== CLAUDE_API_KEY_CAPABILITY &&
    capability !== WORKFLOWS_CAPABILITY &&
    capability !== AGENT_THREADS_CAPABILITY &&
    capability !== AGENT_THREAD_READS_CAPABILITY &&
    capability !== AGENT_THREAD_FILES_CAPABILITY &&
    capability !== TEAM_MP4_ATTACHMENTS_CAPABILITY &&
    capability !== VAULT_CAPABILITY &&
    capability !== BROWSER_SECRET_VAULT_CAPABILITY &&
    capability !== VAULT_IMPORT_CAPABILITY &&
    capability !== VAULT_V2_CAPABILITY &&
    capability !== AGENT_TASK_UI_BLOCKS_CAPABILITY &&
    capability !== TEAM_CONTEXT_USAGE_CAPABILITY &&
    capability !== MEMORY_REVIEW_CAPABILITY &&
    capability !== AGENT_NOTIFICATION_LEVELS_CAPABILITY &&
    capability !== PROVIDER_SIGN_OUT_CAPABILITY &&
    capability !== CUSTOM_PROVIDER_HARNESS_CAPABILITY,
);
/**
 * The capabilities that only a protocol 9 peer sends and gets. Protocols 7 and 8 read at most 128
 * capabilities, and their lists are full, so each capability that comes after them is here. A host
 * leaves these out of the compatibility list of an older peer (`teamCapabilitiesVisibleToProtocol`).
 */
export const TEAM_PROTOCOL_V9_ONLY_CAPABILITIES: ReadonlySet<string> = new Set<TeamCurrentCapability>([
  TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
]);
// A v8 host reads at most 128 capabilities, so a client sends the protocol 9 ones only after it
// negotiates protocol 9.
const TEAM_PROTOCOL_V8_CURRENT_CAPABILITIES = TEAM_CURRENT_CAPABILITIES.filter(
  (capability) => !TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(capability),
);
// A v7 host does not know the v8 markers, so a client sends them only after it negotiates protocol 8.
const TEAM_PROTOCOL_V7_CURRENT_CAPABILITIES = TEAM_PROTOCOL_V8_CURRENT_CAPABILITIES.filter(
  (capability) =>
    capability !== TEAM_OPEN_PROVIDERS_CAPABILITY &&
    capability !== PROVIDERS_V8_CAPABILITY &&
    capability !== TEAM_CONTEXT_USAGE_CAPABILITY,
);
export function teamCapabilitiesForProtocol(protocol: number | null | undefined): readonly TeamCurrentCapability[] {
  if (protocol === null || protocol === undefined || protocol < 7) return TEAM_BOOTSTRAP_CAPABILITIES;
  if (protocol >= 9) return TEAM_CURRENT_CAPABILITIES;
  return protocol === 8 ? TEAM_PROTOCOL_V8_CURRENT_CAPABILITIES : TEAM_PROTOCOL_V7_CURRENT_CAPABILITIES;
}
/** The capabilities that a peer of `protocol` reads: below protocol 9, without the protocol 9 ones. */
export function teamCapabilitiesVisibleToProtocol<T extends string>(capabilities: readonly T[], protocol: number): T[] {
  return protocol >= 9
    ? [...capabilities]
    : capabilities.filter((capability) => !TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(capability));
}
export function legacyTeamCapabilities(capabilities: readonly string[]): string[] {
  return capabilities.filter(
    (capability) =>
      capability !== "local-providers-v3" &&
      capability !== TEAM_OPEN_PROVIDERS_CAPABILITY &&
      capability !== AGENT_MEMORIES_CAPABILITY &&
      capability !== AGENT_SESSION_SETTINGS_CAPABILITY &&
      capability !== ACP_REGISTRY_CAPABILITY &&
      capability !== PROVIDERS_V5_CAPABILITY &&
      capability !== PROVIDERS_V8_CAPABILITY &&
      capability !== PROVIDER_HOST_SIGN_IN_CAPABILITY &&
      capability !== MCP_SIGN_IN_APP_CAPABILITY &&
      capability !== SIGN_IN_RELAY_CAPABILITY &&
      capability !== CONNECTORS_CAPABILITY &&
      capability !== CONVERSATION_FILE_SEARCH_CAPABILITY &&
      capability !== ROUTINE_FLOWS_CAPABILITY &&
      capability !== TEAM_HISTORY_EXTENT_CAPABILITY &&
      capability !== PUSH_NOTIFICATIONS_CAPABILITY &&
      capability !== ANDROID_PUSH_NOTIFICATIONS_CAPABILITY &&
      capability !== PROVIDER_ACCOUNTS_CAPABILITY &&
      capability !== ONEPASSWORD_CONNECTOR_CAPABILITY &&
      capability !== HOST_TIMEZONE_CAPABILITY &&
      capability !== ROUTINE_RECOVERY_CAPABILITY &&
      capability !== INSTANCE_TRANSFER_CAPABILITY &&
      capability !== FOCUS_USE_CAPABILITY &&
      capability !== AGENT_HIDDEN_CAPABILITY &&
      capability !== TEAM_QUEUE_WINDOW_CAPABILITY &&
      capability !== BROWSER_USER_CONTROL_CAPABILITY &&
      capability !== BROWSER_PAGE_STATE_CAPABILITY &&
      capability !== BROWSER_SIGN_IN_CAPABILITY &&
      capability !== TEAM_UI_BLOCKS_CAPABILITY &&
      capability !== AGENT_TASKS_CAPABILITY &&
      capability !== AGENT_MEMORY_LIMIT_CAPABILITY &&
      capability !== DISCORD_ACCESS_CAPABILITY &&
      capability !== SIDE_QUESTION_CAPABILITY &&
      capability !== TEAM_SUBAGENTS_CAPABILITY &&
      capability !== AGENT_ACCESS_CAPABILITY &&
      capability !== TEAM_PROMPT_MULTI_SELECT_CAPABILITY &&
      capability !== TEAM_CHANNEL_ATTENTION_CAPABILITY &&
      capability !== AGENT_BACKUP_MODELS_CAPABILITY &&
      capability !== ROUTINE_RESULTS_CAPABILITY &&
      capability !== WEBHOOK_TESTS_CAPABILITY &&
      capability !== PROVIDER_USAGE_RESET_CAPABILITY &&
      capability !== BITWARDEN_CONNECTOR_CAPABILITY &&
      capability !== AGENT_TASK_LIMIT_CAPABILITY &&
      capability !== BROWSER_PROFILES_CAPABILITY &&
      capability !== PROVIDER_ACCOUNT_RELAY_CAPABILITY &&
      capability !== PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY &&
      capability !== STORAGE_DISK_CAPABILITY &&
      capability !== MACHINE_RESOURCES_CAPABILITY &&
      capability !== PROMPT_CACHE_TTL_CAPABILITY &&
      capability !== PROVIDER_DEFAULT_CAPABILITY &&
      capability !== CLAUDE_API_KEY_CAPABILITY &&
      capability !== WORKFLOWS_CAPABILITY &&
      capability !== AGENT_THREADS_CAPABILITY &&
      capability !== AGENT_THREAD_READS_CAPABILITY &&
      capability !== AGENT_THREAD_FILES_CAPABILITY &&
      capability !== TEAM_MP4_ATTACHMENTS_CAPABILITY &&
      capability !== VAULT_CAPABILITY &&
      capability !== BROWSER_SECRET_VAULT_CAPABILITY &&
      capability !== VAULT_IMPORT_CAPABILITY &&
      capability !== VAULT_V2_CAPABILITY &&
      capability !== AGENT_TASK_UI_BLOCKS_CAPABILITY &&
      capability !== TEAM_CONTEXT_USAGE_CAPABILITY &&
      capability !== MEMORY_REVIEW_CAPABILITY &&
      capability !== AGENT_NOTIFICATION_LEVELS_CAPABILITY &&
      capability !== PROVIDER_SIGN_OUT_CAPABILITY &&
      capability !== CUSTOM_PROVIDER_HARNESS_CAPABILITY &&
      capability !== TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
  );
}
