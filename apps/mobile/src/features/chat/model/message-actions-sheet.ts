import { router } from "expo-router";
import { useSyncExternalStore } from "react";

/**
 * What the message sheet shows and does. The chat stays open under the sheet and owns the message
 * row, so the sheet acts through the row: a reaction shows at once in the row, and Reply focuses the
 * composer when the chat is on screen again.
 */
export interface MessageActionsRequest {
  messageId: string;
  /** The text that Copy puts on the clipboard. Empty for a message of files only. */
  copyText: string;
  createdAt?: string;
  /** The reader's reaction on the message. */
  ownReaction: string | null;
  /**
   * The message that Read aloud reads. Unset where the message is not a reply. A build without the
   * speech module, such as Expo Go, shows the row disabled.
   */
  readAloudId?: string;
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => void;
  onReply?: () => void;
  /** Copies the conversation through this answer into a new thread. Unset where the message has no branch. */
  onBranch?: () => void;
  onSelectText?: () => void;
  /** Marks the message and the messages after it unread, as on desktop. Unset where it cannot. */
  onMarkUnread?: () => void;
  /**
   * The open channels that the message text can go to, as on desktop. The channel opens with the text
   * in its composer. Unset outside an agent's own chat, and for a message without text.
   */
  sendToChannel?: MessageChannelTargets;
  /** Asks, then deletes the message for everyone. Unset where the reader cannot delete it. */
  onDelete?: () => void;
}

export interface MessageChannelTargets {
  channels: readonly { id: string; name: string }[];
  onSend: (channelId: string) => void;
}

let current: MessageActionsRequest | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the sheet of one message. */
export function openMessageActions(request: MessageActionsRequest) {
  current = request;
  for (const listener of listeners) listener();
  router.push("/message-actions");
}

/** Whether a message sheet is open. It covers the chat, so the chat loses focus while it is. */
export function messageActionsOpen(): boolean {
  return current !== null;
}

/** Forgets the request when its sheet closes, unless a newer sheet replaced it. */
export function releaseMessageActions(request: MessageActionsRequest | null) {
  if (current !== request) return;
  current = null;
  for (const listener of listeners) listener();
}

export function useMessageActionsRequest(): MessageActionsRequest | null {
  return useSyncExternalStore(subscribe, () => current);
}
