import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

// The sheet holds a stack of one page, because Android shows the native header with Close and Add
// agent only on a page inside a stack, not on the formSheet route itself.
export default function InstallAgentLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenOptions={{
        ...sheetHeaderInsetOptions,
        presentation: "card",
        headerShadowVisible: false,
        // Between Close and Add agent, as on iOS. Android puts the title next to Close by default.
        headerTitleAlign: "center",
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.addSharedAgent") }} />
    </Stack>
  );
}
