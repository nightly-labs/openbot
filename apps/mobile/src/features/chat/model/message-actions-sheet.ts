import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { useSyncExternalStore } from "react";
import type { ChatNavigation } from "../context/chat-navigation-context";

export interface MessageActionsRequest {
  messageId: string;
  copyText: string;
  createdAt?: string;
  ownReaction: string | null;
  readAloudId?: string;
  onReact?: (emoji: string | null) => void;
  onReply?: () => void;
  onBranch?: () => void;
  onSelectText?: () => void;
  onMarkUnread?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  sendToChannel?: MessageChannelTargets;
  onDelete?: () => void;
  files?: MessageFiles;
}

export interface MessageFiles {
  serverId: string;
  attachments: readonly AttachmentSummary[];
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

export function openMessageActions(request: MessageActionsRequest, navigation: ChatNavigation) {
  current = request;
  for (const listener of listeners) listener();
  navigation.push("/message-actions");
}

export function messageActionsOpen(): boolean {
  return current !== null;
}

export function releaseMessageActions(request: MessageActionsRequest | null) {
  if (current !== request) return;
  current = null;
  for (const listener of listeners) listener();
}

export function useMessageActionsRequest(): MessageActionsRequest | null {
  return useSyncExternalStore(subscribe, () => current);
}
