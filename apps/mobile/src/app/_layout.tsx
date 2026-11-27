import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useSegments } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { useCSSVariable, useUniwind, withUniwind } from "uniwind";

import { MobileAnalyticsLifecycle } from "@/features/analytics/lifecycle";
import { AppLockOverlay } from "@/features/app-lock/components/app-lock-overlay";
import { installAppLock } from "@/features/app-lock/model/app-lock";
import { UpdateRequiredOverlay } from "@/features/app-update/components/update-required-overlay";
import { DevelopmentConnectLinkHandler } from "@/features/auth/components/development-connect-link-handler";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { backgroundRefreshNative } from "@/features/background-refresh/background-refresh-native";
import { loadOnboardingProgress } from "@/features/onboarding/model/onboarding-progress";
import { resetNotificationAvatars } from "@/features/push-notifications/notification-avatars";
import { installNotificationHandler } from "@/features/push-notifications/use-notification-taps";
import { installQuickActions, resetQuickActions } from "@/features/quick-actions/quick-actions-native";
import { ThemeSweep } from "@/features/settings/components/theme-sweep";
import { loadAppLanguage } from "@/features/settings/model/app-language";
import { loadAppearance, useAppearance } from "@/features/settings/model/appearance";
import { loadFullScreenCameraPreference } from "@/features/settings/model/camera-mode";
import { loadChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { loadChatBackground } from "@/features/settings/model/chat-background";
import { loadChatDetailPreferences } from "@/features/settings/model/chat-details";
import { loadChatOrderPreference } from "@/features/settings/model/chat-order";
import { loadChatPullPreference, loadChatSwipePreference } from "@/features/settings/model/chat-swipe";
import { loadDictationLanguage } from "@/features/settings/model/dictation-language";
import { loadHapticsPreference } from "@/features/settings/model/haptics";
import { loadLargeFilePreference } from "@/features/settings/model/large-files";
import { offerLayoutRestart } from "@/features/settings/model/layout-direction";
import { loadLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import { loadMessageColor } from "@/features/settings/model/message-color";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { loadMotionPreferences } from "@/features/settings/model/motion-storage";
import { loadPhotoQualityPreference } from "@/features/settings/model/photo-quality";
import { loadPushNotificationPreference } from "@/features/settings/model/push-notifications";
import { loadRoutineCollapsePreference } from "@/features/settings/model/routine-collapse";
import { loadTextSize } from "@/features/settings/model/text-size";
import { loadFullVisualPreference } from "@/features/settings/model/visual-preview";
import { resetShareExtension } from "@/features/share/model/share-extension";
import { resetShortcutDirectory } from "@/features/shortcuts/model/shortcut-directory";
import { installShortcuts, resetShortcuts } from "@/features/shortcuts/shortcuts-native";
import { supportLog } from "@/features/support/model/support-log";
import { installSupportLog } from "@/features/support/model/support-log-capture";
import { checkRecognitionModels } from "@/features/voice/model/recognition-models";
import { supertonicModel } from "@/features/voice/model/supertonic-model";
import { loadVoiceServer } from "@/features/voice/model/voice-server";
import { loadVoiceSettings } from "@/features/voice/model/voice-settings";
import { installWatch, resetWatch } from "@/features/watch/watch-native";
import { AppLoadingOverlayProvider, useAppLoadingOverlay } from "@/shared/components/app-loading-overlay";
import { useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import { BloubStage } from "@/shared/components/bloub-stage/bloub-stage";
import { BloubStageProvider, useBloubStageRequest } from "@/shared/components/bloub-stage/bloub-stage-context";
import { BLOUB_PRIORITY } from "@/shared/components/bloub-stage/bloub-stage-store";
import { headerFontOptions, navigationFonts } from "@/shared/lib/app-font";
import { useReducedMotion } from "@/shared/lib/motion";
import { nativeSplash } from "@/shared/lib/native-splash";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { queryClient } from "@/shared/lib/query-client";
import { useText } from "@/shared/lib/text";
import { untilForeground } from "@/shared/lib/until-foreground";
import { SplashContentReadyContext, useSplashGate } from "@/shared/lib/use-splash-gate";

export const unstable_settings = {
  anchor: "index",
};

installSupportLog();
installQuickActions();
installShortcuts();
installWatch();
installAppLock();
installNotificationHandler();
backgroundRefreshNative?.install();

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);
const lightTheme = { ...DefaultTheme, fonts: navigationFonts };

const SESSION_FADE_MS = 300;
const SLOW_LAUNCH_MS = 700;

function RootNavigator() {
  const { t } = useText();
  const { loading, session } = useMobileSession();
  const pathname = usePathname();
  const segments = useSegments();
  const screen = segments.filter((segment) => !segment.startsWith("(")).join("/") || "start";
  useEffect(() => {
    supportLog.add("info", "app", `Screen: ${screen}`);
  }, [screen]);
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();
  const appearanceReady = useAppearance((state) => state.ready);
  const motionReady = useMotionPreferences((state) => state.ready);
  const preferencesReady = appearanceReady && motionReady;
  const busy = loading || !preferencesReady;
  const { covered, nativeHidden, reportArtwork, reportContentReady } = useSplashGate(
    busy,
    nativeSplash,
    preferencesReady,
  );
  const reducedMotion = useReducedMotion();

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (covered) {
      const timer = setTimeout(() => setSlow(true), SLOW_LAUNCH_MS);
      return () => clearTimeout(timer);
    }
    // Brief handoff gaps reset `covered` for a frame. Wait before the caption leaves.
    const reset = setTimeout(() => setSlow(false), 120);
    return () => clearTimeout(reset);
  }, [covered]);
  useBloubStageRequest(
    covered
      ? {
          shape: { kind: "cover" },
          mood: slow ? "think" : "idle",
          caption: slow ? { text: t("mobile.shared.splash.loading") } : undefined,
          loader: true,
        }
      : null,
    BLOUB_PRIORITY.splash,
  );
  const blocked = covered || isLoaderPresent;

  useEffect(() => {
    if (loading || session) return;
    resetQuickActions();
    resetShareExtension();
    resetShortcutDirectory();
    resetShortcuts();
    resetNotificationAvatars();
    resetWatch();
  }, [loading, session]);

  useLayoutEffect(() => {
    if (loading || !session || (pathname !== "/" && pathname !== "/connected")) setLoadingLabel(null);
  }, [loading, pathname, session, setLoadingLabel]);

  return (
    <SplashContentReadyContext.Provider value={reportContentReady}>
      <View className="flex-1">
        <View
          className="flex-1"
          pointerEvents={blocked ? "none" : "auto"}
          accessibilityElementsHidden={blocked}
          importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
        >
          {!loading && preferencesReady ? (
            <View className="flex-1" onLayout={session || pathname !== "/" ? reportContentReady : undefined}>
              <Stack
                screenOptions={{
                  headerBackButtonDisplayMode: "minimal",
                  ...headerFontOptions,
                  headerShadowVisible: false,
                  headerTransparent: isIOS,
                }}
              >
                <Stack.Protected guard={!session} redirectTo="/connected">
                  <Stack.Screen
                    name="index"
                    options={{ animation: "fade", animationDuration: SESSION_FADE_MS, headerShown: false }}
                  />
                  <Stack.Screen
                    name="scan-qr-code"
                    options={{
                      animation: reducedMotion ? "fade" : "slide_from_right",
                      title: t("mobile.app.route.scanQrCode"),
                    }}
                  />
                </Stack.Protected>
                <Stack.Protected guard={Boolean(session)} redirectTo="/">
                  <Stack.Screen
                    name="(app)"
                    options={{
                      animation: "fade",
                      animationDuration: SESSION_FADE_MS,
                      gestureEnabled: false,
                      headerShown: false,
                    }}
                  />
                </Stack.Protected>
                <Stack.Screen name="incoming-link" options={{ headerShown: false }} />
                <Stack.Screen name="incoming-share" options={{ headerShown: false }} />
              </Stack>
            </View>
          ) : null}
        </View>
        <BloubStage nativeSplashHidden={nativeHidden} onLayout={() => reportArtwork("stage")} />
        <ThemeSweep />
        <UpdateRequiredOverlay />
        <AppLockOverlay />
      </View>
    </SplashContentReadyContext.Provider>
  );
}

export default function RootLayout() {
  const { theme: colorScheme } = useUniwind();
  const animations = useMotionPreferences((state) => state.allAnimations);
  const heroConfig = useMemo(() => (animations ? {} : { animation: "disable-all" as const }), [animations]);
  const canvas = String(useCSSVariable("--openbot-bg-native-canvas"));
  const bloub = useBloubColors();
  const splashColor = useRef("");
  splashColor.current = bloub.dark ? bloub.dimBody : bloub.body;
  const darkTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: canvas }, fonts: navigationFonts }),
    [canvas],
  );
  useEffect(() => {
    if (!isAndroid) return;
    void SystemUI.setBackgroundColorAsync(canvas).catch(() => undefined);
  }, [canvas]);
  useEffect(() => {
    void untilForeground().then(() => {
      void loadAppearance().catch(() => undefined);
      void loadHapticsPreference().catch(() => undefined);
      void loadLargeFilePreference().catch(() => undefined);
      void loadPhotoQualityPreference().catch(() => undefined);
      void loadFullScreenCameraPreference().catch(() => undefined);
      void loadMessageColor().catch(() => undefined);
      void loadChatBackground().catch(() => undefined);
      void loadChatBackdrop().catch(() => undefined);
      void loadRoutineCollapsePreference().catch(() => undefined);
      void loadChatDetailPreferences().catch(() => undefined);
      void loadFullVisualPreference().catch(() => undefined);
      void loadChatOrderPreference().catch(() => undefined);
      void loadChatSwipePreference().catch(() => undefined);
      void loadChatPullPreference().catch(() => undefined);
      void loadTextSize().catch(() => undefined);
      void loadLiveActivitiesPreference().catch(() => undefined);
      void loadPushNotificationPreference().catch(() => undefined);
      void loadMotionPreferences().catch(() => undefined);
      void loadDictationLanguage().catch(() => undefined);
      void loadVoiceSettings().catch(() => undefined);
      void loadVoiceServer().catch(() => undefined);
      supertonicModel.check();
      checkRecognitionModels();
      void loadAppLanguage()
        .catch(() => undefined)
        .then(() => offerLayoutRestart(splashColor.current, () => undefined));
      void loadOnboardingProgress().catch(() => undefined);
    });
  }, []);

  return (
    <UniwindGestureHandlerRootView className="flex-1">
      <KeyboardProvider
        preload={false}
        statusBarTranslucent={isAndroid}
        navigationBarTranslucent={isAndroid}
        preserveEdgeToEdge={isAndroid}
      >
        <QueryClientProvider client={queryClient}>
          <HeroUINativeProvider config={heroConfig}>
            {animations ? null : <ReducedMotionConfig mode={ReduceMotion.Always} />}
            <ThemeProvider value={colorScheme === "dark" ? darkTheme : lightTheme}>
              <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
              <BloubStageProvider>
                <MobileSessionProvider>
                  <MobileAnalyticsLifecycle />
                  {__DEV__ ? <DevelopmentConnectLinkHandler /> : null}
                  <AppLoadingOverlayProvider>
                    <RootNavigator />
                  </AppLoadingOverlayProvider>
                </MobileSessionProvider>
              </BloubStageProvider>
            </ThemeProvider>
          </HeroUINativeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </UniwindGestureHandlerRootView>
  );
}
