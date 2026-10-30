import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { ChatListPaneProvider } from "@/features/agents/components/chat-list-pane-context";
import { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { whenUnlocked } from "@/features/app-lock/model/app-lock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { AudioWaveformHost } from "@/features/chat/components/audio-waveform-host";
import { MermaidRendererHost } from "@/features/chat/components/mermaid-renderer-host";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { setLiveActivityNavigator } from "@/features/live-activity/model/live-activity-link";
import { HomeOnboardingProvider, useHomeOnboarding } from "@/features/onboarding/context/home-onboarding-context";
import type { NotificationTarget } from "@/features/push-notifications/push-notifications-native.types";
import { useNotificationTaps } from "@/features/push-notifications/use-notification-taps";
import type { QuickActionTarget } from "@/features/quick-actions/model/quick-action-items";
import { setQuickActionNavigator } from "@/features/quick-actions/quick-actions-native";
import { requestHomeSearch } from "@/features/search/model/home-search-request";
import { AppDrawerShell, useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { setShareSheetOpener } from "@/features/share/model/share-sheet-opener";
import {
  MobileWorkspaceProvider,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import { AdaptiveSplit, useSplitLayout } from "@/shared/components/adaptive-split";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** How long a notification tap waits for the channel list of its server before it opens the agent chat. */
const NOTIFICATION_CHANNEL_WAIT_MS = 8_000;

/**
 * Android: autoFocus focuses the name field of a form sheet while the sheet opens, and Android does
 * not show the keyboard then. Focusing the field again after the opening shows it.
 */
const refocusNameField = isAndroid
  ? {
      transitionEnd: (event: { data: { closing: boolean } }) => {
        if (event.data.closing) return;
        const input = TextInput.State.currentlyFocusedInput();
        if (!input) return;
        input.blur();
        input.focus();
      },
    }
  : undefined;

export const unstable_settings = {
  anchor: "connected",
};

function AuthenticatedStack() {
  const segments = useSegments();
  // Reduced motion, from the device or from Settings, replaces the full-screen slide with a cross-fade.
  const pushAnimation = useReducedMotion() ? "fade" : "slide_from_right";
  // Beside the chat list pane, a chat takes the place of the chat before it, so it fades in place.
  const chatAnimation = useSplitLayout() ? "fade" : pushAnimation;
  const { t } = useText();
  const background = useThemeColor("background");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet") ?? background);
  const largeTitlePage = {
    animation: pushAnimation,
    contentStyle: { backgroundColor: sheetBackground },
    headerTransparent: true,
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    title: "",
  } as const;
  const [navigationGate] = useState(createChatNavigationGate);
  const { closeDrawer } = useAppDrawer();
  const { agentId: openAgentId } = useGlobalSearchParams<{ agentId?: string }>();
  const openChat = useRef<string | null>(null);
  openChat.current = segments.at(-2) === "chat" && typeof openAgentId === "string" ? openAgentId : null;
  const onChatList = useRef(false);
  onChatList.current = segments.at(-1) === "connected";
  /** Opens a chat, or the chat list for `null`, from a Live Activity or a notification. */
  const openFromOutside = useCallback(
    (agentId: string | null) =>
      // A locked app opens the chat after the user unlocks it.
      whenUnlocked(() => {
        closeDrawer();
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
    [closeDrawer, navigationGate],
  );
  /** Opens the screen of a quick action of the app icon, on top of the main screen. */
  const openQuickAction = useCallback(
    (target: QuickActionTarget) => {
      if (target.type === "chat") {
        openFromOutside(target.agentId);
        return;
      }
      whenUnlocked(() => {
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        navigationGate.request(
          () =>
            target.type === "routines"
              ? router.push({ pathname: "/server-routines", params: { serverId: target.serverId } })
              : requestHomeSearch(),
          () => onChatList.current,
        );
      });
    },
    [closeDrawer, navigationGate, openFromOutside],
  );
  useEffect(() => setLiveActivityNavigator(openFromOutside), [openFromOutside]);
  useEffect(() => setQuickActionNavigator(openQuickAction), [openQuickAction]);
  useEffect(() => setShareSheetOpener(() => whenUnlocked(() => router.push("/share"))), []);
  const workspace = useMobileWorkspaceReader();
  /**
   * A prompt, an approval or a takeover on a channel thread opens the channel, as on desktop. A tap
   * at a cold start comes before the server connects, so it waits a short time for the channel list.
   */
  const openFromNotification = useCallback(
    ({ agentId, serverId, threadId }: NotificationTarget) => {
      if (!serverId || !threadId) {
        openFromOutside(agentId);
        return;
      }
      void workspace()
        .channelStore.whenListed(serverId, NOTIFICATION_CHANNEL_WAIT_MS)
        .then((state) => {
          const channel = state.channels.find(
            (item) => !item.archived && item.threads?.some((thread) => thread.threadId === threadId),
          );
          if (!channel) {
            openFromOutside(agentId);
            return;
          }
          whenUnlocked(() => {
            closeDrawer();
            if (router.canDismiss()) router.dismissAll();
            navigationGate.request(
              () => {
                if (!navigationGate.openFromHome(channel.id))
                  router.push({ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } });
              },
              () => onChatList.current,
            );
          });
        });
    },
    [workspace, openFromOutside, closeDrawer, navigationGate],
  );
  useNotificationTaps(openFromNotification, () => openChat.current);

  return (
    <ChatNavigationGateContext value={navigationGate}>
      <Stack
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
        screenOptions={(props) => ({
          // The full screens put the back arrow in the glass circle, as the home buttons are.
          ...androidBackOptions(props, { glass: true }),
          headerBackButtonDisplayMode: "minimal",
          ...headerFontOptions,
          headerShadowVisible: false,
          headerTransparent: isIOS,
          sheetExpandsWhenScrolledToEdge: false,
          // iOS rounds a sheet by default. Android uses 0, so it gets the Material 3 sheet corner.
          ...(isAndroid && { sheetCornerRadius: 28 }),
        })}
      >
        <Stack.Screen name="connected" options={{ animation: "fade", gestureEnabled: false, title: "" }} />
        <Stack.Screen
          name="chat/[agentId]"
          options={{
            animation: chatAnimation,
            contentStyle: { backgroundColor: background },
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="task/[taskId]"
          // A task is a chat of its own, so it opens as the agent's chat does.
          options={{
            animation: chatAnimation,
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
          name="browser/[agentId]"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: background },
            // Every finger on the page is the page's mouse, so only the screen edge goes back.
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
            // The screen draws the app's glass header over the page, as the chat does.
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="browser-tabs/[agentId]"
          // No header: the address bar is the sheet's first row, and the page shows above it.
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
          name="browser-help"
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
          name="channel/[channelId]"
          options={{
            animation: chatAnimation,
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
          name="marketplace-listing"
          // The header comes from the stack in `marketplace-listing/_layout.tsx`: Android draws no header
          // on a formSheet route, so Close would not show there.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            // A page to read before installing, as a shared agent: full height on iOS. On Android a
            // full-height sheet goes under the status bar and covers its header.
            sheetAllowedDetents: isAndroid ? [0.85] : [1],
            sheetInitialDetentIndex: "last",
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="section-form"
          // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
          listeners={refocusNameField}
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
          name="thread-rename"
          // The header comes from the route's `_layout.tsx`, as for the section form.
          listeners={refocusNameField}
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
          name="new-task"
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
          name="deleted-chats"
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
        {/* Full screens with a big header that the screen draws: the native bar keeps only its buttons. */}
        <Stack.Screen name="server-routines/index" options={largeTitlePage} />
        <Stack.Screen
          name="server-routines/agent-routine"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            title: t("mobile.app.route.routine"),
          }}
        />
        <Stack.Screen
          name="server-routines/channel-routine"
          options={{
            animation: pushAnimation,
            contentStyle: { backgroundColor: sheetBackground },
            headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
            headerBlurEffect: "none",
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            title: t("mobile.app.route.routine"),
          }}
        />
        <Stack.Screen name="server-tasks" options={largeTitlePage} />
        <Stack.Screen name="server-workflows/index" options={largeTitlePage} />
        <Stack.Screen name="server-workflows/workflow" options={largeTitlePage} />
        <Stack.Screen name="server-workflows/runs" options={largeTitlePage} />
        <Stack.Screen name="server-workflows/run" options={largeTitlePage} />
        <Stack.Screen
          name="workflow-editor"
          // One sheet for the editor: its pages are in the stack of `workflow-editor/_layout.tsx`.
          options={{
            contentStyle: { backgroundColor: sheetBackground },
            headerShown: false,
            scrollEdgeEffects: { top: "hidden", bottom: "soft" },
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen name="server-usage/index" options={largeTitlePage} />
        <Stack.Screen name="server-marketplace/index" options={largeTitlePage} />
        <Stack.Screen
          name="share"
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
          name="plan-limits"
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
          name="turn-thinking"
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

/**
 * On a wide window, such as iPad or the open iPhone Duo, the chat list stays in a pane beside the stack,
 * and the chats open beside it. The first-run flow keeps the whole window.
 */
function AuthenticatedSplit({ children }: PropsWithChildren) {
  const onboarding = useHomeOnboarding();
  const { t } = useText();
  return (
    <AdaptiveSplit
      enabled={!onboarding.active}
      resizeLabel={t("mobile.agent.home.chatListWidth")}
      pane={
        <ChatListPaneProvider>
          <ConnectedScreen variant="pane" />
        </ChatListPaneProvider>
      }
    >
      {children}
    </AdaptiveSplit>
  );
}

export default function AuthenticatedLayout() {
  const { session } = useMobileSession();
  const workspaceKey = session ? `${session.apiUrl}:${session.user.id}` : "signed-out";

  return (
    <MobileWorkspaceProvider key={workspaceKey}>
      <HomeOnboardingProvider>
        <OutboxProvider>
          <AgentPinTransitionProvider>
            <AppDrawerShell>
              <QueuedMessagesProvider>
                <AuthenticatedSplit>
                  <AuthenticatedStack />
                </AuthenticatedSplit>
                <MermaidRendererHost />
                <AudioWaveformHost />
              </QueuedMessagesProvider>
            </AppDrawerShell>
          </AgentPinTransitionProvider>
        </OutboxProvider>
      </HomeOnboardingProvider>
    </MobileWorkspaceProvider>
  );
}
