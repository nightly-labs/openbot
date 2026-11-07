import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { createContext, type PropsWithChildren, use, useMemo, useRef } from "react";
import { useCSSVariable } from "uniwind";

interface ChatListPane {
  /** The chat that the detail column shows on top, if any. */
  topChatId: string | null;
  /** The chat to mark in the list: the top chat, or the chat under the screen that it opened. */
  selectedChatId: string | null;
}

const ChatListPaneContext = createContext<ChatListPane | null>(null);

/** The chat list pane that a row is in, or null for a row on a screen of the stack. */
export function useChatListPane(): ChatListPane | null {
  return use(ChatListPaneContext);
}

/** Marks its content as the chat list pane of a wide window, which opens chats in the detail column. */
export function ChatListPaneProvider({ children }: PropsWithChildren) {
  const segments = useSegments();
  const { agentId, channelId } = useGlobalSearchParams<{ agentId?: string; channelId?: string }>();
  const section = segments.at(-2);
  const topChatId =
    section === "chat" && typeof agentId === "string"
      ? agentId
      : section === "channel" && typeof channelId === "string"
        ? channelId
        : null;
  // A task, a browser or a code preview on top of a chat keeps the chat marked. Home clears it.
  const lastChatId = useRef<string | null>(null);
  if (topChatId !== null) lastChatId.current = topChatId;
  else if (segments.at(-1) === "connected") lastChatId.current = null;
  const selectedChatId = topChatId ?? lastChatId.current;
  const pane = useMemo(() => ({ topChatId, selectedChatId }), [topChatId, selectedChatId]);
  return <ChatListPaneContext value={pane}>{children}</ChatListPaneContext>;
}

/** The background of a list row: marked in the pane for the chat that the detail column shows. */
export function useChatRowBackground(chatId: string): string {
  const selected = useChatListPane()?.selectedChatId === chatId;
  const background = useThemeColor("background");
  const selectedBackground = useCSSVariable("--color-control-active");
  return String(selected ? selectedBackground : background);
}

/**
 * Opens a chat from the pane. The detail column shows one chat, as a split view does, so the screens
 * above home leave before the chat opens, and Back does not go through earlier chats.
 */
export function openChatFromPane(pane: ChatListPane, chatId: string | undefined, navigate: () => void): void {
  if (chatId !== undefined && pane.topChatId === chatId) return;
  if (router.canDismiss()) router.dismissAll();
  navigate();
}
