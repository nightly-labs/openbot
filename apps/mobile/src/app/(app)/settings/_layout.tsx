import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.settings") }} />
      <Stack.Screen name="profile" options={{ title: t("mobile.app.route.profile") }} />
      <Stack.Screen name="general" options={{ title: t("mobile.app.route.general") }} />
      <Stack.Screen name="sessions" options={{ title: t("mobile.app.route.accountSessions") }} />
      <Stack.Screen name="about" options={{ title: t("mobile.app.route.about") }} />
      <Stack.Screen name="hidden-chats" options={{ title: t("mobile.app.route.hiddenChats") }} />
      <Stack.Screen name="deleted-chats" options={{ title: t("mobile.app.route.deletedChannels") }} />
      <Stack.Screen name="crop-photo" options={{ title: t("mobile.app.route.cropPhoto") }} />
    </Stack>
  );
}
