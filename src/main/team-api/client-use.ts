import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";

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
  HOST_UPDATE_ROUTES.status,
  HOST_RELEASE_ROUTES.status,
  HOST_MEMBER_UPDATE_ROUTES.status,
  LIVE_ACTIVITY_PUSH_ROUTES.register,
  LIVE_ACTIVITY_PUSH_ROUTES.remove,
  STORAGE_ROUTES.usage,
  AGENT_ADMIN_ROUTES.settings,
  SKILLS_ADMIN_ROUTES.list,
  AGENT_PUBLISH_ROUTES.preview,
  SHARED_TABLES_ROUTES.list,
  HOSTED_SITES_ROUTES.list,
  PROVIDERS_ADMIN_ROUTES.apiKeyState,
  PROVIDERS_ADMIN_ROUTES.customList,
  PROVIDERS_ADMIN_ROUTES.runtimesStatus,
  PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus,
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
