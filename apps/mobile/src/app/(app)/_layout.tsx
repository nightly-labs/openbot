import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, useGlobalSearchParams, useSegments } from "expo-router";
import { Stack } from "expo-router/stack";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef } from "react";
import { TextInput } from "react-native";
import { useCSSVariable } from "uniwind";
import { ChatListPaneProvider } from "@/features/agents/components/chat-list-pane-context";
import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { whenUnlocked } from "@/features/app-lock/model/app-lock";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { AudioWaveformHost } from "@/features/chat/components/audio-waveform-host";
import { MermaidRendererHost } from "@/features/chat/components/mermaid-renderer-host";
import { OutboxProvider } from "@/features/chat/context/outbox-context";
import { QueuedMessagesProvider } from "@/features/chat/context/queued-messages-context";
import { requestComposerText } from "@/features/chat/model/composer-requests";
import { setLiveActivityNavigator } from "@/features/live-activity/model/live-activity-link";
import { HomeOnboardingProvider, useHomeOnboarding } from "@/features/onboarding/context/home-onboarding-context";
import type { NotificationTarget, WorkflowTarget } from "@/features/push-notifications/push-notifications-native.types";
import { useNotificationTaps } from "@/features/push-notifications/use-notification-taps";
import type { QuickActionTarget } from "@/features/quick-actions/model/quick-action-items";
import { shareOpenBot } from "@/features/quick-actions/model/share-app";
import { setQuickActionNavigator } from "@/features/quick-actions/quick-actions-native";
import { requestHomeSearch } from "@/features/search/model/home-search-request";
import { AppDrawerShell, useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { watchAndroidShares } from "@/features/share/model/android-share-watch";
import { setShareSheetOpener } from "@/features/share/model/share-sheet-opener";
import type { ShortcutOpenTarget } from "@/features/shortcuts/model/shortcut-target";
import { setShortcutNavigator } from "@/features/shortcuts/shortcuts-native";
import {
  MobileWorkspaceProvider,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import { findChatAgent } from "@/features/workspace/model/directory-agents";
import {
  knownSideThread,
  type OutsideTarget,
  type OutsideTargetSources,
  outsideDestination,
  type SideThreadDestination,
  sideThreadDestination,
  waitTaskCapability,
} from "@/features/workspace/model/outside-target";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { AdaptiveSplit, useSplitLayout } from "@/shared/components/adaptive-split";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const NOTIFICATION_CHANNEL_WAIT_MS = 8_000;
const THREAD_LOOKUP_MS = 8_000;

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
  const pushAnimation = useReducedMotion() ? "fade" : "slide_from_right";
  const chatAnimation = useSplitLayout() ? "fade" : pushAnimation;
  const { t } = useText();
  const background = useThemeColor("background");
  const sheetBackground = String(useCSSVariable("--openbot-bg-sheet") ?? background);
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
  const chatPage = {
    animation: chatAnimation,
    contentStyle: { backgroundColor: background },
    fullScreenGestureEnabled: true,
    gestureEnabled: true,
    ...nativeBarOptions,
  } as const;
  const routinePage = {
    animation: pushAnimation,
    contentStyle: { backgroundColor: sheetBackground },
    headerStyle: { backgroundColor: isIOS ? "transparent" : sheetBackground },
    headerBlurEffect: "none",
    scrollEdgeEffects: { top: "hidden", bottom: "soft" },
    title: t("mobile.app.route.routine"),
  } as const;
  const formSheet = (sheetAllowedDetents: number[]) =>
    ({
      contentStyle: { backgroundColor: sheetBackground },
      headerShown: false,
      scrollEdgeEffects: { top: "hidden", bottom: "soft" },
      presentation: "formSheet",
      sheetAllowedDetents,
      sheetGrabberVisible: true,
    }) as const;
  const { closeDrawer } = useAppDrawer();
  const {
    agentId: openAgentId,
    serverId: openServerId,
    taskId: openTaskId,
  } = useGlobalSearchParams<{ agentId?: string; serverId?: string; taskId?: string }>();
  const shown = useRef<{ agentId: string; serverId: string | null; taskId: string | null } | null>(null);
  const screen = segments.at(-2);
  const shownServerId = typeof openServerId === "string" && openServerId ? openServerId : null;
  shown.current =
    typeof openAgentId !== "string"
      ? null
      : screen === "chat"
        ? { agentId: openAgentId, serverId: shownServerId, taskId: null }
        : screen === "task" && typeof openTaskId === "string"
          ? { agentId: openAgentId, serverId: shownServerId, taskId: openTaskId }
          : null;
  const workspace = useMobileWorkspaceReader();
  const showsAgent = useCallback(
    (agentId: string, serverId: string | null) => {
      const current = shown.current;
      if (current?.agentId !== agentId) return false;
      if (serverId === null) return true;
      const state = workspace();
      const shownServer =
        current.serverId ?? findChatAgent(state.agents, agentId, undefined, state.activeServer.id)?.serverId;
      return shownServer === undefined || shownServer === serverId;
    },
    [workspace],
  );
  const showsChat = useCallback(
    (agentId: string, serverId: string | null = null) =>
      showsAgent(agentId, serverId) && shown.current?.taskId === null,
    [showsAgent],
  );
  const showChat = useCallback(
    (agentId: string | null, serverId: string | null = null) => {
      closeDrawer();
      if (agentId !== null && showsChat(agentId, serverId)) return;
      if (router.canDismiss()) router.dismissAll();
      if (agentId === null) return;
      router.push({ pathname: "/chat/[agentId]", params: serverId ? { agentId, serverId } : { agentId } });
    },
    [closeDrawer, showsChat],
  );
  const showThread = useCallback(
    ({ serverId, agentId, taskId }: SideThreadDestination) => {
      closeDrawer();
      const current = shown.current;
      if (current && showsAgent(agentId, serverId)) {
        if (current.taskId === taskId) return;
        if (current.taskId !== null) {
          router.setParams<"/task/[taskId]">({ taskId });
          return;
        }
      } else if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId } });
    },
    [closeDrawer, showsAgent],
  );
  const openFromOutside = useCallback(
    (agentId: string | null, serverId: string | null = null) => whenUnlocked(() => showChat(agentId, serverId)),
    [showChat],
  );
  const openQuickAction = useCallback(
    (target: QuickActionTarget) => {
      if (target.type === "chat") {
        openFromOutside(target.agentId);
        return;
      }
      whenUnlocked(() => {
        if (target.type === "share") {
          shareOpenBot();
          return;
        }
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        if (target.type === "routines")
          router.push({ pathname: "/server-routines", params: { serverId: target.serverId } });
        else if (target.type === "support") router.push("/settings/support");
        else requestHomeSearch();
      });
    },
    [closeDrawer, openFromOutside],
  );
  useEffect(() => setQuickActionNavigator(openQuickAction), [openQuickAction]);
  const openShortcutTarget = useCallback(
    (target: ShortcutOpenTarget) => {
      if (target.screen === "chat") {
        if (target.draft)
          requestComposerText({ serverId: target.draft.serverId, agentId: target.agentId, text: target.draft.text });
        openFromOutside(target.agentId, target.draft?.serverId ?? null);
        return;
      }
      whenUnlocked(() => {
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        if (target.screen === "settings") router.push("/settings/shortcuts");
      });
    },
    [closeDrawer, openFromOutside],
  );
  useEffect(() => setShortcutNavigator(openShortcutTarget), [openShortcutTarget]);
  useEffect(() => setShareSheetOpener(() => whenUnlocked(() => router.push("/share"))), []);
  useEffect(() => (isAndroid ? watchAndroidShares() : undefined), []);
  const queryClient = useQueryClient();
  const scope = useQueryScope();
  const queryScope = useRef(scope);
  queryScope.current = scope;
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
        // A cold-start tap can arrive before the server answered its compatibility read: the task
        // capability is then unknown, not missing. The channel list waits for its host in the same
        // window, so the task list waits for the answer too, and gives up at once when the host is
        // offline or answered without agent tasks.
        return waitTaskCapability(
          () => workspace().canUseTasks(serverId),
          () => workspace().servers.find((item) => item.id === serverId)?.state,
          THREAD_LOOKUP_MS,
        ).then((supported) => {
          if (!supported) return [];
          // The thread screen reads the same list, so it has it when the thread opens.
          return queryClient
            .fetchQuery({
              queryKey: queryKeys.agentTasks(queryScope.current, serverId, agentId),
              queryFn: () => workspace().loadAgentTasks(agentId, serverId),
              // The list that the phone has does not have the thread, so only the host can answer.
              staleTime: 0,
            })
            .then((snapshot) => snapshot.tasks);
        });
      },
    }),
    [workspace, queryClient],
  );
  const outsideOpens = useRef(0);
  const openTarget = useCallback(
    (target: OutsideTarget | null, chatOpened = false) => {
      outsideOpens.current += 1;
      const order = outsideOpens.current;
      if (!target?.serverId || !target.threadId) {
        openFromOutside(target?.agentId ?? null, target?.serverId ?? null);
        return;
      }
      const { agentId, serverId } = target;
      void outsideDestination(target, targetSources).then((destination) => {
        if (outsideOpens.current !== order) return;
        if (chatOpened && !showsChat(agentId, serverId)) return;
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
            showChat(agentId, serverId);
          });
        void sideThreadDestination(target, targetSources, THREAD_LOOKUP_MS).then((thread) => {
          if (!thread || outsideOpens.current !== order) return;
          whenUnlocked(() => {
            if (chatShown && !showsChat(agentId, serverId)) return;
            showThread(thread);
          });
        });
      });
    },
    [targetSources, openFromOutside, showChat, showThread, showsChat, closeDrawer],
  );
  useEffect(() => setLiveActivityNavigator(openTarget), [openTarget]);
  const onScreen = useCallback(
    (target: NotificationTarget) => {
      const current = shown.current;
      if (!current || !showsAgent(target.agentId, target.serverId)) return false;
      return current.taskId === (knownSideThread(target, targetSources)?.taskId ?? null);
    },
    [targetSources, showsAgent],
  );
  const openWorkflow = useCallback(
    ({ serverId, workflowId }: WorkflowTarget) =>
      whenUnlocked(() => {
        closeDrawer();
        if (router.canDismiss()) router.dismissAll();
        router.push({ pathname: "/server-workflows/workflow", params: { serverId, workflowId } });
      }),
    [closeDrawer],
  );
  useNotificationTaps(openTarget, onScreen, openWorkflow);

  return (
    <Stack
      screenOptions={(props) => ({
        ...androidBackOptions(props, { glass: true }),
        headerBackButtonDisplayMode: "minimal",
        ...headerFontOptions,
        headerShadowVisible: false,
        headerTransparent: isIOS,
        sheetExpandsWhenScrolledToEdge: false,
        ...(isAndroid && { sheetCornerRadius: 28 }),
      })}
    >
      <Stack.Screen name="connected" options={{ animation: "fade", gestureEnabled: false, title: "" }} />
      <Stack.Screen
        name="rate-app"
        options={{
          presentation: "containedTransparentModal",
          animation: "none",
          gestureEnabled: false,
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <Stack.Screen name="chat/[agentId]" options={chatPage} />
      <Stack.Screen name="side-question/[agentId]" options={chatPage} />
      <Stack.Screen name="task/[taskId]" options={chatPage} />
      <Stack.Screen
        name="code-preview/[previewId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
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
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="browser/[agentId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
          ...nativeBarOptions,
        }}
      />
      <Stack.Screen name="browser-tabs/[agentId]" options={formSheet([0.6])} />
      <Stack.Screen
        name="remote-desktop/[serverId]"
        options={{
          animation: pushAnimation,
          contentStyle: { backgroundColor: background },
          fullScreenGestureEnabled: false,
          gestureEnabled: true,
          ...nativeBarOptions,
        }}
      />
      <Stack.Screen name="remote-desktop-stats" options={formSheet([0.6])} />
      <Stack.Screen name="remote-desktop-help" options={formSheet([0.85])} />
      <Stack.Screen name="browser-help" options={formSheet([0.85])} />
      <Stack.Screen name="channel/[channelId]" options={chatPage} />
      <Stack.Screen name="channel-info/[channelId]" options={formSheet([0.85])} />
      <Stack.Screen name="context-usage/[agentId]" options={formSheet([0.6, 0.85])} />
      <Stack.Screen name="channel-actions/[channelId]" options={formSheet([0.6])} />
      <Stack.Screen name="add-channel" options={formSheet([0.85])} />
      <Stack.Screen name="add-agent" options={formSheet([0.85])} />
      <Stack.Screen name="agent-info/[agentId]" options={formSheet([0.85])} />
      <Stack.Screen
        name="install-agent"
        options={{
          ...formSheet(isAndroid ? [0.85] : [1]),
          sheetInitialDetentIndex: "last",
        }}
      />
      <Stack.Screen
        name="marketplace-listing"
        options={{
          ...formSheet(isAndroid ? [0.85] : [1]),
          sheetInitialDetentIndex: "last",
        }}
      />
      <Stack.Screen name="section-form" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="library-folders" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="thread-rename" listeners={refocusNameField} options={formSheet([0.85])} />
      <Stack.Screen name="new-task" options={formSheet([0.85])} />
      <Stack.Screen name="add-server" options={formSheet([0.85])} />
      <Stack.Screen name="hosted-server" options={formSheet([0.85])} />
      <Stack.Screen name="hidden-chats" options={formSheet([0.85])} />
      <Stack.Screen name="deleted-chats" options={formSheet([0.85])} />
      <Stack.Screen name="server-settings" options={formSheet([0.85])} />
      <Stack.Screen name="server-routines/index" options={largeTitlePage} />
      <Stack.Screen name="server-routines/agent-routine" options={routinePage} />
      <Stack.Screen name="server-routines/channel-routine" options={routinePage} />
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
        options={{
          contentStyle: { backgroundColor: sheetBackground },
          headerShown: false,
          scrollEdgeEffects: { top: "hidden", bottom: "soft" },
          presentation: "card",
        }}
      />
      <Stack.Screen name="server-usage/index" options={largeTitlePage} />
      <Stack.Screen name="server-library" options={largeTitlePage} />
      <Stack.Screen name="server-marketplace/index" options={largeTitlePage} />
      <Stack.Screen name="share" options={formSheet([0.85])} />
      <Stack.Screen name="plan-limits" options={formSheet([0.85])} />
      <Stack.Screen name="message-actions" options={formSheet([0.6])} />
      <Stack.Screen name="pinned-messages" options={formSheet([0.6, 0.85])} />
      <Stack.Screen name="queued-messages" options={formSheet([0.85])} />
      <Stack.Screen name="vault-request" options={formSheet([0.85])} />
      <Stack.Screen name="turn-thinking" options={formSheet([0.85])} />
      <Stack.Screen name="subagent" options={formSheet([0.85])} />
      <Stack.Screen name="memory-changes" options={formSheet([0.85])} />
      <Stack.Screen name="settings" options={formSheet([0.85])} />
    </Stack>
  );
}

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
          <AppDrawerShell>
            <QueuedMessagesProvider>
              <AuthenticatedSplit>
                <AuthenticatedStack />
              </AuthenticatedSplit>
              <MermaidRendererHost />
              <AudioWaveformHost />
            </QueuedMessagesProvider>
          </AppDrawerShell>
        </OutboxProvider>
      </HomeOnboardingProvider>
    </MobileWorkspaceProvider>
  );
}
