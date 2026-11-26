import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { createContext, type PropsWithChildren, use, useMemo, useRef } from "react";
import { useCSSVariable } from "uniwind";

interface ChatListPane {
  topChatId: string | null;
  selectedChatId: string | null;
}

const ChatListPaneContext = createContext<ChatListPane | null>(null);

export function useChatListPane(): ChatListPane | null {
  return use(ChatListPaneContext);
}

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
  const lastChatId = useRef<string | null>(null);
  if (topChatId !== null) lastChatId.current = topChatId;
  else if (segments.at(-1) === "connected") lastChatId.current = null;
  const selectedChatId = topChatId ?? lastChatId.current;
  const pane = useMemo(() => ({ topChatId, selectedChatId }), [topChatId, selectedChatId]);
  return <ChatListPaneContext value={pane}>{children}</ChatListPaneContext>;
}

export function useChatRowBackground(chatId: string): string {
  const selected = useChatListPane()?.selectedChatId === chatId;
  const background = useThemeColor("background");
  const selectedBackground = useCSSVariable("--color-control-active");
  return String(selected ? selectedBackground : background);
}

export function openChatFromPane(pane: ChatListPane, chatId: string | undefined, navigate: () => void): void {
  if (chatId !== undefined && pane.topChatId === chatId) return;
  if (router.canDismiss()) router.dismissAll();
  navigate();
}
