import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export default function ServerUsageLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.usage") }} />
    </Stack>
  );
}
