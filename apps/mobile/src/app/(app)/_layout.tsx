import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useRef, useState } from "react";
import { useCSSVariable } from "uniwind";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { chatLinkParams } from "@/features/agents/model/chat-link-registry";
import { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MessageActionsProvider } from "@/features/chat/context/message-actions-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { setLiveActivityNavigator } from "@/features/live-activity/model/live-activity-link";
import { AppDrawerShell } from "@/features/servers/components/app-drawer-shell";
import { MobileWorkspaceProvider } from "@/features/workspace/context/mobile-workspace-context";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = {
  initialRouteName: "connected",
};

function AuthenticatedStack() {
  const segments = useSegments();
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
        // The row link carries the AppleZoom source, so the chat zooms from the row avatar and back,
        // as a tap on the row does. The gate waits until the list shows, as it does for a tap.
        const params = chatLinkParams(agentId);
        if (params) {
          navigationGate.request(
            () => router.navigate({ pathname: "/chat/[agentId]", params: { ...params, agentId } }),
            () => onChatList.current,
          );
        } else router.push({ pathname: "/chat/[agentId]", params: { agentId } });
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
        }}
      >
        <Stack.Screen name="connected" options={{ animation: "fade", gestureEnabled: false, title: "" }} />
        <Stack.Screen
          name="chat/[agentId]"
          options={{
            animation: "slide_from_right",
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="channel/[channelId]"
          options={{
            animation: "slide_from_right",
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
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: sheetBackground },
            headerTransparent: false,
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.6],
            sheetGrabberVisible: true,
            title: "Actions needed",
          }}
        />
        <Stack.Screen
          name="add-channel"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerTransparent: isIOS,
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
            title: "New channel",
          }}
        />
        <Stack.Screen
          name="add-agent"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerTransparent: isIOS,
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
            title: "Create an agent",
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
          name="section-form"
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerTransparent: isIOS,
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
            title: "New section",
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
            </QueuedMessagesProvider>
          </MessageActionsProvider>
        </AppDrawerShell>
      </AgentPinTransitionProvider>
    </MobileWorkspaceProvider>
  );
}
