import { BROWSER_SECRET_CAPABILITY } from "../ipc-browser-secret";
import { CHANNEL_DELETE_CAPABILITY } from "../ipc-chat-channels";
import { MCP_SERVERS_CAPABILITY } from "../ipc-mcp-servers";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "./browser-navigation-v1";
import { TEAM_BROWSER_VIEW_CAPABILITY, TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY } from "./browser-view-v1";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "./queue-edit-v1";
import { TEAM_PROTOCOL_V4_CAPABILITIES } from "./v4";

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
export {
  CHANNEL_DELETE_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  TEAM_BROWSER_NAVIGATION_CAPABILITY,
  TEAM_BROWSER_VIEW_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
};

export const TEAM_CURRENT_CAPABILITIES = [
  BROWSER_SECRET_CAPABILITY,
  ...TEAM_PROTOCOL_V4_CAPABILITIES,
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
