import type { ComponentProps } from "react";
import { Pressable } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import { haptics } from "@/shared/lib/haptics";

// Link injects its handler here. Call that exact handler rather than recreating navigation with
// router.push.
export function ChatLinkPressable({
  chatId,
  onPress,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** The chat this row opens. The chat list pane does not open the chat that shows already. */
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
