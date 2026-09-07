import { INPUT_LIMITS } from "./input-limits";
import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isDynamicRecord } from "./runtime-values";
import { isUuidV4 } from "./validation";

export interface AgentProfileDraft {
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  sectionId: string | null;
}

export interface GenerateAgentProfileInput {
  prompt: string;
  agentId?: string;
  draft?: AgentProfileDraft;
}

export interface SaveAgentProfileInput {
  operationId: string;
  agentId?: string;
  draft: AgentProfileDraft;
  initialMessage?: string;
}

export interface SaveAgentProfileResult {
  agent: AgentSummary;
  layout: SidebarLayoutSnapshot;
}

function isBoundedProfileDraft(value: unknown): value is AgentProfileDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.sectionId === null || isIdentifier(value.sectionId))
  );
}

export function isAgentProfileDraft(value: unknown): value is AgentProfileDraft {
  return isBoundedProfileDraft(value) && value.name.trim().length > 0 && value.description.trim().length > 0;
}

export function parseGenerateAgentProfile(value: unknown): GenerateAgentProfileInput {
  if (
    !isDynamicRecord(value) ||
    !isBoundedString(value.prompt, INPUT_LIMITS.messageText) ||
    !value.prompt.trim() ||
    (value.agentId !== undefined && !isIdentifier(value.agentId)) ||
    (value.draft !== undefined && !isBoundedProfileDraft(value.draft))
  ) {
    throw new Error("Provide a valid profile prompt and draft.");
  }
  return {
    prompt: value.prompt.trim(),
    ...(value.agentId === undefined ? {} : { agentId: value.agentId }),
    ...(value.draft === undefined ? {} : { draft: value.draft }),
  };
}

export function parseSaveAgentProfile(value: unknown): SaveAgentProfileInput {
  if (
    !isDynamicRecord(value) ||
    !isBoundedString(value.operationId, 36) ||
    !isUuidV4(value.operationId) ||
    !isAgentProfileDraft(value.draft) ||
    (value.agentId !== undefined && !isIdentifier(value.agentId)) ||
    (value.initialMessage !== undefined && !isBoundedString(value.initialMessage, INPUT_LIMITS.messageText)) ||
    (value.agentId === undefined && !value.initialMessage?.trim())
  ) {
    throw new Error("Provide a valid reviewed profile and initial message.");
  }
  return {
    operationId: value.operationId,
    draft: decodeAgentProfileDraft(value.draft),
    ...(value.agentId === undefined ? {} : { agentId: value.agentId }),
    ...(value.initialMessage === undefined ? {} : { initialMessage: value.initialMessage }),
  };
}

export function decodeAgentProfileDraft(value: unknown): AgentProfileDraft {
  if (!isAgentProfileDraft(value)) throw new Error("The generated profile is invalid. Try revising your prompt.");
  return {
    name: value.name.trim(),
    title: value.title.trim(),
    description: value.description.trim(),
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue,
    sectionId: value.sectionId,
  };
}

export function decodeSaveAgentProfileResult(value: unknown): SaveAgentProfileResult {
  if (!isDynamicRecord(value) || !isAgentSummary(value.agent) || !isSidebarLayoutSnapshot(value.layout)) {
    throw new Error("Invalid saved agent profile.");
  }
  return { agent: value.agent, layout: value.layout };
}
