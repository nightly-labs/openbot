import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function ChannelInfoLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack screenListeners={sheetBackHaptics} screenOptions={sheetStackOptions(background)}>
      <Stack.Screen name="index" options={{ title: t("mobile.channel.route.info") }} />
      <Stack.Screen name="memories" options={{ title: t("mobile.channel.route.memories") }} />
      <Stack.Screen name="memory" options={{ title: t("mobile.channel.route.memory") }} />
      <Stack.Screen name="routines" options={{ title: t("mobile.channel.route.routines") }} />
      <Stack.Screen name="routine" options={{ title: t("mobile.channel.route.routine") }} />
      <Stack.Screen name="folders" options={{ title: t("mobile.agent.folders.title") }} />
      <Stack.Screen name="folder-browser" options={{ title: t("mobile.agent.folders.browseTitle") }} />
      <Stack.Screen name="picture" options={{ title: t("mobile.channel.picture.title") }} />
      <Stack.Screen name="crop-photo" options={{ title: t("mobile.app.route.cropPhoto") }} />
    </Stack>
  );
}
