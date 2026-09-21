import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useReducedMotion } from "react-native-reanimated";
import { useUniwind, withUniwind } from "uniwind";

import { MobileAnalyticsLifecycle } from "@/features/analytics/lifecycle";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { loadAppearance, useAppearance } from "@/features/settings/model/appearance";
import { loadHapticsPreference } from "@/features/settings/model/haptics";
import { AppLoadingOverlayProvider, useAppLoadingOverlay } from "@/shared/components/app-loading-overlay";
import { BloubAnimationProvider } from "@/shared/components/bloub-loader";
import { SplashBackdrop } from "@/shared/components/splash-backdrop";
import { nativeSplash } from "@/shared/lib/native-splash";
import { isIOS } from "@/shared/lib/platform";
import { queryClient } from "@/shared/lib/query-client";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import {
  SplashContentReadyContext,
  type SplashLogoTarget,
  SplashMotionContext,
  useSplashGate,
} from "@/shared/lib/use-splash-gate";
import { useSplashMotion } from "@/shared/lib/use-splash-motion";

export const unstable_settings = {
  initialRouteName: "index",
};

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);

function RootNavigator() {
  const { loading, session } = useMobileSession();
  const pathname = usePathname();
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();
  const appearanceReady = useAppearance((state) => state.ready);
  const busy = loading || !appearanceReady || (!session && isLoaderPresent);
  const { covered, reportArtwork, reportContentReady } = useSplashGate(busy, nativeSplash, appearanceReady);

  const container = useRef<View>(null);
  const reducedMotion = useReducedMotion();
  const foreground = useAppForeground();
  const [target, setTarget] = useState<SplashLogoTarget | null>(null);
  const motion = useSplashMotion({ covered, hasTarget: Boolean(target), foreground, reducedMotion });
  const reportReady = useCallback(
    (logo?: SplashLogoTarget) => {
      if (!logo) {
        reportContentReady();
        return;
      }
      container.current?.measureInWindow((x, y) => {
        const next = { x: logo.x - x, y: logo.y - y, size: logo.size };
        setTarget((current) =>
          current?.x === next.x && current?.y === next.y && current?.size === next.size ? current : next,
        );
        reportContentReady();
      });
    },
    [reportContentReady],
  );

  useLayoutEffect(() => {
    if (loading || !session || (pathname !== "/" && pathname !== "/connected")) setLoadingLabel(null);
    // The splash backdrop covers account loading on its own, so it never raises
    // the overlay loader. Keep the loader down until ConnectedScreen reports the
    // workspace state.
  }, [loading, pathname, session, setLoadingLabel]);

  return (
    <SplashContentReadyContext.Provider value={reportReady}>
      <SplashMotionContext.Provider value={motion}>
        <View ref={container} collapsable={false} className="flex-1">
          <View
            className="flex-1"
            pointerEvents={covered ? "none" : "auto"}
            accessibilityElementsHidden={covered}
            importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
          >
            {!loading && appearanceReady ? (
              <View
                className="flex-1"
                onLayout={session || pathname === "/scan-qr-code" ? () => reportReady() : undefined}
              >
                <Stack
                  screenOptions={{
                    headerBackButtonDisplayMode: "minimal",
                    headerShadowVisible: false,
                    headerTransparent: isIOS,
                  }}
                >
                  <Stack.Protected guard={!session}>
                    <Stack.Screen name="index" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="scan-qr-code"
                      options={{ animation: "slide_from_right", title: "Scan QR code" }}
                    />
                  </Stack.Protected>
                  <Stack.Protected guard={Boolean(session)}>
                    <Stack.Screen
                      name="(app)"
                      options={{ animation: "fade", gestureEnabled: false, headerShown: false }}
                    />
                  </Stack.Protected>
                </Stack>
              </View>
            ) : null}
          </View>
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={covered ? "auto" : "none"}
            accessibilityElementsHidden={!covered}
            importantForAccessibility={covered ? "auto" : "no-hide-descendants"}
          >
            {appearanceReady && (covered || !motion.complete) ? (
              <SplashBackdrop
                onArtworkDisplay={reportArtwork}
                progress={motion.progress}
                target={!session && pathname === "/" ? target : null}
                reducedMotion={reducedMotion}
              />
            ) : null}
          </View>
        </View>
      </SplashMotionContext.Provider>
    </SplashContentReadyContext.Provider>
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
