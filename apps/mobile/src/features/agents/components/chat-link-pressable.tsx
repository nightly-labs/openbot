import type { ComponentProps } from "react";
import { Pressable } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { haptics } from "@/shared/lib/haptics";

export function ChatLinkPressable({
  chatId,
  onPress,
  ...props
}: ComponentProps<typeof Pressable> & {
  chatId?: string;
}) {
  const pane = useChatListPane();

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (event.defaultPrevented) return;
        void haptics.impact("soft");
        if (pane) openChatFromPane(pane, chatId, () => onPress?.(event));
        else onPress?.(event);
      }}
    />
  );
}
