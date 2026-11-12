import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef } from "react";
import { TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { AgentPinTransitionProvider } from "@/features/agents/components/agent-pin-transition";
import { ChatListPaneProvider } from "@/features/agents/components/chat-list-pane-context";
import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { whenUnlocked } from "@/features/app-lock/model/app-lock";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
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
import { watchAndroidShares } from "@/features/share/model/android-share-watch";
import { setShareSheetOpener } from "@/features/share/model/share-sheet-opener";
import {
  MobileWorkspaceProvider,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import {
  knownSideThread,
  type OutsideTarget,
  type OutsideTargetSources,
  outsideDestination,
  type SideThreadDestination,
  sideThreadDestination,
} from "@/features/workspace/model/outside-target";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { AdaptiveSplit, useSplitLayout } from "@/shared/components/adaptive-split";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** How long a notification tap waits for the channel list of its server before it opens the agent chat. */
const NOTIFICATION_CHANNEL_WAIT_MS = 8_000;
/** How long the agent's chat waits for the host to say that a tap named a side thread. */
const THREAD_LOOKUP_MS = 8_000;

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
  // iOS shows the native bar over a chat and the browser, so its bar items morph with the items of the
  // screen under it. The screen fills the bar with Back, the title and the buttons. Android draws them.
  const nativeBarOptions = {
    headerShown: isIOS,
    headerBackVisible: false,
    scrollEdgeEffects: { top: "hidden" },
    title: "",
  } as const;
  const largeTitlePage = {
    animation: pushAnimation,
    contentStyle: { backgroundColor: sheetBackground },
    headerTransparent: true,
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    title: "",
  } as const;
  const { closeDrawer } = useAppDrawer();
  const { agentId: openAgentId, taskId: openTaskId } = useGlobalSearchParams<{ agentId?: string; taskId?: string }>();
  /** The chat or the side thread on the screen. `taskId` is null for an agent's own chat. */
  const shown = useRef<{ agentId: string; taskId: string | null } | null>(null);
  const screen = segments.at(-2);
  shown.current =
    typeof openAgentId !== "string"
      ? null
      : screen === "chat"
        ? { agentId: openAgentId, taskId: null }
        : screen === "task" && typeof openTaskId === "string"
          ? { agentId: openAgentId, taskId: openTaskId }
          : null;
  const showsChat = useCallback(
    (agentId: string) => shown.current?.agentId === agentId && shown.current.taskId === null,
    [],
  );
  /** Shows a chat, or the chat list for `null`. */
  const showChat = useCallback(
    (agentId: string | null) => {
      closeDrawer();
      // Opening the chat that shows already would mount it again and load it again.
      if (agentId !== null && showsChat(agentId)) return;
      // The chat opens on top of the main screen, so Back returns there and not to an earlier chat.
      if (router.canDismiss()) router.dismissAll();
      if (agentId === null) return;
      // The native stack runs the push after the dismissal ends.
      router.push({ pathname: "/chat/[agentId]", params: { agentId } });
    },
    [closeDrawer, showsChat],
  );
  /**
   * Shows a side thread of an agent. On the agent's chat it opens on top of the chat, and on another
   * thread of the agent it takes the place of that thread, both as from the thread menu. Else it opens
   * on the main screen.
   */
  const showThread = useCallback(
    ({ serverId, agentId, taskId }: SideThreadDestination) => {
      closeDrawer();
      const current = shown.current;
      if (current?.agentId === agentId) {
        // Opening the thread that shows already would mount it again and load it again.
        if (current.taskId === taskId) return;
        if (current.taskId !== null) {
          router.setParams<"/task/[taskId]">({ taskId });
          return;
        }
      } else if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId } });
    },
    [closeDrawer],
  );
  /** Opens a chat, or the chat list for `null`, from outside the app. */
  const openFromOutside = useCallback(
    (agentId: string | null) =>
      // A locked app opens the chat after the user unlocks it.
      whenUnlocked(() => showChat(agentId)),
    [showChat],
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
        if (target.type === "routines")
          router.push({ pathname: "/server-routines", params: { serverId: target.serverId } });
        else requestHomeSearch();
      });
    },
    [closeDrawer, openFromOutside],
  );
  useEffect(() => setQuickActionNavigator(openQuickAction), [openQuickAction]);
  useEffect(() => setShareSheetOpener(() => whenUnlocked(() => router.push("/share"))), []);
  // Android can give a share without a route change, so the stack looks for one itself.
  useEffect(() => (isAndroid ? watchAndroidShares() : undefined), []);
  const workspace = useMobileWorkspaceReader();
  const queryClient = useQueryClient();
  // The scope is a new list at each render. The sources read the latest one.
  const scope = useQueryScope();
  const queryScope = useRef(scope);
  queryScope.current = scope;
  /** What the phone knows, and can ask the host, about the thread of a notification or a Live Activity. */
  const targetSources = useMemo(
    (): OutsideTargetSources => ({
      channels: (serverId) =>
        workspace()
          .channelStore.whenListed(serverId, NOTIFICATION_CHANNEL_WAIT_MS)
          .then((state) => state.channels),
      knownThreads: (serverId, agentId) =>
        queryClient.getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(queryScope.current, serverId, agentId))
          ?.tasks,
      loadThreads: (serverId, agentId) => {
        // A host without side threads has none, and its agents have no thread list to read.
        if (!workspace().canUseTasks(serverId)) return Promise.resolve([]);
        // The thread screen reads the same list, so it has it when the thread opens.
        return queryClient
          .fetchQuery({
            queryKey: queryKeys.agentTasks(queryScope.current, serverId, agentId),
            queryFn: () => workspace().loadAgentTasks(agentId, serverId),
            // The list that the phone has does not have the thread, so only the host can answer.
            staleTime: 0,
          })
          .then((snapshot) => snapshot.tasks);
      },
    }),
    [workspace, queryClient],
  );
  /** The last conversation opened from outside. An earlier one that still waits opens nothing. */
  const outsideOpens = useRef(0);
  /**
   * Opens the conversation of a notification or of a Live Activity, or the chat list for `null`. A
   * prompt, an approval or a takeover on a channel thread opens the channel, as on desktop. An event
   * of a side thread of an agent opens that thread. Each other event opens the agent's own chat. A tap
   * at a cold start comes before the server connects, so it waits a short time for the channel list.
   *
   * The phone does not know the thread of an agent's own chat. So a thread that it has not read opens
   * the agent's chat at once, and the thread then opens on that chat when the host says that it is a
   * side thread.
   *
   * `chatOpened` is true for a link that started the app: its route opened the agent's chat. The
   * person can leave that chat while the lists load, and nothing then takes them back.
   */
  const openTarget = useCallback(
    (target: OutsideTarget | null, chatOpened = false) => {
      outsideOpens.current += 1;
      const order = outsideOpens.current;
      if (!target?.serverId || !target.threadId) {
        openFromOutside(target?.agentId ?? null);
        return;
      }
      const { agentId } = target;
      void outsideDestination(target, targetSources).then((destination) => {
        if (outsideOpens.current !== order) return;
        if (chatOpened && !showsChat(agentId)) return;
        if (destination.type === "channel") {
          const { channelId, serverId } = destination;
          whenUnlocked(() => {
            closeDrawer();
            if (router.canDismiss()) router.dismissAll();
            router.push({ pathname: "/channel/[channelId]", params: { channelId, serverId } });
          });
          return;
        }
        if (destination.type === "thread") {
          const known = destination;
          whenUnlocked(() => showThread(known));
          return;
        }
        let chatShown = chatOpened;
        if (!chatOpened)
          whenUnlocked(() => {
            chatShown = true;
            showChat(agentId);
          });
        void sideThreadDestination(target, targetSources, THREAD_LOOKUP_MS).then((thread) => {
          if (!thread || outsideOpens.current !== order) return;
          // A locked app holds one action only: the thread then opens in place of the chat.
          whenUnlocked(() => {
            // The person left the chat while the host answered. The thread does not take them away.
            if (chatShown && !showsChat(agentId)) return;
            showThread(thread);
          });
        });
      });
    },
    [targetSources, openFromOutside, showChat, showThread, showsChat, closeDrawer],
  );
  useEffect(() => setLiveActivityNavigator(openTarget), [openTarget]);
  /** A notification of the chat or the thread on the screen is not shown again. */
  const onScreen = useCallback(
    (target: NotificationTarget) => {
      const current = shown.current;
      if (!current || current.agentId !== target.agentId) return false;
      // A thread that the phone has not read counts as the agent's own chat.
      return current.taskId === (knownSideThread(target, targetSources)?.taskId ?? null);
    },
    [targetSources],
  );
  useNotificationTaps(openTarget, onScreen);

  return (
    <Stack
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
          // A swipe to the right anywhere in the chat goes back. A message bubble keeps its swipe to
          // reply: react-native-screens is patched so that the back swipe waits for it.
          fullScreenGestureEnabled: true,
          gestureEnabled: true,
          ...nativeBarOptions,
        }}
      />
      <Stack.Screen
        name="task/[taskId]"
        // A task is a chat of its own, so it opens as the agent's chat does.
        options={{
          animation: chatAnimation,
          contentStyle: { backgroundColor: background },
          // A swipe to the right anywhere in the chat goes back. A message bubble keeps its swipe to
          // reply: react-native-screens is patched so that the back swipe waits for it.
          fullScreenGestureEnabled: true,
          gestureEnabled: true,
          ...nativeBarOptions,
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
        name="image-gallery/[galleryId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: true,
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
          ...nativeBarOptions,
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
        name="remote-desktop/[serverId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          // Every finger on the screen is the computer's pointer, so only the screen edge goes back.
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
          ...nativeBarOptions,
        }}
      />
      <Stack.Screen
        name="remote-desktop-stats"
        // Lower than a form, so the stream that the stats describe stays in view above it.
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
        name="remote-desktop-help"
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
          // A swipe to the right anywhere in the chat goes back. A message bubble keeps its swipe to
          // reply: react-native-screens is patched so that the back swipe waits for it.
          fullScreenGestureEnabled: true,
          gestureEnabled: true,
          ...nativeBarOptions,
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
      <Stack.Screen name="server-workflows/versions" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/version" options={largeTitlePage} />
      <Stack.Screen name="server-workflows/github-events" options={largeTitlePage} />
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
      <Stack.Screen name="server-library" options={largeTitlePage} />
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
        name="message-actions"
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
        name="pinned-messages"
        // The header comes from the route's `_layout.tsx`: Android draws no header on a formSheet route.
        options={{
          contentStyle: { backgroundColor: sheetBackground },
          headerShown: false,
          scrollEdgeEffects: { top: "hidden", bottom: "soft" },
          presentation: "formSheet",
          sheetAllowedDetents: [0.6, 0.85],
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
        name="vault-request"
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
