import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function HostedServerLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  return (
    <Stack screenListeners={sheetBackHaptics} screenOptions={sheetStackOptions(background)}>
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.hostedServerPlans") }} />
      <Stack.Screen name="setup" options={{ title: t("mobile.app.route.hostedServerSetup") }} />
      <Stack.Screen name="local" options={{ title: t("mobile.server.local.title") }} />
      <Stack.Screen name="join" options={{ title: "" }} />
      <Stack.Screen
        name="scan"
        options={{
          title: t("mobile.server.scan.title"),
          ...(isIOS ? null : { headerTransparent: true, headerStyle: { backgroundColor: "transparent" } }),
        }}
      />
    </Stack>
  );
}
