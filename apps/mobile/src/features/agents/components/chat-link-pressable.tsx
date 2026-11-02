import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { haptics } from "@/shared/lib/haptics";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

// Link injects its handler here. Defer that exact handler rather than recreating navigation with
// router.push.
export function ChatLinkPressable({
  chatId,
  onPress,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** The chat this row opens. The chat list pane does not open the chat that shows already. */
  chatId?: string;
}) {
  const gate = useContext(ChatNavigationGateContext);
  const pane = useChatListPane();
  const route = useRoute();
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (event.defaultPrevented) return;
        void haptics.impact("soft");
        event.persist();
        const navigate = () => {
          if (mounted.current) onPress?.(event);
        };
        if (pane) openChatFromPane(pane, chatId, navigate);
        else if (gate && route.name === "connected") gate.request(navigate, navigation.isFocused);
        else navigate();
      }}
    />
  );
}
