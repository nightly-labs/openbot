import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MermaidRendererHost } from "@/features/chat/components/mermaid-renderer-host";
import { MessageActionsProvider } from "@/features/chat/context/message-actions-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { setLiveActivityNavigator } from "@/features/live-activity/model/live-activity-link";
import { AppDrawerShell } from "@/features/servers/components/app-drawer-shell";
import { MobileWorkspaceProvider } from "@/features/workspace/context/mobile-workspace-context";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";

export const unstable_settings = {
  initialRouteName: "connected",
};

function AuthenticatedStack() {
  const segments = useSegments();
  // Reduced motion, from the device or from Settings, replaces the full-screen slide with a cross-fade.
  const pushAnimation = useReducedMotion() ? "fade" : "slide_from_right";
  const background = useThemeColor("background");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet") ?? background);
  const [navigationGate] = useState(createChatNavigationGate);
  const { agentId: openAgentId } = useGlobalSearchParams<{ agentId?: string }>();
  const openChat = useRef<string | null>(null);
  openChat.current = segments.at(-2) === "chat" && typeof openAgentId === "string" ? openAgentId : null;
  const onChatList = useRef(false);
  onChatList.current = segments.at(-1) === "connected";
  useEffect(
    () =>
      setLiveActivityNavigator((agentId) => {
        // Opening the chat that shows already would mount it again and load it again.
        if (agentId !== null && openChat.current === agentId) return;
        // The chat opens on top of the main screen, so Back returns there and not to an earlier chat.
        if (router.canDismiss()) router.dismissAll();
        if (agentId === null) return;
        // The home row opens the chat, as it does for search, so the chat zooms from the row avatar
        // and back. The gate waits until the list shows. A chat without a row opens without zoom.
        navigationGate.request(
          () => {
            if (!navigationGate.openFromHome(agentId))
              router.push({ pathname: "/chat/[agentId]", params: { agentId } });
          },
          () => onChatList.current,
        );
      }),
    [navigationGate],
  );

  return (
    <ChatNavigationGateContext value={navigationGate}>
      <Stack
        initialRouteName="connected"
        screenListeners={({ route }) =>
          route.name === "connected"
            ? {
                transitionStart: () => navigationGate.start(),
                transitionEnd: () => navigationGate.finish(),
                focus: () => navigationGate.focus(),
                blur: () => navigationGate.blur(),
              }
            : {
                gestureCancel: () => navigationGate.cancel(),
              }
        }
        screenOptions={{
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTransparent: isIOS,
          sheetExpandsWhenScrolledToEdge: false,
          // iOS rounds a sheet by default. Android uses 0, so it gets the Material 3 sheet corner.
          ...(isAndroid && { sheetCornerRadius: 28 }),
        }}
      >
        <Stack.Screen name="connected" options={{ animation: "fade", gestureEnabled: false, title: "" }} />
        <Stack.Screen
          name="chat/[agentId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="code-preview/[previewId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            // The diagram pans with one finger, so only the screen edge goes back.
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            // The screen draws the app's glass header, as the chat does.
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="channel/[channelId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="channel-info/[channelId]"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="channel-actions/[channelId]"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.6],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-channel"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-agent"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="agent-info/[agentId]"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="install-agent"
          // The header comes from the stack in `install-agent/_layout.tsx`: Android draws no header on
          // a formSheet route, so Close and Add agent would not show there.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            // A page to read before adding: full height, as the agent search. On Android a full-height
            // sheet goes under the status bar and covers its header, so it uses the form height.
            sheetAllowedDetents: isAndroid ? [0.85] : [1],
            sheetInitialDetentIndex: "last",
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="section-form"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          // Android: autoFocus focuses the name field while the sheet opens, and Android does not show
          // the keyboard then. Focusing the field again after the opening shows it.
          listeners={
            isAndroid
              ? {
                  transitionEnd: (event) => {
                    if (event.data.closing) return;
                    const input = TextInput.State.currentlyFocusedInput();
                    if (!input) return;
                    input.blur();
                    input.focus();
                  },
                }
              : undefined
          }
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="add-server"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="hosted-server"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="search-agents"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetInitialDetentIndex: "last",
          }}
        />
        <Stack.Screen
          name="hidden-chats"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="server-settings"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="server-routines"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="server-usage"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="message-actions"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [segments.at(-1) === "select-text" ? 0.85 : 0.4],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="queued-messages"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
      </Stack>
    </ChatNavigationGateContext>
  );
}

export default function AuthenticatedLayout() {
  const { session } = useMobileSession();
  const workspaceKey = session ? `${session.apiUrl}:${session.user.id}` : "signed-out";

  return (
    <MobileWorkspaceProvider key={workspaceKey}>
      <AgentPinTransitionProvider>
        <AppDrawerShell>
          <MessageActionsProvider>
            <QueuedMessagesProvider>
              <AuthenticatedStack />
              <MermaidRendererHost />
            </QueuedMessagesProvider>
          </MessageActionsProvider>
        </AppDrawerShell>
      </AgentPinTransitionProvider>
    </MobileWorkspaceProvider>
  );
}
