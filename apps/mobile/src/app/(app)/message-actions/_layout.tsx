import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { useCSSVariable } from "uniwind";
import { useMessageActions } from "@/features/chat/context/message-actions-context";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function MessageActionsLayout() {
  const { t } = useText();
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
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.messageOptions") }} />
      <Stack.Screen name="select-text" options={{ title: t("mobile.app.route.message") }} />
    </Stack>
  );
}
