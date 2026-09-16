import { createContext, type PropsWithChildren, useContext, useMemo, useState } from "react";
import type { ChatQueueController } from "../components/use-chat-queue";
import type { PendingChatMessage } from "../model/chat-messages";

export interface QueuedUpload {
  message: PendingChatMessage["message"];
  progress: number;
  total: number;
  cancel: () => void;
}

interface QueuedMessages {
  queue: ChatQueueController | null;
  setQueue: (queue: ChatQueueController | null) => void;
  pending: QueuedUpload | null;
  setPending: (pending: QueuedUpload | null) => void;
}

const QueuedMessagesContext = createContext<QueuedMessages | null>(null);

// The queue sheet is a native route, so the controller cannot travel in navigation
// params. The chat stays mounted behind the sheet and publishes its live
// controller here; the sheet reads it without owning a second edit session.
export function QueuedMessagesProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<ChatQueueController | null>(null);
  const [pending, setPending] = useState<QueuedUpload | null>(null);
  const value = useMemo(() => ({ queue, setQueue, pending, setPending }), [queue, pending]);
  return <QueuedMessagesContext value={value}>{children}</QueuedMessagesContext>;
}

export function useQueuedMessages() {
  const context = useContext(QueuedMessagesContext);
  if (!context) throw new Error("QueuedMessagesProvider is missing.");
  return context;
}
