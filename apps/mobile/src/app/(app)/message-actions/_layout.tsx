import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { useCSSVariable } from "uniwind";
import { useMessageActions } from "@/features/chat/context/message-actions-context";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = { initialRouteName: "index" };

export default function MessageActionsLayout() {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  const { select } = useMessageActions();
  useEffect(() => () => select(null), [select]);
  return (
    <Stack
      screenOptions={{
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Message options" }} />
      <Stack.Screen name="select-text" options={{ title: "Message" }} />
    </Stack>
  );
}
