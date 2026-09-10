import { createContext, type PropsWithChildren, useContext, useState } from "react";
import type { ChatMessage } from "../model/chat-messages";

export type ChatBubbleMessage = Extract<ChatMessage, { kind: "message" }>;

interface MessageActions {
  message: ChatBubbleMessage;
  onReply: (() => void) | null;
}

const MessageActionsContext = createContext<{
  selected: MessageActions | null;
  select: (value: MessageActions | null) => void;
} | null>(null);

// Keep message text and callbacks out of navigation URLs and route state.
export function MessageActionsProvider({ children }: PropsWithChildren) {
  const [selected, select] = useState<MessageActions | null>(null);
  return <MessageActionsContext value={{ selected, select }}>{children}</MessageActionsContext>;
}

export function useMessageActions() {
  const context = useContext(MessageActionsContext);
  if (!context) throw new Error("MessageActionsProvider is missing.");
  return context;
}
