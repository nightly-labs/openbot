import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

/** The `chat-colors-v1` agent list bound. A server can keep more agents than one IPC agent list. */
const CHAT_COLOR_AGENTS_LIMIT = 1000;

/** The chat colour of one agent on a server. An agent that is not in the list has no chat colour. */
export interface AgentChatColorEntry {
  agentId: string;
  color: AvatarColor;
}

/** The chat colour of one member of a server. It comes from the member's OpenBot account. */
export interface MemberChatColorEntry {
  memberId: string;
  color: AvatarColor;
}

/** The agents and members of a server that have a chat colour, in the `chat-colors-v1` wire shape. */
export interface ChatColors {
  agents: AgentChatColorEntry[];
  members: MemberChatColorEntry[];
}

export interface SetAgentChatColorInput {
  agentId: string;
  /** `null` removes the chat colour. */
  color: AvatarColor | null;
}

function hasOnlyKeys(value: DynamicRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isAgentChatColorEntry(value: unknown): value is AgentChatColorEntry {
  return (
    isDynamicRecord(value) &&
    hasOnlyKeys(value, ["agentId", "color"]) &&
    isIdentifier(value.agentId) &&
    isAvatarColor(value.color)
  );
}

export function isMemberChatColorEntry(value: unknown): value is MemberChatColorEntry {
  return (
    isDynamicRecord(value) &&
    hasOnlyKeys(value, ["memberId", "color"]) &&
    isIdentifier(value.memberId) &&
    isAvatarColor(value.color)
  );
}

export function isChatColors(value: unknown): value is ChatColors {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agents) &&
    value.agents.length <= CHAT_COLOR_AGENTS_LIMIT &&
    value.agents.every(isAgentChatColorEntry) &&
    new Set(value.agents.map((agent) => agent.agentId)).size === value.agents.length &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.teamMembers &&
    value.members.every(isMemberChatColorEntry) &&
    new Set(value.members.map((member) => member.memberId)).size === value.members.length
  );
}

export function parseSetAgentChatColorInput(value: unknown): SetAgentChatColorInput {
  if (
    !isDynamicRecord(value) ||
    !hasOnlyKeys(value, ["agentId", "color"]) ||
    !isIdentifier(value.agentId) ||
    (value.color !== null && !isAvatarColor(value.color))
  )
    throw new Error("Invalid chat color request.");
  return { agentId: value.agentId, color: value.color };
}
