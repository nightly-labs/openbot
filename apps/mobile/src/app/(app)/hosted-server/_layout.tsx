import { Stack } from "expo-router/stack";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

// One sheet owns the purchase: the plans, then the payment and the setup of the new server as an
// inner page. The back button on the setup returns to the plans while the server waits for payment.
// Join with an invitation is an inner page too, so the user can go back to the plans.
export default function HostedServerLayout() {
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
      <Stack.Screen name="index" options={{ title: t("mobile.app.route.hostedServerPlans") }} />
      <Stack.Screen name="setup" options={{ title: t("mobile.app.route.hostedServerSetup") }} />
      {/* Join draws its own title; the header keeps only the back button. */}
      <Stack.Screen name="join" options={{ title: "" }} />
      {/* The header stays, so the push does not hide the bar and move the join page under it. */}
      <Stack.Screen name="scan" options={{ title: t("mobile.server.scan.title") }} />
    </Stack>
  );
}
