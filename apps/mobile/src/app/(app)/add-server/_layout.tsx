import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

// One sheet owns the whole flow. The scanner is an inner page, so opening it never dismisses the
// sheet or puts a second modal over it. Both pages draw their own title, so the header stays off.
// The page that makes a server on an owned computer is a form: it has the native header, with its
// back button and the create action, as the same page in the cloud server sheet.
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
