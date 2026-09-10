import { isAttachmentSummary } from "../ipc-attachments";
import { isDynamicRecord, isString } from "../runtime-values";
import { TEAM_PROTOCOL_V4_CAPABILITIES } from "./v4";

export const TEAM_SEMANTIC_TAGS_CAPABILITY = "installed-skills";
export const TEAM_AGENT_ACTIVITY_CAPABILITY = "agent-activity";
export const TEAM_CONVERSATION_UNREAD_CAPABILITY = "conversation-unread";
export const TEAM_MODEL_SCOPED_USAGE_CAPABILITY = "model-scoped-usage";
export const TEAM_MEDIA_ATTACHMENTS_CAPABILITY = "media-attachments";
export const TEAM_EML_ATTACHMENTS_CAPABILITY = "eml-attachments";

export const TEAM_CURRENT_CAPABILITIES = [
  ...TEAM_PROTOCOL_V4_CAPABILITIES,
  "queue-take",
  "queue-edit",
  "agent-profile-generation",
  "agent-analytics",
  "host-analytics",
  TEAM_SEMANTIC_TAGS_CAPABILITY,
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
  TEAM_MODEL_SCOPED_USAGE_CAPABILITY,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
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

export function isQueueTakeRoute(method: string, path: string): boolean {
  return (
    method === "POST" && /^\/v1\/agents\/[^/]+\/queue\/take$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}

export function decodeQueueDraft(value: unknown) {
  if (
    !isDynamicRecord(value) ||
    !isString(value.text) ||
    !Array.isArray(value.attachments) ||
    !value.attachments.every(isAttachmentSummary)
  ) {
    throw new Error("Invalid queued message draft.");
  }
  return { text: value.text, attachments: value.attachments };
}

export function isQueueEditRoute(method: string, path: string): boolean {
  return (
    method === "POST" && /^\/v1\/agents\/[^/]+\/queue\/edit$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}
