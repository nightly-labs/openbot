import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function ChannelInfoLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
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
      <Stack.Screen name="index" options={{ title: t("mobile.channel.route.info") }} />
      <Stack.Screen name="memories" options={{ title: t("mobile.channel.route.memories") }} />
      <Stack.Screen name="memory" options={{ title: t("mobile.channel.route.memory") }} />
      <Stack.Screen name="routines" options={{ title: t("mobile.channel.route.routines") }} />
      <Stack.Screen name="routine" options={{ title: t("mobile.channel.route.routine") }} />
    </Stack>
  );
}
