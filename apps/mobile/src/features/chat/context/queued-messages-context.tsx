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
  chats: ReadonlyMap<string, QueuedChat>;
  publish: (chatId: string, chat: QueuedChat | null) => void;
}

const QueuedMessagesContext = createContext<QueuedMessages | null>(null);

// The queue sheet is a native route, so the controller cannot travel in navigation
// params. Each chat stays mounted behind the sheet and publishes its live controller
// here under its own identity; the sheet reads the one it was opened for, and a second
// chat that the native stack keeps mounted cannot take its place.
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
  const value = useMemo(() => ({ chats, publish }), [chats, publish]);
  return <QueuedMessagesContext value={value}>{children}</QueuedMessagesContext>;
}

function useQueuedMessagesContext(): QueuedMessages {
  const context = useContext(QueuedMessagesContext);
  if (!context) throw new Error("QueuedMessagesProvider is missing.");
  return context;
}

/** Publishes one chat's live queue for its own sheet, and removes only that entry on unmount. */
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

/** The queue of the chat that opened the sheet. The route carries its identity. */
export function useQueuedChat(chatId: string | undefined): {
  queue: ChatQueueController | null;
  pending: QueuedUpload | null;
} {
  const { chats } = useQueuedMessagesContext();
  const chat = chatId ? chats.get(chatId) : undefined;
  return { queue: chat?.queue ?? null, pending: chat?.pending ?? null };
}
