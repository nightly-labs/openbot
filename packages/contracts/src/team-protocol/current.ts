import { BROWSER_SECRET_CAPABILITY } from "../ipc-browser-secret";
import { CHANNEL_DELETE_CAPABILITY } from "../ipc-chat-channels";
import { MCP_SERVERS_CAPABILITY } from "../ipc-mcp-servers";
import { STORAGE_CAPABILITY } from "../ipc-storage";
import { AGENT_ADMIN_CAPABILITY } from "./agent-admin-v1";
import { AGENT_IMPORT_CAPABILITY } from "./agent-import-v1";
import { AGENT_INSTALL_CAPABILITY } from "./agent-install-v1";
import { AGENT_PUBLISH_CAPABILITY } from "./agent-publish-v1";
import { AGENT_UPDATE_CAPABILITY } from "./agent-update-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "./browser-navigation-v1";
import { TEAM_BROWSER_VIEW_CAPABILITY, TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY } from "./browser-view-v1";
import { CONTEXT_RESET_CAPABILITY } from "./context-reset-v1";
import { EVENTS_CAPABILITY } from "./events-v1";
import { TEAM_HISTORY_EXTENT_CAPABILITY } from "./history-extent-v1";
import { HOST_ADMIN_CAPABILITY } from "./host-admin-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "./host-member-update-v1";
import { HOST_RELEASE_CAPABILITY } from "./host-release-v1";
import { HOST_UPDATE_CAPABILITY } from "./host-update-v1";
import { HOSTED_SITES_CAPABILITY } from "./hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "./live-activity-push-v1";
import { TEAM_MESSAGE_CLIENT_ID_CAPABILITY } from "./message-client-id-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "./providers-v1";
import { PROVIDERS_RUNTIMES_V2_CAPABILITY } from "./providers-v2";
import { PROVIDERS_SIGN_IN_V3_CAPABILITY } from "./providers-v3";
import { PROVIDERS_V4_CAPABILITY } from "./providers-v4";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "./queue-edit-v1";
import { ROUTINE_FLOWS_CAPABILITY } from "./routine-flows-v1";
import { SHARED_TABLES_CAPABILITY } from "./shared-tables-v1";
import { SKILLS_ADMIN_CAPABILITY } from "./skills-admin-v1";
import { SKILLS_EVENTS_CAPABILITY } from "./skills-events-v1";
import { TEAM_PROTOCOL_V6_CAPABILITIES } from "./v6";
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
/**
 * Frozen optional member-leave-v1 contract: a bodyless `POST /v1/team/leave` answered with 204. The
 * caller, a member or an admin, removes their own membership with the same effects as an admin's
 * `DELETE /v1/team/members/:id`: the member row and every session of it go, on every device. The
 * owner is refused. A host without the capability answers 404, and the client only logs out.
 * Widening any of it needs a second capability string.
 */
export const TEAM_MEMBER_LEAVE_CAPABILITY = "member-leave-v1";
export {
  AGENT_ADMIN_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CONTEXT_RESET_CAPABILITY,
  EVENTS_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  STORAGE_CAPABILITY,
  TEAM_BROWSER_NAVIGATION_CAPABILITY,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  WORKSPACE_DIRECTORY_CAPABILITY,
};

export const TEAM_CURRENT_CAPABILITIES = [
  BROWSER_SECRET_CAPABILITY,
  ...TEAM_PROTOCOL_V6_CAPABILITIES,
  "remote-desktop-setup",
  TEAM_QUEUE_EDIT_CAPABILITY,
  TEAM_BROWSER_NAVIGATION_CAPABILITY,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
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
  "channel-chats-v1",
  CHANNEL_DELETE_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  STORAGE_CAPABILITY,
  AGENT_ADMIN_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  TEAM_MEMBER_LEAVE_CAPABILITY,
  CONTEXT_RESET_CAPABILITY,
  EVENTS_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  WORKSPACE_DIRECTORY_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
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
