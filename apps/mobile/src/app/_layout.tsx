import "../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "expo-router";
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
import { DevelopmentConnectLinkHandler } from "@/features/auth/components/development-connect-link-handler";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { loadOnboardingProgress } from "@/features/onboarding/model/onboarding-progress";
import { resetNotificationAvatars } from "@/features/push-notifications/notification-avatars";
import { installNotificationHandler } from "@/features/push-notifications/use-notification-taps";
import { installQuickActions, resetQuickActions } from "@/features/quick-actions/quick-actions-native";
import { ThemeSweep } from "@/features/settings/components/theme-sweep";
import { loadAppLanguage } from "@/features/settings/model/app-language";
import { loadAppearance, useAppearance } from "@/features/settings/model/appearance";
import { loadChatOrderPreference } from "@/features/settings/model/chat-order";
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
import { resetShareExtension } from "@/features/share/model/share-extension";
import { resetShortcutDirectory } from "@/features/shortcuts/model/shortcut-directory";
import { installShortcuts, resetShortcuts } from "@/features/shortcuts/shortcuts-native";
import { installSupportLog } from "@/features/support/model/support-log-capture";
import { checkRecognitionModels } from "@/features/voice/model/recognition-models";
import { supertonicModel } from "@/features/voice/model/supertonic-model";
import { loadVoiceServer } from "@/features/voice/model/voice-server";
import { loadVoiceSettings } from "@/features/voice/model/voice-settings";
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
installAppLock();
installNotificationHandler();

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);
const lightTheme = { ...DefaultTheme, fonts: navigationFonts };

// The sign-in screen and the app replace each other with this fade (iOS). After sign-in the stage
// covers both, so the fade only shows when the user signs out.
const SESSION_FADE_MS = 300;
// A launch that takes longer than this shows what it waits for.
const SLOW_LAUNCH_MS = 700;

function RootNavigator() {
  const { t } = useText();
  const { loading, session } = useMobileSession();
  const pathname = usePathname();
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();
  const appearanceReady = useAppearance((state) => state.ready);
  // Motion choices are read before the first screen, so no screen starts an animation that Settings turned off.
  const motionReady = useMotionPreferences((state) => state.ready);
  const preferencesReady = appearanceReady && motionReady;
  const busy = loading || !preferencesReady;
  const { covered, nativeHidden, reportArtwork, reportContentReady } = useSplashGate(
    busy,
    nativeSplash,
    preferencesReady,
  );
  const reducedMotion = useReducedMotion();

  // The stage takes over from the native splash with the same block and eyes. When the launch is
  // slow, the eyes start to think and the status shows under them.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!covered) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_LAUNCH_MS);
    return () => clearTimeout(timer);
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

  // A quick action stays on the app icon after the session ends, such as one that another device revoked.
  // The share extension keeps its copy of the session and the share sheet its agents, so both go too,
  // with the agents of the shortcuts and the agent pictures of the notifications.
  useEffect(() => {
    if (loading || session) return;
    resetQuickActions();
    resetShareExtension();
    resetShortcutDirectory();
    resetShortcuts();
    resetNotificationAvatars();
  }, [loading, session]);

  useLayoutEffect(() => {
    if (loading || !session || (pathname !== "/" && pathname !== "/connected")) setLoadingLabel(null);
    // The splash covers account loading on its own. Keep the loader down until ConnectedScreen
    // reports the workspace state.
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
                {/* A blocked route redirects. Without `redirectTo`, Expo Router uses the first open route, the
                    `(app)` group, whose URL is `/`, and `/` is the blocked sign-in screen. */}
                <Stack.Protected guard={!session} redirectTo="/connected">
                  {/* Signing out goes back, so it fades like signing in instead of sliding forward. */}
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
  // The reload screen of a direction restart has the color of the splash.
  const splashColor = useRef("");
  splashColor.current = bloub.dark ? bloub.dimBody : bloub.body;
  // React Navigation paints its near-black dark background behind screens during transitions.
  const darkTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: canvas }, fonts: navigationFonts }),
    [canvas],
  );
  // Android shows the window background behind the system bars. Without this it keeps the light splash color.
  // iOS shows the window background behind sheets, so it keeps its default.
  useEffect(() => {
    if (!isAndroid) return;
    void SystemUI.setBackgroundColorAsync(canvas).catch(() => undefined);
  }, [canvas]);
  // A locked phone does not open the settings, and a failed read keeps a default. So a start in the
  // background reads them when the user first opens the app.
  useEffect(() => {
    void untilForeground().then(() => {
      void loadAppearance().catch(() => undefined);
      void loadHapticsPreference().catch(() => undefined);
      void loadLargeFilePreference().catch(() => undefined);
      void loadPhotoQualityPreference().catch(() => undefined);
      void loadMessageColor().catch(() => undefined);
      void loadRoutineCollapsePreference().catch(() => undefined);
      void loadChatOrderPreference().catch(() => undefined);
      void loadTextSize().catch(() => undefined);
      void loadLiveActivitiesPreference().catch(() => undefined);
      void loadPushNotificationPreference().catch(() => undefined);
      void loadMotionPreferences().catch(() => undefined);
      void loadDictationLanguage().catch(() => undefined);
      void loadVoiceSettings().catch(() => undefined);
      void loadVoiceServer().catch(() => undefined);
      supertonicModel.check();
      checkRecognitionModels();
      // The layout direction follows the app language. A start with the other direction, such as the
      // first start or a start after the phone language changed, asks for a restart. A failed read
      // keeps the default language, which still sets the direction.
      void loadAppLanguage()
        .catch(() => undefined)
        .then(() => offerLayoutRestart(splashColor.current, () => undefined));
      void loadOnboardingProgress().catch(() => undefined);
    });
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
