import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function QueuedMessagesLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack screenListeners={sheetBackHaptics} screenOptions={sheetStackOptions(background)}>
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.queuedMessages") }} />
      <Stack.Screen name="actions" options={{ title: t("mobile.app.route.messageOptions") }} />
      <Stack.Screen name="edit" options={{ title: t("mobile.app.route.editMessage") }} />
    </Stack>
  );
}
