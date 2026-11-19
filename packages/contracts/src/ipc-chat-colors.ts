import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

const CHAT_COLOR_AGENTS_LIMIT = 1000;

export interface AgentChatColorEntry {
  agentId: string;
  color: AvatarColor;
}

export interface MemberChatColorEntry {
  memberId: string;
  color: AvatarColor;
}

export interface ChatColors {
  agents: AgentChatColorEntry[];
  members: MemberChatColorEntry[];
}

export interface SetAgentChatColorInput {
  agentId: string;
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
