import { ACP_REGISTRY_CODECS } from "./acp-registry-v1";
// The optional admin routes, one table. `teamSideRouteCodec` in `side-routes.ts` asks here, so every
// HTTP and WebRTC transport encodes an admin route with its frozen codec. A path that is not listed
// goes to the protocol adapter.
import type { OptionalRouteCodec } from "./admin-wire";
import { AGENT_ACCESS_CODECS } from "./agent-access-v1";
import { AGENT_ADMIN_CODECS } from "./agent-admin-v1";
import { AGENT_BACKUP_MODELS_CODECS } from "./agent-backup-models-v1";
import { AGENT_HIDDEN_CODECS } from "./agent-hidden-v1";
import { AGENT_HOST_SETTINGS_CODECS } from "./agent-host-settings-v1";
import { AGENT_IMPORT_CODECS } from "./agent-import-v1";
import { AGENT_INSTALL_CODECS } from "./agent-install-v1";
import { AGENT_MEMORIES_CODECS } from "./agent-memories-v1";
import { AGENT_MEMORY_LIMIT_CODECS } from "./agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_CODECS } from "./agent-notification-levels-v1";
import { AGENT_PUBLISH_CODECS } from "./agent-publish-v1";
import { AGENT_SESSION_SETTINGS_CODECS } from "./agent-session-settings-v1";
import { AGENT_TASK_LIMIT_CODECS } from "./agent-task-limit-v1";
import { AGENT_TASKS_CODECS } from "./agent-tasks-v1";
import { AGENT_THREAD_FILES_CODECS } from "./agent-thread-files-v1";
import { AGENT_THREAD_READS_CODECS } from "./agent-thread-reads-v1";
import { AGENT_THREADS_CODECS } from "./agent-threads-v1";
import { AGENT_UPDATE_CODECS } from "./agent-update-v1";
import { BITWARDEN_CONNECTOR_CODECS } from "./bitwarden-connector-v1";
import { BROWSER_PAGE_STATE_CODECS } from "./browser-page-state-v1";
import { BROWSER_PROFILES_CODECS } from "./browser-profiles-v1";
import { BROWSER_SECRET_VAULT_CODECS } from "./browser-secret-vault-v1";
import { BROWSER_SIGN_IN_CODECS } from "./browser-sign-in-v1";
import { BROWSER_USER_CONTROL_CODECS } from "./browser-user-control-v1";
import { CONNECTORS_CODECS } from "./connectors-v1";
import { CONTEXT_RESET_CODECS } from "./context-reset-v1";
import { CONVERSATION_FILE_SEARCH_CODECS } from "./conversation-file-search-v1";
import { CUSTOM_PROVIDER_HARNESS_CODECS } from "./custom-provider-harness-v1";
import { DISCORD_ACCESS_CODECS } from "./discord-access-v1";
import { EVENTS_CODECS } from "./events-v1";
import { FOCUS_USE_CODECS } from "./focus-use-v1";
import { HOST_ADMIN_CODECS } from "./host-admin-v1";
import { HOST_MEMBER_UPDATE_CODECS } from "./host-member-update-v1";
import { HOST_RELEASE_CODECS } from "./host-release-v1";
import { HOST_TIMEZONE_CODECS } from "./host-timezone-v1";
import { HOST_UPDATE_CODECS } from "./host-update-v1";
import { HOSTED_SITES_CODECS } from "./hosted-sites-v1";
import { INSTANCE_TRANSFER_CODECS } from "./instance-transfer-v1";
import { LIVE_ACTIVITY_PUSH_CODECS } from "./live-activity-push-v1";
import { MACHINE_RESOURCES_CODECS } from "./machine-resources-v1";
import { MCP_SIGN_IN_APP_CODECS } from "./mcp-sign-in-app-v1";
import { MCP_SIGN_IN_CODECS } from "./mcp-sign-in-v1";
import { MEMORY_REVIEW_CODECS } from "./memory-review-v1";
import { ONEPASSWORD_CONNECTOR_CODECS } from "./onepassword-connector-v1";
import { PROMPT_CACHE_TTL_CODECS } from "./prompt-cache-ttl-v1";
import { PROVIDER_ACCOUNT_RELAY_CODECS } from "./provider-account-relay-v1";
import { PROVIDER_ACCOUNT_RELAY_V2_CODECS } from "./provider-account-relay-v2";
import { PROVIDER_ACCOUNTS_CODECS } from "./provider-accounts-v1";
import { PROVIDER_DEFAULT_CODECS } from "./provider-default-v1";
import { PROVIDER_HOST_SIGN_IN_CODECS } from "./provider-host-sign-in-v1";
import { PROVIDER_SIGN_OUT_CODECS } from "./provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CODECS } from "./provider-usage-reset-v1";
import { PROVIDERS_ADMIN_CODECS } from "./providers-v1";
import { PROVIDERS_RUNTIMES_V2_CODECS } from "./providers-v2";
import { PROVIDERS_SIGN_IN_V3_CODECS } from "./providers-v3";
import { PROVIDERS_V4_CODECS } from "./providers-v4";
import { PROVIDERS_V5_CODECS } from "./providers-v5";
import { PROVIDERS_V8_CODECS } from "./providers-v8";
import { ANDROID_PUSH_NOTIFICATIONS_CODECS } from "./push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_CODECS } from "./push-notifications-v1";
import { ROUTINE_FLOWS_CODECS } from "./routine-flows-v1";
import { ROUTINE_RECOVERY_CODECS } from "./routine-recovery-v1";
import { ROUTINE_RESULTS_CODECS } from "./routine-results-v1";
import { SHARED_TABLES_CODECS } from "./shared-tables-v1";
import { SIDE_QUESTION_CODECS } from "./side-question-v1";
import { SIGN_IN_RELAY_CODECS } from "./sign-in-relay-v1";
import { SKILLS_ADMIN_CODECS } from "./skills-admin-v1";
import { STORAGE_DISK_CODECS } from "./storage-disk-v1";
import { VAULT_IMPORT_CODECS } from "./vault-import-v1";
import { VAULT_CODECS } from "./vault-v1";
import { VAULT_V2_CODECS } from "./vault-v2";
import { WEBHOOK_TESTS_CODECS } from "./webhook-tests-v1";
import { WORKFLOWS_CODECS } from "./workflows-v1";
import { WORKSPACE_DIRECTORY_CODECS } from "./workspace-directory-v1";

export type { OptionalRouteCodec } from "./admin-wire";

const CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  ...AGENT_ADMIN_CODECS,
  ...AGENT_MEMORIES_CODECS,
  ...SKILLS_ADMIN_CODECS,
  ...SHARED_TABLES_CODECS,
  ...AGENT_INSTALL_CODECS,
  ...AGENT_UPDATE_CODECS,
  ...PROVIDERS_ADMIN_CODECS,
  ...PROVIDERS_RUNTIMES_V2_CODECS,
  ...PROVIDERS_SIGN_IN_V3_CODECS,
  ...PROVIDERS_V4_CODECS,
  ...PROVIDERS_V5_CODECS,
  ...PROVIDERS_V8_CODECS,
  ...CUSTOM_PROVIDER_HARNESS_CODECS,
  ...AGENT_SESSION_SETTINGS_CODECS,
  ...ACP_REGISTRY_CODECS,
  ...HOST_ADMIN_CODECS,
  ...HOST_UPDATE_CODECS,
  ...HOST_TIMEZONE_CODECS,
  ...AGENT_MEMORY_LIMIT_CODECS,
  ...MEMORY_REVIEW_CODECS,
  ...PROMPT_CACHE_TTL_CODECS,
  ...PROVIDER_DEFAULT_CODECS,
  ...DISCORD_ACCESS_CODECS,
  ...HOST_RELEASE_CODECS,
  ...HOST_MEMBER_UPDATE_CODECS,
  ...CONTEXT_RESET_CODECS,
  ...EVENTS_CODECS,
  ...AGENT_IMPORT_CODECS,
  ...INSTANCE_TRANSFER_CODECS,
  ...AGENT_PUBLISH_CODECS,
  ...LIVE_ACTIVITY_PUSH_CODECS,
  ...PUSH_NOTIFICATIONS_CODECS,
  ...ANDROID_PUSH_NOTIFICATIONS_CODECS,
  ...HOSTED_SITES_CODECS,
  ...WORKSPACE_DIRECTORY_CODECS,
  ...AGENT_HOST_SETTINGS_CODECS,
  ...AGENT_BACKUP_MODELS_CODECS,
  ...AGENT_TASK_LIMIT_CODECS,
  ...MCP_SIGN_IN_CODECS,
  ...PROVIDER_HOST_SIGN_IN_CODECS,
  ...MCP_SIGN_IN_APP_CODECS,
  ...SIGN_IN_RELAY_CODECS,
  ...FOCUS_USE_CODECS,
  ...CONNECTORS_CODECS,
  ...CONVERSATION_FILE_SEARCH_CODECS,
  ...ROUTINE_FLOWS_CODECS,
  ...ROUTINE_RECOVERY_CODECS,
  ...ROUTINE_RESULTS_CODECS,
  ...WEBHOOK_TESTS_CODECS,
  ...STORAGE_DISK_CODECS,
  ...MACHINE_RESOURCES_CODECS,
  ...PROVIDER_ACCOUNTS_CODECS,
  ...PROVIDER_ACCOUNT_RELAY_CODECS,
  ...PROVIDER_ACCOUNT_RELAY_V2_CODECS,
  ...PROVIDER_USAGE_RESET_CODECS,
  ...PROVIDER_SIGN_OUT_CODECS,
  ...ONEPASSWORD_CONNECTOR_CODECS,
  ...BITWARDEN_CONNECTOR_CODECS,
  ...AGENT_ACCESS_CODECS,
  ...AGENT_HIDDEN_CODECS,
  ...AGENT_NOTIFICATION_LEVELS_CODECS,
  ...BROWSER_USER_CONTROL_CODECS,
  ...BROWSER_PAGE_STATE_CODECS,
  ...BROWSER_SIGN_IN_CODECS,
  ...AGENT_TASKS_CODECS,
  ...AGENT_THREADS_CODECS,
  ...AGENT_THREAD_READS_CODECS,
  ...AGENT_THREAD_FILES_CODECS,
  ...SIDE_QUESTION_CODECS,
  ...BROWSER_PROFILES_CODECS,
  ...WORKFLOWS_CODECS,
  ...VAULT_CODECS,
  ...BROWSER_SECRET_VAULT_CODECS,
  ...VAULT_IMPORT_CODECS,
  ...VAULT_V2_CODECS,
]);

export function optionalRouteCodec(path: string): OptionalRouteCodec | undefined {
  return CODECS.get(new URL(path, "http://openbot.invalid").pathname);
}
