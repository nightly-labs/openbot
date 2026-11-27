import "../../../../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { RoutingQueueProvider } from "expo-router/build/global-state/routingQueueContext";
import { NavigationStateContext } from "expo-router/build/react-navigation/core/NavigationStateContext";
import { createNativeStackNavigator } from "expo-router/native-stack";
import { Typography } from "heroui-native";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useMemo } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind, withUniwind } from "uniwind";
import { MobileSessionProvider, useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MobileWorkspaceProvider } from "@/features/workspace/context/mobile-workspace-context";
import { navigationFonts } from "@/shared/lib/app-font";
import { isAndroid } from "@/shared/lib/platform";
import { queryClient } from "@/shared/lib/query-client";
import { useText } from "@/shared/lib/text";
import { ChatBubbleHeader, ChatBubbleScreen } from "./chat-bubble-screen";

const UniwindGestureHandlerRootView = withUniwind(GestureHandlerRootView);
const Stack = createNativeStackNavigator();
const lightTheme = { ...DefaultTheme, fonts: navigationFonts };

/**
 * The bubble shows one screen, so the navigator starts on a state that already holds it. The chat
 * reads the focus and the navigation of its screen, which a navigator gives and a plain view does
 * not.
 */
const BUBBLE_ROUTE = { key: "chat-bubble", name: "chat-bubble" };
const BUBBLE_STATE = {
  key: "chat-bubble",
  routeKeySeq: 1,
  index: 0,
  routeNames: ["chat-bubble"],
  routes: [BUBBLE_ROUTE],
  stale: false as const,
  type: "stack",
};

function BubbleContent() {
  const { t } = useText();
  const { loading, session } = useMobileSession();
  if (loading) return null;
  if (!session) {
    return (
      <View className="flex-1 bg-background">
        <ChatBubbleHeader title={t("mobile.settings.chatBubble.title")} />
        <Typography.Paragraph type="body-sm" className="px-4 text-muted">
          {t("mobile.settings.chatBubble.noSession")}
        </Typography.Paragraph>
      </View>
    );
  }
  return (
    <MobileWorkspaceProvider>
      <ChatBubbleScreen />
    </MobileWorkspaceProvider>
  );
}

export function ChatBubbleApp() {
  const { theme } = useUniwind();
  const canvas = String(useCSSVariable("--openbot-bg-native-canvas"));
  const darkTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: canvas }, fonts: navigationFonts }),
    [canvas],
  );
  return (
    <UniwindGestureHandlerRootView className="flex-1">
      <KeyboardProvider
        preload={false}
        statusBarTranslucent={isAndroid}
        navigationBarTranslucent={isAndroid}
        preserveEdgeToEdge={isAndroid}
      >
        <QueryClientProvider client={queryClient}>
          <HeroUINativeProvider>
            <ThemeProvider value={theme === "dark" ? darkTheme : lightTheme}>
              <SafeAreaProvider>
                <MobileSessionProvider>
                  <RoutingQueueProvider>
                    <NavigationStateContext.Provider value={{ state: BUBBLE_STATE }}>
                      <Stack.Navigator screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="chat-bubble" component={BubbleContent} />
                      </Stack.Navigator>
                    </NavigationStateContext.Provider>
                  </RoutingQueueProvider>
                </MobileSessionProvider>
              </SafeAreaProvider>
            </ThemeProvider>
          </HeroUINativeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </UniwindGestureHandlerRootView>
  );
}
