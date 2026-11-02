import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

// One sheet shows the plans and the account's hosted servers, with no purchase: app store rules do
// not allow a purchase outside the store. The setup of a server in setup is an inner page. Join with
// an invitation is an inner page too, so the user can go back to the plans.
export default function HostedServerLayout() {
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
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.hostedServerPlans") }} />
      <Stack.Screen name="setup" options={{ title: t("mobile.app.route.hostedServerSetup") }} />
      {/* Join draws its own title; the header keeps only the back button. */}
      <Stack.Screen name="join" options={{ title: "" }} />
      {/* The header stays, so the push does not hide the bar and move the join page under it. */}
      {/* On Android the header is opaque elsewhere. Here the camera fills the page under it, as on iOS. */}
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
