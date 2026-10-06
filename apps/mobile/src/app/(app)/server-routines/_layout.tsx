import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function ServerRoutinesLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenListeners={sheetBackHaptics}
      screenOptions={{
        ...sheetHeaderInsetOptions,
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
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.routines") }} />
      <Stack.Screen name="agent-routine" options={{ title: t("mobile.app.route.routine") }} />
      <Stack.Screen name="channel-routine" options={{ title: t("mobile.app.route.routine") }} />
    </Stack>
  );
}
