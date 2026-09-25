import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { registerChatLink } from "@/features/agents/model/chat-link-registry";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { haptics } from "@/shared/lib/haptics";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

// Link injects its handler here, including the AppleZoom source parameters.
// Defer that exact handler rather than recreating navigation with router.push.
export function ChatLinkPressable({
  onPress,
  chatId,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** Registers the link of this row, so a Live Activity tap can open the chat with the same transition. */
  chatId?: string;
  /** Link sets it on its child. It carries the AppleZoom source parameters. */
  href?: string;
}) {
  const gate = useContext(ChatNavigationGateContext);
  const route = useRoute();
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { href } = props;
  useEffect(() => (chatId && href ? registerChatLink(chatId, href) : undefined), [chatId, href]);

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
        if (gate && route.name === "connected") gate.request(navigate, navigation.isFocused);
        else navigate();
      }}
    />
  );
}
