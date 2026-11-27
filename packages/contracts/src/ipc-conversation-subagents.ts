import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const CONVERSATION_SUBAGENTS_ITEM_TYPE = "subagents";

export const CONVERSATION_SUBAGENT_STATUSES = ["running", "completed", "failed", "stopped"] as const;
export type ConversationSubagentStatus = (typeof CONVERSATION_SUBAGENT_STATUSES)[number];

export const CONVERSATION_SUBAGENT_STEP_KINDS = [
  "thinking",
  "text",
  "search",
  "read",
  "edit",
  "command",
  "web",
  "tool",
] as const;
export type ConversationSubagentStepKind = (typeof CONVERSATION_SUBAGENT_STEP_KINDS)[number];

export interface ConversationSubagentStep {
  id: string;
  kind: ConversationSubagentStepKind;
  text: string;
}

export interface ConversationSubagent {
  id: string;
  title: string;
  agentType: string | null;
  prompt: string | null;
  status: ConversationSubagentStatus;
  startedAt: string;
  endedAt: string | null;
  steps: ConversationSubagentStep[];
  error: string | null;
  background?: true;
}

export const CONVERSATION_SUBAGENT_LIMIT = 24;
export const CONVERSATION_SUBAGENT_STEP_LIMIT = 40;
export const CONVERSATION_SUBAGENT_TITLE_LIMIT = 300;
const AGENT_TYPE_LIMIT = 80;
const PROMPT_LIMIT = 2_000;
const STEP_TEXT_LIMIT = 500;
const ERROR_LIMIT = 500;
const TIME_LIMIT = 160;

export function isConversationSubagents(value: unknown): value is ConversationSubagent[] {
  return Array.isArray(value) && value.length <= CONVERSATION_SUBAGENT_LIMIT && value.every(isConversationSubagent);
}

function isConversationSubagent(value: unknown): value is ConversationSubagent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.title, CONVERSATION_SUBAGENT_TITLE_LIMIT) &&
    isNullableBoundedString(value.agentType, AGENT_TYPE_LIMIT) &&
    isNullableBoundedString(value.prompt, PROMPT_LIMIT) &&
    isOneOf(CONVERSATION_SUBAGENT_STATUSES, value.status) &&
    isBoundedString(value.startedAt, TIME_LIMIT) &&
    isNullableBoundedString(value.endedAt, TIME_LIMIT) &&
    Array.isArray(value.steps) &&
    value.steps.length <= CONVERSATION_SUBAGENT_STEP_LIMIT &&
    value.steps.every(isConversationSubagentStep) &&
    isNullableBoundedString(value.error, ERROR_LIMIT) &&
    (value.background === undefined || value.background === true)
  );
}

function isConversationSubagentStep(value: unknown): value is ConversationSubagentStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(CONVERSATION_SUBAGENT_STEP_KINDS, value.kind) &&
    isBoundedString(value.text, STEP_TEXT_LIMIT)
  );
}

export function clampConversationSubagents(subagents: readonly ConversationSubagent[]): ConversationSubagent[] | null {
  const result: ConversationSubagent[] = [];
  const ids = new Set<string>();
  for (const subagent of subagents) {
    if (result.length >= CONVERSATION_SUBAGENT_LIMIT) break;
    if (!isIdentifier(subagent.id) || ids.has(subagent.id)) continue;
    ids.add(subagent.id);
    const steps = subagent.steps.flatMap((step): ConversationSubagentStep[] => {
      const text = clampText(step.text, STEP_TEXT_LIMIT);
      return text && isIdentifier(step.id) ? [{ id: step.id, kind: step.kind, text }] : [];
    });
    result.push({
      id: subagent.id,
      title: clampText(subagent.title, CONVERSATION_SUBAGENT_TITLE_LIMIT),
      agentType: nullableText(subagent.agentType, AGENT_TYPE_LIMIT),
      prompt: nullableText(subagent.prompt, PROMPT_LIMIT, false),
      status: subagent.status,
      startedAt: subagent.startedAt.slice(0, TIME_LIMIT),
      endedAt: subagent.endedAt === null ? null : subagent.endedAt.slice(0, TIME_LIMIT),
      steps: steps.slice(-CONVERSATION_SUBAGENT_STEP_LIMIT),
      error: nullableText(subagent.error, ERROR_LIMIT),
      ...(subagent.background ? { background: true as const } : {}),
    });
  }
  return result.length ? result : null;
}

function clampText(value: string, limit: number, oneLine = true): string {
  return (oneLine ? value.replace(/\s+/gu, " ") : value).trim().slice(0, limit);
}

function nullableText(value: string | null, limit: number, oneLine = true): string | null {
  return value === null ? null : clampText(value, limit, oneLine) || null;
}

export function conversationSubagentsText(subagents: readonly ConversationSubagent[]): string {
  return subagents.map((subagent) => `- ${subagent.title || subagent.agentType || subagent.id}`).join("\n");
}
