import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useEffect, useLayoutEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useUniwind, withUniwind } from "uniwind";

import { MobileAnalyticsLifecycle } from "@/features/analytics/lifecycle";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { loadAppearance } from "@/features/settings/model/appearance";
import { loadHapticsPreference } from "@/features/settings/model/haptics";
import { AppLoadingOverlayProvider, useAppLoadingOverlay } from "@/shared/components/app-loading-overlay";
import { BloubAnimationProvider } from "@/shared/components/bloub-loader";
import { SplashBackdrop } from "@/shared/components/splash-backdrop";
import { isIOS } from "@/shared/lib/platform";
import { queryClient } from "@/shared/lib/query-client";

export const unstable_settings = {
  initialRouteName: "index",
};

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);

function RootNavigator() {
  const { loading, session } = useMobileSession();
  const pathname = usePathname();
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();

  useLayoutEffect(() => {
    if (loading || !session || (pathname !== "/" && pathname !== "/connected")) setLoadingLabel(null);
    // The splash backdrop covers account loading on its own, so it never raises
    // the overlay loader. Keep the loader down until ConnectedScreen reports the
    // workspace state.
  }, [loading, pathname, session, setLoadingLabel]);

  if (loading || (!session && isLoaderPresent)) {
    return <SplashBackdrop />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTransparent: isIOS,
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="scan-qr-code" options={{ animation: "slide_from_right", title: "Scan QR code" }} />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(app)" options={{ animation: "fade", gestureEnabled: false, headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const { theme: colorScheme } = useUniwind();
  useEffect(() => {
    void loadAppearance().catch(() => undefined);
    void loadHapticsPreference().catch(() => undefined);
  }, []);

  return (
    <UniwindGestureHandlerRootView className="flex-1">
      <KeyboardProvider preload={false}>
        <QueryClientProvider client={queryClient}>
          <HeroUINativeProvider>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
              <BloubAnimationProvider>
                <MobileSessionProvider>
                  <MobileAnalyticsLifecycle />
                  <AppLoadingOverlayProvider>
                    <RootNavigator />
                  </AppLoadingOverlayProvider>
                </MobileSessionProvider>
              </BloubAnimationProvider>
            </ThemeProvider>
          </HeroUINativeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </UniwindGestureHandlerRootView>
  );
}
