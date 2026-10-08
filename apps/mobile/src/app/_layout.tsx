import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { useCSSVariable, useUniwind, withUniwind } from "uniwind";

import { MobileAnalyticsLifecycle } from "@/features/analytics/lifecycle";
import { DevelopmentConnectLinkHandler } from "@/features/auth/components/development-connect-link-handler";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { loadAppLanguage } from "@/features/settings/model/app-language";
import { loadAppearance, useAppearance } from "@/features/settings/model/appearance";
import { loadDictationLanguage } from "@/features/settings/model/dictation-language";
import { loadHapticsPreference } from "@/features/settings/model/haptics";
import { loadLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import { loadAgentColorMessages } from "@/features/settings/model/message-color";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { loadMotionPreferences } from "@/features/settings/model/motion-storage";
import { installSupportLog } from "@/features/support/model/support-log-capture";
import { AppLoadingOverlayProvider, useAppLoadingOverlay } from "@/shared/components/app-loading-overlay";
import { BloubAnimationProvider } from "@/shared/components/bloub-loader";
import { SplashBackdrop } from "@/shared/components/splash-backdrop";
import { useReducedMotion } from "@/shared/lib/motion";
import { nativeSplash } from "@/shared/lib/native-splash";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { queryClient } from "@/shared/lib/query-client";
import { useText } from "@/shared/lib/text";
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

installSupportLog();

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);

function RootNavigator() {
  const { t } = useText();
  const { loading, session } = useMobileSession();
  const pathname = usePathname();
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();
  const appearanceReady = useAppearance((state) => state.ready);
  // Motion choices are read before the first screen, so no screen starts an animation that Settings turned off.
  const motionReady = useMotionPreferences((state) => state.ready);
  const preferencesReady = appearanceReady && motionReady;
  const busy = loading || !preferencesReady || (!session && isLoaderPresent);
  const { covered, reportArtwork, reportContentReady } = useSplashGate(busy, nativeSplash, preferencesReady);

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
            {!loading && preferencesReady ? (
              <View className="flex-1" onLayout={session || pathname !== "/" ? () => reportReady() : undefined}>
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
                      options={{
                        animation: reducedMotion ? "fade" : "slide_from_right",
                        title: t("mobile.app.route.scanQrCode"),
                      }}
                    />
                  </Stack.Protected>
                  <Stack.Protected guard={Boolean(session)}>
                    <Stack.Screen
                      name="(app)"
                      options={{ animation: "fade", gestureEnabled: false, headerShown: false }}
                    />
                  </Stack.Protected>
                  <Stack.Screen name="incoming-link" options={{ headerShown: false }} />
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
            {preferencesReady && (covered || !motion.complete) ? (
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
  const animations = useMotionPreferences((state) => state.allAnimations);
  const heroConfig = useMemo(() => (animations ? {} : { animation: "disable-all" as const }), [animations]);
  const canvas = String(useCSSVariable("--openbot-bg-native-canvas"));
  // React Navigation paints its near-black dark background behind screens during transitions.
  const darkTheme = useMemo(() => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: canvas } }), [canvas]);
  // Android shows the window background behind the system bars. Without this it keeps the light splash color.
  // iOS shows the window background behind sheets, so it keeps its default.
  useEffect(() => {
    if (!isAndroid) return;
    void SystemUI.setBackgroundColorAsync(canvas).catch(() => undefined);
  }, [canvas]);
  useEffect(() => {
    void loadAppearance().catch(() => undefined);
    void loadHapticsPreference().catch(() => undefined);
    void loadAgentColorMessages().catch(() => undefined);
    void loadLiveActivitiesPreference().catch(() => undefined);
    void loadMotionPreferences().catch(() => undefined);
    void loadDictationLanguage().catch(() => undefined);
    void loadAppLanguage().catch(() => undefined);
  }, []);

  return (
    <UniwindGestureHandlerRootView className="flex-1">
      {/* The app draws under the system bars and pads with safe area insets. Expo Go on Android does not
          report edge-to-edge, and without these props the keyboard provider pads the whole app. */}
      <KeyboardProvider
        preload={false}
        statusBarTranslucent={isAndroid}
        navigationBarTranslucent={isAndroid}
        preserveEdgeToEdge={isAndroid}
      >
        <QueryClientProvider client={queryClient}>
          <HeroUINativeProvider config={heroConfig}>
            {/* Off in Settings reduces every animation that follows the system Reduce Motion setting. */}
            {animations ? null : <ReducedMotionConfig mode={ReduceMotion.Always} />}
            <ThemeProvider value={colorScheme === "dark" ? darkTheme : DefaultTheme}>
              <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
              <BloubAnimationProvider>
                <MobileSessionProvider>
                  <MobileAnalyticsLifecycle />
                  {__DEV__ ? <DevelopmentConnectLinkHandler /> : null}
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
