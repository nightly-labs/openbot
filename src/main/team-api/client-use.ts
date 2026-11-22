import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACTIVE_QUEUES_ROUTES } from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_BACKUP_MODELS_ROUTES } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_BUILTIN_MEMORY_ROUTES } from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import { AGENT_FAST_MODE_ROUTES } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_HOST_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import {
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_MEMORY_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import { AGENT_NOTIFICATION_LEVELS_ROUTES } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_PLAN_CARD_ROUTES } from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { AGENT_TASK_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_BRANCHES_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_QUEUE_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import { AGENT_THREAD_READS_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREAD_REQUESTS_ROUTES } from "@openbot/contracts/team-protocol/agent-thread-requests-v1";
import { AGENT_USAGE_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import { AGENT_WAITS_ROUTES } from "@openbot/contracts/team-protocol/agent-waits-v1";
import { BACKGROUND_PROCESSES_ROUTES } from "@openbot/contracts/team-protocol/background-processes-v1";
import { BROWSER_PAGE_STATE_ROUTES } from "@openbot/contracts/team-protocol/browser-page-state-v1";
import { BROWSER_PROFILES_ROUTES } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_USER_CONTROL_ROUTES } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { BROWSING_MEMORY_ROUTES } from "@openbot/contracts/team-protocol/browsing-memory-v1";
import { CACHE_EXPIRY_COMPACTION_ROUTES } from "@openbot/contracts/team-protocol/cache-expiry-compaction-v1";
import { CHANNEL_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/channel-folders-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CLAUDE_COMPACT_WINDOW_ROUTES } from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import { COMPUTER_ACTIVITY_ROUTES } from "@openbot/contracts/team-protocol/computer-activity-v1";
import { CUSTOM_AGENTS_ROUTES } from "@openbot/contracts/team-protocol/custom-agents-v1";
import { CUSTOM_PROVIDER_EDIT_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import { CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-harness-choice-v1";
import { CUSTOM_PROVIDER_HARNESS_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import { FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_PERSONALITY_ROUTES } from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_TURN_LIMITS_ROUTES } from "@openbot/contracts/team-protocol/host-turn-limits-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOST_VOICE_MODEL_ROUTES } from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { LIBRARY_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/library-folders-v1";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { LIVE_VOICE_ACCOUNT_ROUTES } from "@openbot/contracts/team-protocol/live-voice-account-v1";
import { LOCAL_SERVERS_ROUTES } from "@openbot/contracts/team-protocol/local-servers-v1";
import { MACHINE_RESOURCES_ROUTES } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { MESSAGE_PINS_ROUTES } from "@openbot/contracts/team-protocol/message-pins-v1";
import { MODEL_STEERING_ROUTES } from "@openbot/contracts/team-protocol/model-steering-v1";
import { MODEL_VISIBILITY_ROUTES } from "@openbot/contracts/team-protocol/model-visibility-v1";
import { PENDING_APPROVAL_ROUTES } from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PROMPT_CACHE_TTL_ROUTES } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_ACCOUNT_MODELS_ROUTES } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_ROUTES } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { PROVIDER_DEFAULT_ROUTES } from "@openbot/contracts/team-protocol/provider-default-v1";
import { PROVIDER_ENVIRONMENT_ROUTES } from "@openbot/contracts/team-protocol/provider-environment-v1";
import { PROVIDER_MODEL_SOURCE_ROUTES } from "@openbot/contracts/team-protocol/provider-model-source-v1";
import { PROVIDER_USE_ROUTES } from "@openbot/contracts/team-protocol/provider-use-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PUSH_NOTIFICATION_THREADS_ROUTES } from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import { ANDROID_PUSH_NOTIFICATIONS_ROUTES } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_ROUTES } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { ROUTINE_PAUSE_REASONS_ROUTES } from "@openbot/contracts/team-protocol/routine-pause-reasons-v1";
import { ROUTINE_RECOVERY_ROUTES } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_ROUTES } from "@openbot/contracts/team-protocol/routine-results-v1";
import { ROUTINE_RUN_CHANGES_ROUTES } from "@openbot/contracts/team-protocol/routine-run-changes-v1";
import { ROUTINE_RUN_PLACE_ROUTES } from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { ROUTINES_ONCE_ROUTES } from "@openbot/contracts/team-protocol/routines-once-v1";
import { SERVER_AUDIT_ROUTES } from "@openbot/contracts/team-protocol/server-audit-v1";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SIDEBAR_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/storage-channel-v1";
import { STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import { STORAGE_USER_FILES_ROUTES } from "@openbot/contracts/team-protocol/storage-user-files-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { USAGE_CREDITS_ROUTES } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_ROUTES } from "@openbot/contracts/team-protocol/vault-v3";
import { VAULT_V4_ROUTES } from "@openbot/contracts/team-protocol/vault-v4";
import { WHATSAPP_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { WHATSAPP_STATUS_REACTIONS_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-status-reactions-v1";
import { WHATSAPP_WORKING_MESSAGE_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-working-message-v1";
import { WORKFLOW_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { WORKFLOWS_HIGGSFIELD_ROUTES } from "@openbot/contracts/team-protocol/workflows-higgsfield-v1";
import { WORKFLOWS_MEDIA_CATALOG_ROUTES } from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import { WORKFLOWS_MEDIA_CATALOG_V2_ROUTES } from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import { WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES } from "@openbot/contracts/team-protocol/workflows-media-service-account-v1";
import { WORKFLOWS_STEP_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import { WORKFLOWS_SUNRA_ROUTES } from "@openbot/contracts/team-protocol/workflows-sunra-v1";

const PASSIVE_ROUTES: ReadonlySet<string> = new Set([
  TEAM_API_ROUTES.browser.preview,
  TEAM_API_ROUTES.browser.visible,
  CHANNEL_ROUTES.read,
  CHANNEL_ROUTES.memories,
  CHANNEL_ROUTES.routines,
  CHANNEL_ROUTES.routineRuns,
  ROUTINE_RECOVERY_ROUTES.listRoutines,
  ROUTINE_RECOVERY_ROUTES.listRuns,
  ROUTINE_RESULTS_ROUTES.options,
  ROUTINE_RESULTS_ROUTES.destination,
  ROUTINE_RUN_PLACE_ROUTES.list,
  ROUTINE_PAUSE_REASONS_ROUTES.list,
  ROUTINE_RUN_CHANGES_ROUTES.list,
  AGENT_ACTIVE_QUEUES_ROUTES.list,
  ROUTINES_ONCE_ROUTES.list,
  HOST_UPDATE_ROUTES.status,
  HOST_RELEASE_ROUTES.status,
  HOST_MEMBER_UPDATE_ROUTES.status,
  HOST_TIMEZONE_ROUTES.settings,
  HOST_VOICE_MODEL_ROUTES.settings,
  HOST_TURN_LIMITS_ROUTES.settings,
  HOST_PERSONALITY_ROUTES.settings,
  AGENT_MEMORY_LIMIT_ROUTES.settings,
  MEMORY_REVIEW_ROUTES.settings,
  SKILL_LEARNING_ROUTES.settings,
  BROWSING_MEMORY_ROUTES.settings,
  PROMPT_CACHE_TTL_ROUTES.settings,
  CLAUDE_COMPACT_WINDOW_ROUTES.settings,
  CACHE_EXPIRY_COMPACTION_ROUTES.settings,
  PROVIDER_ENVIRONMENT_ROUTES.settings,
  MODEL_VISIBILITY_ROUTES.settings,
  MODEL_VISIBILITY_ROUTES.listing,
  MODEL_STEERING_ROUTES.list,
  PROVIDER_MODEL_SOURCE_ROUTES.list,
  PROVIDER_ACCOUNT_MODELS_ROUTES.list,
  PROVIDER_ACCOUNT_POOL_ROUTES.list,
  LIVE_VOICE_ACCOUNT_ROUTES.settings,
  PROVIDER_DEFAULT_ROUTES.settings,
  PROVIDER_USE_ROUTES.list,
  LOCAL_SERVERS_ROUTES.list,
  DISCORD_ACCESS_ROUTES.access,
  WHATSAPP_CONNECTOR_ROUTES.overview,
  WHATSAPP_CONNECTOR_ROUTES.linkState,
  WHATSAPP_WORKING_MESSAGE_ROUTES.list,
  WHATSAPP_STATUS_REACTIONS_ROUTES.list,
  LIVE_ACTIVITY_PUSH_ROUTES.register,
  LIVE_ACTIVITY_PUSH_ROUTES.remove,
  AGENT_NOTIFICATION_LEVELS_ROUTES.read,
  SIDEBAR_PINS_ROUTES.read,
  AGENT_COLORS_ROUTES.read,
  CHAT_COLORS_ROUTES.read,
  SERVER_AUDIT_ROUTES.read,
  PUSH_NOTIFICATIONS_ROUTES.register,
  PUSH_NOTIFICATIONS_ROUTES.remove,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES.register,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove,
  PUSH_NOTIFICATION_THREADS_ROUTES.set,
  STORAGE_ROUTES.usage,
  STORAGE_DISK_ROUTES.disk,
  STORAGE_USER_FILES_ROUTES.disk,
  LIBRARY_FOLDERS_ROUTES.read,
  STORAGE_CHANNEL_ROUTES.files,
  MACHINE_RESOURCES_ROUTES.metrics,
  MACHINE_RESOURCES_ROUTES.alerts,
  BACKGROUND_PROCESSES_ROUTES.list,
  AGENT_WAITS_ROUTES.list,
  PENDING_APPROVAL_ROUTES.read,
  MESSAGE_PINS_ROUTES.list,
  AGENT_ADMIN_ROUTES.settings,
  AGENT_HOST_SETTINGS_ROUTES.settings,
  AGENT_BACKUP_MODELS_ROUTES.settings,
  AGENT_TASK_LIMIT_ROUTES.settings,
  AGENT_NEW_CHAT_ROUTES.settings,
  AGENT_PLAN_CARD_ROUTES.settings,
  AGENT_BUILTIN_MEMORY_ROUTES.settings,
  AGENT_DEFAULTS_ROUTES.settings,
  AGENT_FAST_MODE_ROUTES.settings,
  AGENT_FAST_MODE_ROUTES.models,
  AGENT_SPEED_ROUTES.settings,
  AGENT_SPEED_ROUTES.models,
  WORKFLOWS_SUNRA_ROUTES.providers,
  WORKFLOWS_SUNRA_ROUTES.credits,
  WORKFLOWS_HIGGSFIELD_ROUTES.providers,
  WORKFLOWS_HIGGSFIELD_ROUTES.credits,
  WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog,
  WORKFLOWS_MEDIA_CATALOG_ROUTES.price,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits,
  WORKFLOWS_STEP_SETTINGS_ROUTES.read,
  WORKFLOW_FOLDERS_ROUTES.read,
  AGENT_FOLDERS_ROUTES.read,
  AGENT_FOLDERS_ROUTES.browse,
  CHANNEL_FOLDERS_ROUTES.read,
  CHANNEL_FOLDERS_ROUTES.browse,
  BROWSER_PROFILES_ROUTES.list,
  BROWSER_PROFILES_ROUTES.agent,
  BROWSER_PROFILES_ROUTES.tabs,
  VAULT_ROUTES.list,
  VAULT_V2_ROUTES.list,
  VAULT_V3_ROUTES.list,
  VAULT_V3_ROUTES.codes,
  VAULT_V4_ROUTES.list,
  VAULT_V4_ROUTES.codes,
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
  SKILLS_ADMIN_ROUTES.list,
  AGENT_PUBLISH_ROUTES.preview,
  SHARED_TABLES_ROUTES.list,
  HOSTED_SITES_ROUTES.list,
  PROVIDERS_ADMIN_ROUTES.apiKeyState,
  PROVIDERS_ADMIN_ROUTES.customList,
  CUSTOM_PROVIDER_HARNESS_ROUTES.customList,
  CUSTOM_PROVIDER_EDIT_ROUTES.customList,
  CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customList,
  CUSTOM_AGENTS_ROUTES.list,
  PROVIDERS_ADMIN_ROUTES.runtimesStatus,
  PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus,
  USAGE_CREDITS_ROUTES.list,
  FOCUS_USE_ROUTES.ping,
  COMPUTER_ACTIVITY_ROUTES.report,
  AGENT_USAGE_LIMIT_ROUTES.list,
  AGENT_HIDDEN_ROUTES.read,
  SIDEBAR_FOLDERS_ROUTES.read,
  AGENT_TASKS_ROUTES.list,
  AGENT_TASKS_ROUTES.read,
  AGENT_THREAD_READS_ROUTES.list,
  AGENT_THREAD_READS_ROUTES.mark,
  AGENT_THREAD_BRANCHES_ROUTES.list,
  AGENT_THREAD_REQUESTS_ROUTES.list,
  AGENT_THREAD_QUEUE_ROUTES.list,
  BROWSER_USER_CONTROL_ROUTES.state,
  BROWSER_PAGE_STATE_ROUTES.state,
]);

const PASSIVE_PATTERNS: readonly RegExp[] = [
  /^\/v1\/agents\/[^/]+\/conversation\/(?:read|unread)$/u,
  /^\/v1\/direct\/conversations\/[^/]+\/read$/u,
];

export function isClientUse(method: string, pathname: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (PASSIVE_ROUTES.has(pathname)) return false;
  return !PASSIVE_PATTERNS.some((pattern) => pattern.test(pathname));
}
