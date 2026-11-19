import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const CONVERSATION_MEMORY_CHANGES_ITEM_TYPE = "memory-changes";

export const CONVERSATION_MEMORY_CHANGE_ACTIONS = ["saved", "updated", "forgotten", "notChanged"] as const;
export type ConversationMemoryChangeAction = (typeof CONVERSATION_MEMORY_CHANGE_ACTIONS)[number];

export interface ConversationMemoryChange {
  memoryId: string;
  action: ConversationMemoryChangeAction;
  text: string;
  previousText?: string | undefined;
}

export const CONVERSATION_MEMORY_CHANGE_LIMIT = 50;

export function isConversationMemoryChanges(value: unknown): value is ConversationMemoryChange[] {
  return (
    Array.isArray(value) && value.length <= CONVERSATION_MEMORY_CHANGE_LIMIT && value.every(isConversationMemoryChange)
  );
}

function isConversationMemoryChange(value: unknown): value is ConversationMemoryChange {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.memoryId) &&
    isOneOf(CONVERSATION_MEMORY_CHANGE_ACTIONS, value.action) &&
    isBoundedString(value.text, INPUT_LIMITS.agentMemoryText) &&
    (value.previousText === undefined || isBoundedString(value.previousText, INPUT_LIMITS.agentMemoryText))
  );
}

export function countConversationMemoryChanges(
  changes: readonly ConversationMemoryChange[],
): Record<ConversationMemoryChangeAction, number> {
  const counts = { saved: 0, updated: 0, forgotten: 0, notChanged: 0 };
  for (const change of changes) counts[change.action] += 1;
  return counts;
}
