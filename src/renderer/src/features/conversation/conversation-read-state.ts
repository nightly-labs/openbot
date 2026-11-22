import { itemTypeCountsAsUnread } from "@openbot/contracts/conversation-read";
import type {
  ConversationMessageAuthor,
  ConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
} from "@openbot/contracts/ipc";
import {
  CONTEXT_RESET_ITEM_TYPE,
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
  MODEL_SWITCH_ITEM_TYPE_PREFIX,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
  SETTING_LINK_ITEM_TYPE_PREFIX,
  SKILL_EVENT_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";

export type AgentAutoReadEntry =
  | { messageId: string; status: "pending"; optimisticState: ConversationReadState | null }
  | { messageId: string; status: "succeeded"; state: ConversationReadState };

export function isRoutineEventItem(message: { itemType?: string | undefined }): boolean {
  return (
    message.itemType?.startsWith(ROUTINE_EVENT_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(SKILL_EVENT_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(SETTING_LINK_ITEM_TYPE_PREFIX) === true ||
    message.itemType?.startsWith(MODEL_SWITCH_ITEM_TYPE_PREFIX) === true ||
    message.itemType === CONTEXT_RESET_ITEM_TYPE
  );
}

function isIncoming(message: { itemType?: string | undefined }, fromUser: boolean): boolean {
  return !fromUser && itemTypeCountsAsUnread(message.itemType);
}

function isIncomingConversationMessage(message: {
  author: ConversationMessageAuthor;
  itemType?: string | undefined;
}): boolean {
  return isIncoming(message, message.author === "user");
}

export function isIncomingAgentMessage(message: AgentMessage): boolean {
  return (
    isIncoming(message, message.author === "you") &&
    !message.id.startsWith("thinking:") &&
    !message.id.startsWith("ui-")
  );
}

export function latestIncomingConversationMessage<
  Message extends { author: ConversationMessageAuthor; itemType?: string | undefined },
>(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isIncomingConversationMessage(message)) return message;
  }
  return undefined;
}

export function latestVisibleAgentMessageId(messages: readonly AgentMessage[] | undefined): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isIncomingAgentMessage(message)) return message.id;
  }
  return null;
}

export function readStateForMessages(
  state: ConversationReadState,
  messages: readonly { author: ConversationMessageAuthor; id: string; itemType?: string | undefined }[],
): ConversationReadState {
  const throughIndex = state.throughMessageId
    ? messages.findIndex((message) => message.id === state.throughMessageId)
    : -1;
  const unread = messages.slice(throughIndex + 1).filter(isIncomingConversationMessage);
  return {
    ...state,
    unreadCount: unread.length,
    firstUnreadMessageId: unread[0]?.id ?? null,
  };
}

export function preserveKnownAgentUnread(
  state: ConversationReadState,
  boundary: string | null,
  messages: AgentMessage[],
): ConversationReadState {
  const throughMessageId = state.throughMessageId ?? boundary;
  const throughIndex = throughMessageId ? messages.findIndex((message) => message.id === throughMessageId) : -1;
  if (throughMessageId && throughIndex < 0) return state;
  const unread = messages.slice(throughIndex + 1).filter(isIncomingAgentMessage);
  if (unread.length <= state.unreadCount) return state;
  return {
    ...state,
    unreadCount: unread.length,
    firstUnreadMessageId: unread[0]?.id ?? null,
  };
}

export function preserveKnownDirectUnread(
  state: NonNullable<DirectConversationSnapshot["readState"]>,
  boundary: number,
  messages: DirectMessage[],
  currentMemberId: string | undefined,
): NonNullable<DirectConversationSnapshot["readState"]> {
  const throughSequence = Math.max(state.throughSequence, boundary);
  const unread = messages.filter(
    (message) => message.senderMemberId !== currentMemberId && message.sequence > throughSequence,
  );
  if (unread.length <= state.unreadCount) return state;
  return {
    ...state,
    unreadCount: unread.length,
    firstUnreadMessageId: unread[0]?.id ?? null,
  };
}

export function retainedAutoReadState(entry: AgentAutoReadEntry | undefined): ConversationReadState | null {
  if (!entry) return null;
  return entry.status === "succeeded" ? entry.state : entry.optimisticState;
}

export type AgentAutoReadDecision =
  | { readonly kind: "retained"; readonly state: ConversationReadState | null }
  | { readonly kind: "deferred" }
  | {
      readonly kind: "mark";
      readonly optimisticState: ConversationReadState | null;
      readonly rollbackState: ConversationReadState | null;
    };

export function decideAgentAutoRead(input: {
  readonly messageId: string;
  readonly current: ConversationReadState | undefined;
  readonly tracked: AgentAutoReadEntry | undefined;
  readonly optimisticallyClearUnread: boolean;
  readonly explicitlyOpened: boolean;
  readonly retryingRead: boolean;
}): AgentAutoReadDecision {
  if (input.tracked?.messageId === input.messageId) {
    return { kind: "retained", state: retainedAutoReadState(input.tracked) };
  }
  const current = input.current;
  const hasUnread = Boolean(current && current.unreadCount > 0);
  if (!input.optimisticallyClearUnread && !input.explicitlyOpened && !input.retryingRead && hasUnread) {
    return { kind: "deferred" };
  }
  if (!current || (hasUnread && !input.optimisticallyClearUnread)) {
    return { kind: "mark", optimisticState: null, rollbackState: null };
  }
  return {
    kind: "mark",
    optimisticState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: input.messageId },
    rollbackState: hasUnread ? current : { ...current, unreadCount: 1, firstUnreadMessageId: input.messageId },
  };
}
