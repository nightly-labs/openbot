import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function AgentInfoLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenListeners={sheetBackHaptics}
      screenOptions={(props) => ({
        ...androidBackOptions(props),
        ...sheetHeaderInsetOptions,
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        ...headerFontOptions,
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      })}
    >
      <Stack.Screen name="index" options={{ title: t("mobile.agent.menu.info") }} />
      <Stack.Screen name="appearance" options={{ title: t("mobile.agent.route.appearance") }} />
      <Stack.Screen name="usage" options={{ title: t("mobile.agent.info.usage.title") }} />
      <Stack.Screen name="memories" options={{ title: t("mobile.agent.info.memories.title") }} />
      <Stack.Screen name="skills" options={{ title: t("mobile.agent.info.skills.title") }} />
      <Stack.Screen name="files" options={{ title: t("mobile.agent.info.files.title") }} />
      <Stack.Screen name="routines" options={{ title: t("mobile.agent.info.routines.title") }} />
      <Stack.Screen name="tables" options={{ title: t("mobile.agent.tables.title") }} />
      <Stack.Screen name="publish" options={{ title: t("mobile.agent.publish.title") }} />
      <Stack.Screen name="memory" options={{ title: t("mobile.agent.record.memory") }} />
      <Stack.Screen name="routine" options={{ title: t("mobile.agent.record.routine") }} />
      <Stack.Screen name="runtime" options={{ title: t("mobile.agent.runtime.model") }} />
      <Stack.Screen name="permissions" options={{ title: t("mobile.agent.permissions.title") }} />
      <Stack.Screen name="advanced" options={{ title: t("mobile.agent.advanced.title") }} />
      <Stack.Screen name="notifications" options={{ title: t("mobile.settings.notifications.title") }} />
      <Stack.Screen name="crop-photo" options={{ title: t("mobile.agent.route.cropPhoto") }} />
    </Stack>
  );
}
