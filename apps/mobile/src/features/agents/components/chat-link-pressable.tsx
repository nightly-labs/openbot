import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { type GestureResponderEvent, Pressable } from "react-native";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { haptics } from "@/shared/lib/haptics";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

interface LinkPress {
  // A method signature, so Link's handler fits although it declares a touch event. On native, Link
  // reads the event only as `event?.defaultPrevented`, and a chat opened from a sheet has no touch.
  press(event?: GestureResponderEvent): void;
}

// Link injects its handler here, including the AppleZoom source parameters.
// Defer that exact handler rather than recreating navigation with router.push.
export function ChatLinkPressable({
  chatId,
  onPress,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** Registers this home row, so the search sheet can open the chat with the row's zoom source. */
  chatId?: string;
}) {
  const gate = useContext(ChatNavigationGateContext);
  const route = useRoute();
  const navigation = useNavigation();
  const mounted = useRef(true);
  const linkPress = useRef<LinkPress>({ press: () => undefined });
  linkPress.current = { press: onPress ?? (() => undefined) };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!gate || !chatId || route.name !== "connected") return;
    // No gate wait: the caller closes the sheet in the same routing queue run, and a wait for the
    // home screen to settle delays the chat until the sheet animation ends.
    return gate.registerOpener(chatId, () => linkPress.current.press());
  }, [gate, chatId, route.name]);

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
