import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function AddServerLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack
      screenListeners={sheetBackHaptics}
      screenOptions={{
        ...sheetHeaderInsetOptions,
        presentation: "card",
        headerShown: false,
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen
        name="local"
        options={(props) => ({
          ...sheetStackOptions(background)(props),
          headerShown: true,
          title: t("mobile.server.local.title"),
        })}
      />
    </Stack>
  );
}
