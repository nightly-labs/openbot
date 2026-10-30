import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_BACKUP_MODELS_ROUTES } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_HOST_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import {
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_MEMORY_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_TASK_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { BROWSER_PROFILES_ROUTES } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import { FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { MACHINE_RESOURCES_ROUTES } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { PROMPT_CACHE_TTL_ROUTES } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_DEFAULT_ROUTES } from "@openbot/contracts/team-protocol/provider-default-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { ANDROID_PUSH_NOTIFICATIONS_ROUTES } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_ROUTES } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { ROUTINE_RECOVERY_ROUTES } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_ROUTES } from "@openbot/contracts/team-protocol/routine-results-v1";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";

/**
 * POST routes that a client sends with no user action: polls, previews, mark-read, and reads that use
 * POST for their body. They do not keep a hosted server running.
 */
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
  HOST_UPDATE_ROUTES.status,
  HOST_RELEASE_ROUTES.status,
  HOST_MEMBER_UPDATE_ROUTES.status,
  HOST_TIMEZONE_ROUTES.settings,
  AGENT_MEMORY_LIMIT_ROUTES.settings,
  MEMORY_REVIEW_ROUTES.settings,
  PROMPT_CACHE_TTL_ROUTES.settings,
  PROVIDER_DEFAULT_ROUTES.settings,
  DISCORD_ACCESS_ROUTES.access,
  LIVE_ACTIVITY_PUSH_ROUTES.register,
  LIVE_ACTIVITY_PUSH_ROUTES.remove,
  PUSH_NOTIFICATIONS_ROUTES.register,
  PUSH_NOTIFICATIONS_ROUTES.remove,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES.register,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove,
  STORAGE_ROUTES.usage,
  STORAGE_DISK_ROUTES.disk,
  MACHINE_RESOURCES_ROUTES.metrics,
  MACHINE_RESOURCES_ROUTES.alerts,
  AGENT_ADMIN_ROUTES.settings,
  AGENT_HOST_SETTINGS_ROUTES.settings,
  AGENT_BACKUP_MODELS_ROUTES.settings,
  AGENT_TASK_LIMIT_ROUTES.settings,
  BROWSER_PROFILES_ROUTES.list,
  BROWSER_PROFILES_ROUTES.agent,
  BROWSER_PROFILES_ROUTES.tabs,
  VAULT_ROUTES.list,
  VAULT_V2_ROUTES.list,
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
  SKILLS_ADMIN_ROUTES.list,
  AGENT_PUBLISH_ROUTES.preview,
  SHARED_TABLES_ROUTES.list,
  HOSTED_SITES_ROUTES.list,
  PROVIDERS_ADMIN_ROUTES.apiKeyState,
  PROVIDERS_ADMIN_ROUTES.customList,
  PROVIDERS_ADMIN_ROUTES.runtimesStatus,
  PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus,
  // A focused app counts as use only for a limited time: `TeamApiServer` records it on its own.
  FOCUS_USE_ROUTES.ping,
]);

/** A client opens a conversation and the app marks it read, or a member marks it unread. */
const PASSIVE_PATTERNS: readonly RegExp[] = [
  /^\/v1\/agents\/[^/]+\/conversation\/(?:read|unread)$/u,
  /^\/v1\/direct\/conversations\/[^/]+\/read$/u,
];

/**
 * Whether a signed-in request is a user action: a send, a change, or an answer. Only these keep a hosted
 * server running. A route that is not in the list counts, so a new route keeps the server running
 * rather than stopping it under the user.
 */
export function isClientUse(method: string, pathname: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (PASSIVE_ROUTES.has(pathname)) return false;
  return !PASSIVE_PATTERNS.some((pattern) => pattern.test(pathname));
}
