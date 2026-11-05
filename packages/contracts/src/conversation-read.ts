// Which agent chat messages make the chat unread, on every surface that counts them or moves the
// read mark.
//
// The host counts unread messages after the member's read mark. The desktop and mobile apps move
// that mark to the newest message that the host counts. When a client used its own rule, the host
// kept counting a message after the mark and the chat stayed unread (#5089), so there is one.

import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "./chat-visual";
import { AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE } from "./ipc-agent-instructions";
import {
  AGENT_EXCHANGE_ITEM_TYPE,
  CONTEXT_RESET_ITEM_TYPE,
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  MODEL_SWITCH_ITEM_TYPE_PREFIX,
  PLAN_CONTINUATION_ITEM_TYPE,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
} from "./ipc-conversation-events";
import { CONVERSATION_MEMORY_CHANGES_ITEM_TYPE } from "./ipc-conversation-memory-changes";
import { ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "./ipc-conversation-messages";
import { CONVERSATION_PLAN_ITEM_TYPE } from "./ipc-conversation-plan";
import { CONVERSATION_SUBAGENTS_ITEM_TYPE } from "./ipc-conversation-subagents";
import { MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX } from "./marketplace-suggestion-events";
import { SKILL_EVENT_ITEM_TYPE_PREFIX } from "./skill-conversation-events";

/** Item types that never make a chat unread: the agent's own work, and messages between agents. */
export const READ_EXCLUDED_ITEM_TYPES = [
  "commentary",
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  PLAN_CONTINUATION_ITEM_TYPE,
  AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  "agent_attachment",
  AGENT_EXCHANGE_ITEM_TYPE,
  CONTEXT_RESET_ITEM_TYPE,
] as const;

/** Item type prefixes that never make a chat unread: visual pages and the markers an agent writes about itself. */
export const READ_EXCLUDED_ITEM_TYPE_PREFIXES = [
  CHAT_VISUAL_ITEM_TYPE_PREFIX,
  SKILL_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
  MODEL_SWITCH_ITEM_TYPE_PREFIX,
] as const;

const excludedItemTypes: ReadonlySet<string> = new Set(READ_EXCLUDED_ITEM_TYPES);

/**
 * Whether a message of this item type, not sent by the user, makes the chat unread. Each surface
 * checks the author itself, because the IPC messages and the renderer rows spell the user differently.
 */
export function itemTypeCountsAsUnread(itemType: string | undefined): boolean {
  if (itemType === undefined) return true;
  if (excludedItemTypes.has(itemType)) return false;
  for (const prefix of READ_EXCLUDED_ITEM_TYPE_PREFIXES) {
    if (itemType.startsWith(prefix)) return false;
  }
  return true;
}
