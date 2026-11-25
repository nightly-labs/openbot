import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChatQueueController } from "../components/use-chat-queue";
import type { PendingChatMessage } from "../model/chat-messages";

export interface QueuedUpload {
  message: PendingChatMessage["message"];
  progress: number;
  total: number;
  cancel: () => void;
}

interface QueuedChat {
  queue: ChatQueueController;
  pending: QueuedUpload | null;
}

interface QueuedMessages {
  publish: (chatId: string, chat: QueuedChat | null) => void;
  hiddenReplyIds: ReadonlySet<string>;
  hideReplies: (ids: readonly string[]) => void;
}

const QueuedMessagesContext = createContext<QueuedMessages | null>(null);
const QueuedChatsContext = createContext<ReadonlyMap<string, QueuedChat> | null>(null);

export function QueuedMessagesProvider({ children }: PropsWithChildren) {
  const [chats, setChats] = useState<ReadonlyMap<string, QueuedChat>>(() => new Map());
  const publish = useCallback((chatId: string, chat: QueuedChat | null) => {
    setChats((current) => {
      const existing = current.get(chatId);
      if (!chat) {
        if (!existing) return current;
        const next = new Map(current);
        next.delete(chatId);
        return next;
      }
      if (existing?.queue === chat.queue && existing.pending === chat.pending) return current;
      return new Map(current).set(chatId, chat);
    });
  }, []);
  const [hiddenReplyIds, setHiddenReplyIds] = useState<ReadonlySet<string>>(() => new Set());
  const hideReplies = useCallback((ids: readonly string[]) => {
    setHiddenReplyIds((current) => new Set([...current, ...ids]));
  }, []);
  const value = useMemo(() => ({ publish, hiddenReplyIds, hideReplies }), [publish, hiddenReplyIds, hideReplies]);
  return (
    <QueuedMessagesContext value={value}>
      <QueuedChatsContext value={chats}>{children}</QueuedChatsContext>
    </QueuedMessagesContext>
  );
}

function useQueuedMessagesContext(): QueuedMessages {
  const context = useContext(QueuedMessagesContext);
  if (!context) throw new Error("QueuedMessagesProvider is missing.");
  return context;
}

export function usePublishedQueuedChat(
  chatId: string,
  queue: ChatQueueController | null,
  pending: QueuedUpload | null,
): void {
  const { publish } = useQueuedMessagesContext();
  useEffect(() => {
    publish(chatId, queue ? { queue, pending } : null);
  }, [chatId, queue, pending, publish]);
  useEffect(() => () => publish(chatId, null), [chatId, publish]);
}

export function useHiddenReplies(): Pick<QueuedMessages, "hiddenReplyIds" | "hideReplies"> {
  const { hiddenReplyIds, hideReplies } = useQueuedMessagesContext();
  return { hiddenReplyIds, hideReplies };
}

export function useQueuedChat(chatId: string | undefined): {
  queue: ChatQueueController | null;
  pending: QueuedUpload | null;
} {
  const chats = useContext(QueuedChatsContext);
  if (!chats) throw new Error("QueuedMessagesProvider is missing.");
  const chat = chatId ? chats.get(chatId) : undefined;
  return { queue: chat?.queue ?? null, pending: chat?.pending ?? null };
}
