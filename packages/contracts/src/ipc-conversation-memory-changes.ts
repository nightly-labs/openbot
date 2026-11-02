import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The memory changes that one turn committed: what the agent saved, updated and forgot, and what it
 * could not change because another thread of the agent changed that memory first. The backend
 * writes them on one system message of the turn after the commit, so a turn that did not complete
 * has none. The text of the message counts the changes, for a client that does not know the field.
 * The Team API does not send the field: a remote client shows the text.
 */
export const CONVERSATION_MEMORY_CHANGES_ITEM_TYPE = "memory-changes";

export const CONVERSATION_MEMORY_CHANGE_ACTIONS = ["saved", "updated", "forgotten", "notChanged"] as const;
export type ConversationMemoryChangeAction = (typeof CONVERSATION_MEMORY_CHANGE_ACTIONS)[number];

export interface ConversationMemoryChange {
  memoryId: string;
  action: ConversationMemoryChangeAction;
  /** The saved text, the forgotten one, or the one that the commit did not save or forget. */
  text: string;
  /** The text before an update. */
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

/** How many changes of each action, in the order of `CONVERSATION_MEMORY_CHANGE_ACTIONS`. */
export function countConversationMemoryChanges(
  changes: readonly ConversationMemoryChange[],
): Record<ConversationMemoryChangeAction, number> {
  const counts = { saved: 0, updated: 0, forgotten: 0, notChanged: 0 };
  for (const change of changes) counts[change.action] += 1;
  return counts;
}
