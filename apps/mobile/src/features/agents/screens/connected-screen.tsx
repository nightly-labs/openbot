import type { ChannelSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { GlassView } from "expo-glass-effect";
import { type Href, router, Stack, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import Layers3 from "lucide-react-native/icons/layers";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import PanelLeft from "lucide-react-native/icons/panel-left";
import WifiOff from "lucide-react-native/icons/wifi-off";
import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type FlatList, Pressable, StyleSheet, View, type ViewInstance, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { CROWD_TOP } from "@/features/agents/components/agent-crowd";
import {
  type AgentListRevealState,
  AgentListRowReveal,
  useAgentListReveal,
} from "@/features/agents/components/agent-list-reveal";
import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { chatRowSlideIn, chatRowSlideOut, usePinMotion } from "@/features/agents/components/agent-pin-motion";
import { AgentUnreadGroupHeader, AgentWaitingGroupHeader } from "@/features/agents/components/agent-wait-badge";
import {
  ChatDragProvider,
  type ChatDragScreen,
  sectionDragKey,
  useChatDropTarget,
} from "@/features/agents/components/chat-drag";
import { ChatListRail } from "@/features/agents/components/chat-list-rail";
import { EmptyAgentsScene, type WelcomeHandOff } from "@/features/agents/components/empty-agents-scene";
import {
  HOME_CARD_RADIUS,
  HomeCardBackdrop,
  HomeCardRow,
  HomeCardTop,
  useHomeCard,
} from "@/features/agents/components/home-backdrop-card";
import { PinnedAgentsGrid } from "@/features/agents/components/pinned-agents-grid";
import { SidebarSectionHeader } from "@/features/agents/components/sidebar-section-header";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  AppUpdateBlock,
  AppUpdateSpacer,
  useAppUpdateHeader,
} from "@/features/app-update/components/app-update-header";
import {
  OtaUpdateBlock,
  OtaUpdateSpacer,
  useOtaUpdateBanner,
} from "@/features/app-update/components/ota-update-banner";
import { useAppUpdate } from "@/features/app-update/model/app-update";
import { ChannelListRow } from "@/features/channels/components/channel-list";
import { useChannels } from "@/features/channels/components/use-channels";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { useHomeOnboarding } from "@/features/onboarding/context/home-onboarding-context";
import { useRatingAskGate } from "@/features/rating-ask/model/use-rating-ask-gate";
import {
  HOME_SEARCH_HEIGHT,
  HomeSearchBar,
  HomeSearchList,
  HomeSearchResults,
  useHomeSearch,
} from "@/features/search/components/home-search";
import { setHomeSearchUnavailable } from "@/features/search/model/home-search-request";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { PlanLimitsHeaderButton } from "@/features/servers/components/plan-limits-header-button";
import { usePlanLimits } from "@/features/servers/model/plan-limits";
import { saveChatOrderPreference, useChatOrderPreference } from "@/features/settings/model/chat-order";
import { ConnectionHeaderStatus } from "@/features/workspace/components/connection-header-status";
import { useWaitingAgentIds } from "@/features/workspace/components/use-agent-activity";
import { useHomeThreadState } from "@/features/workspace/components/use-home-thread-state";
import { useUnreadAgentIds, useUnreadCounts } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  type MobileWorkspaceActions,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canAddChatPin } from "@/features/workspace/model/agent-pins";
import type { DropChange } from "@/features/workspace/model/chat-drag";
import { showsOnline } from "@/features/workspace/model/server-status";
import {
  MOBILE_CHAT_ORDERS,
  type MobileChatOrder,
  type MobileSidebarItem,
  mobileChatOrderSortsSections,
  mobileSidebarItems,
  mobileUnreadItems,
  mobileWaitingItems,
} from "@/features/workspace/model/sidebar-layout";
import { SplitPaneLayers, useSplitLayout } from "@/shared/components/adaptive-split";
import { AndroidBlurTarget } from "@/shared/components/android-header-blur";
import { useAppLoadingOverlay, useScreenLoadingLabel } from "@/shared/components/app-loading-overlay";
import { LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { BAR_BUTTON_SIZE, NATIVE_BAR_HEIGHT, useBarTop } from "@/shared/lib/native-bar";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ONBOARDING_EXIT = FadeOut.duration(220).easing(EASE_OUT);
const LIST_REFLOW = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const CARD_MOVE = { duration: 240, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
const LIST_WINDOW_SIZE = 3;
const LIST_DRAG_WINDOW_SIZE = 21;
const LIST_BATCH = 10;

interface ChatRowTarget {
  agent?: MobileAgent;
  channel?: ChannelSummary;
  serverId?: string;
  channelAgents?: ReadonlyMap<string, MobileAgent>;
}

function CollapsingRow({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const [initiallyExpanded] = useState(!collapsed);
  const [contentMounted, setContentMounted] = useState(!collapsed);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [settled, setSettled] = useState(!collapsed);
  const height = useSharedValue(0);
  useLayoutEffect(() => {
    if (!collapsed) setContentMounted(true);
    else setSettled(false);
    if (measuredHeight === null) return;
    let active = true;
    const releaseContent = () => {
      if (active) setContentMounted(false);
    };
    const settle = () => {
      if (active) setSettled(true);
    };
    height.set(
      withTiming(
        collapsed ? 0 : measuredHeight,
        {
          duration: 240,
          easing: EASE_OUT,
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (!finished) return;
          scheduleOnRN(collapsed ? releaseContent : settle);
        },
      ),
    );
    return () => {
      active = false;
      cancelAnimation(height);
    };
  }, [collapsed, height, measuredHeight]);
  const bodyStyle = useAnimatedStyle(() => ({
    height: measuredHeight === null && initiallyExpanded ? undefined : height.get(),
    overflow: "hidden",
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity:
      measuredHeight !== null && measuredHeight > 0
        ? Math.min(1, Math.max(0, height.get() / measuredHeight))
        : initiallyExpanded
          ? 1
          : 0,
  }));

  const resting = !collapsed && (settled || (measuredHeight === null && initiallyExpanded));

  return (
    <Animated.View
      style={resting ? undefined : bodyStyle}
      pointerEvents={collapsed ? "none" : "auto"}
      accessibilityElementsHidden={collapsed}
      importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
    >
      {contentMounted ? (
        <Animated.View
          style={resting ? undefined : [{ position: "absolute", top: 0, left: 0, right: 0 }, contentStyle]}
          onLayout={({ nativeEvent }) => {
            const nextHeight = nativeEvent.layout.height;
            if (resting) height.set(nextHeight);
            setMeasuredHeight(nextHeight);
          }}
        >
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const TransitioningChatRow = memo(function TransitioningChatRow({
  agent,
  channel,
  serverId,
  channelAgents,
  index,
  reveal,
  collapsed,
}: ChatRowTarget & {
  index: number;
  reveal: AgentListRevealState;
  collapsed: boolean;
}) {
  const motion = usePinMotion(agent?.id ?? channel?.id ?? "");
  return (
    <CollapsingRow collapsed={collapsed}>
      <Animated.View
        collapsable={false}
        entering={motion === "unpin" ? chatRowSlideIn : undefined}
        exiting={motion === "pin" ? chatRowSlideOut : undefined}
      >
        <AgentListRowReveal index={index} reveal={reveal} skip={motion === "unpin"}>
          {agent ? (
            <AgentListRow agent={agent} leftInset={15} rightInset={24} />
          ) : channel && serverId && channelAgents ? (
            <ChannelListRow
              channel={channel}
              serverId={serverId}
              agents={channelAgents}
              leftInset={15}
              rightInset={24}
            />
          ) : null}
        </AgentListRowReveal>
      </Animated.View>
    </CollapsingRow>
  );
});

function SectionDropTarget({ sectionId, children }: { sectionId: string; children: ReactNode }) {
  const ref = useChatDropTarget(sectionDragKey(sectionId));
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  );
}

function applyChatDrop(workspace: MobileWorkspaceActions, serverId: string, change: DropChange) {
  if (change.pins && !workspace.setChatPins(serverId, change.pins)) return;
  if (!change.move) return;
  workspace.moveSidebarChat(serverId, change.move).catch((error: unknown) => {
    void haptics.notification("error");
    const text = currentText();
    showFailureAlert(
      error,
      "turn",
      text.t("mobile.agent.section.moveFailed"),
      text.errorMessage(error, text.t("mobile.agent.section.tryAgain")),
    );
  });
}

const CHAT_ORDER_LABEL = {
  manual: "mobile.agent.home.sort.manual",
  recent: "mobile.agent.home.sort.recent",
  "unread-group": "mobile.agent.home.sort.unreadGroup",
  "unread-first": "mobile.agent.home.sort.unreadFirst",
} as const satisfies Record<MobileChatOrder, MobileTextKey>;

function changeChatOrder(order: MobileChatOrder): void {
  if (order === useChatOrderPreference.getState().order) return;
  void haptics.selection();
  void saveChatOrderPreference(order).catch(() => undefined);
}

const NO_CHAT_IDS: ReadonlySet<string> = new Set();

function listItemKey(item: MobileSidebarItem) {
  return `${item.kind}:${item.id}`;
}

const HEADER_RIPPLE = { borderless: true, radius: 20 } as const;
const PANE_BAR_HEIGHT = NATIVE_BAR_HEIGHT;

function HeaderGlass({
  glass,
  capsule = false,
  children,
}: {
  glass: ViewStyle;
  capsule?: boolean;
  children: ReactNode;
}) {
  const liquidGlass = useLiquidGlass();
  if (isAndroid) {
    return (
      <View className="size-10 items-center justify-center overflow-hidden rounded-full" style={glass}>
        {children}
      </View>
    );
  }
  return (
    <GlassView
      glassEffectStyle={liquidGlass ? "regular" : "none"}
      style={{
        alignItems: "center",
        backgroundColor: liquidGlass ? "transparent" : glass.backgroundColor,
        borderCurve: "continuous",
        borderRadius: BAR_BUTTON_SIZE / 2,
        height: BAR_BUTTON_SIZE,
        justifyContent: "center",
        minWidth: BAR_BUTTON_SIZE,
        overflow: "hidden",
        paddingHorizontal: capsule ? 4 : 0,
      }}
    >
      {children}
    </GlassView>
  );
}

function HeaderIconButton({
  accessibilityLabel,
  glass,
  children,
  onPress,
}: {
  accessibilityLabel: string;
  glass: ViewStyle;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={HEADER_RIPPLE}
      className="size-12 items-center justify-center rounded-full"
      style={({ pressed }) => (isIOS && pressed ? { opacity: 0.6 } : undefined)}
      onPress={onPress}
    >
      <HeaderGlass glass={glass}>{children}</HeaderGlass>
    </Pressable>
  );
}

function openFromMenu(href: Href): void {
  void haptics.impact("soft");
  router.push(href);
}

export function ConnectedScreen({ variant = "screen" }: { variant?: "screen" | "pane" }) {
  const pane = variant === "pane";
  const { t, sourceText } = useText();
  const { isLoaderPresent } = useAppLoadingOverlay();
  const { openDrawer } = useAppDrawer();
  const workspace = useMobileWorkspaceReader();
  const sidebarByServer = useMobileWorkspaceSelector((current) => current.sidebarByServer);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const activeAgents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const activeServer = useMobileWorkspaceSelector((current) => current.activeServer);
  const hiddenAgents = useMobileWorkspaceSelector((current) => current.hiddenAgents);
  const markAllRead = useMobileWorkspaceSelector((current) => current.markAllRead);
  const pinnedAgentIds = useMobileWorkspaceSelector((current) => current.pinnedAgentIds);
  const pinnedChannelIds = useMobileWorkspaceSelector((current) => current.pinnedChannelIds);
  const hiddenChannelIds = useMobileWorkspaceSelector((current) => current.hiddenChannelIds);
  const serverDirectoryError = useMobileWorkspaceSelector((current) => current.serverDirectoryError);
  const serverDirectoryState = useMobileWorkspaceSelector((current) => current.serverDirectoryState);
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  const collapsedSectionIds = useMobileWorkspaceSelector((current) => current.collapsedSectionIds);
  const channels = useChannels(activeServer.id);
  const channelAgents = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === activeServer.id).map((agent) => [agent.id, agent])),
    [agents, activeServer.id],
  );
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const buttonGlass = useChromeGlass({ shadow: isIOS });
  const barBlurTarget = useRef<ViewInstance>(null);
  const iconColor = String(foreground);
  const mutedColor = String(muted);
  const hasSelectedServer = servers.some((server) => server.id === activeServer.id);
  const planLimits = usePlanLimits(activeServer.id);
  const showsPlanLimits = hasSelectedServer && planLimits.rows.length > 0;
  const showLoader =
    (serverDirectoryState === "loading" && servers.length === 0) ||
    (hasSelectedServer && activeServer.initialConnectionPending && channelAgents.size === 0);
  const chatOrderReady = useChatOrderPreference((state) => state.ready);
  const listReady = !showLoader && !isLoaderPresent && chatOrderReady;
  const onboarding = useHomeOnboarding();
  const onboardingReady = onboarding.active && !isLoaderPresent;
  const [welcomeHandOff, setWelcomeHandOff] = useState<WelcomeHandOff | null>(null);
  useEffect(() => {
    if (welcomeHandOff) setWelcomeHandOff(null);
  }, [welcomeHandOff]);
  const headerActions = listReady && !onboarding.active;
  useScreenLoadingLabel(
    "/connected",
    showLoader && !onboarding.active
      ? t(hasSelectedServer ? "mobile.agent.home.connecting" : "mobile.agent.home.loadingServers")
      : null,
  );
  const pinnedAgents = useMemo(() => {
    const byId = new Map(activeAgents.map((agent) => [agent.id, agent]));
    return pinnedAgentIds.flatMap((agentId) => byId.get(agentId) ?? []);
  }, [activeAgents, pinnedAgentIds]);
  const openChannels = useMemo(
    () => channels.channels.filter((channel) => !channel.archived && !hiddenChannelIds.includes(channel.id)),
    [channels.channels, hiddenChannelIds],
  );
  const pinnedChannels = useMemo(() => {
    const byId = new Map(openChannels.map((channel) => [channel.id, channel]));
    return pinnedChannelIds.flatMap((channelId) => byId.get(channelId) ?? []);
  }, [openChannels, pinnedChannelIds]);
  const hasHiddenChats =
    hiddenAgents.length > 0 ||
    channels.channels.some((channel) => !channel.archived && hiddenChannelIds.includes(channel.id));
  const hasPins = pinnedAgents.length + pinnedChannels.length > 0;
  const hasDeletedChannels = channels.supported && channels.channels.some((channel) => channel.archived);
  const unreadAgentIds = useUnreadAgentIds();
  const hasUnread = useMemo(() => {
    const unread = new Set(unreadAgentIds);
    return (
      channels.channels.some((channel) => channel.unreadCount > 0) ||
      agents.some((agent) => agent.serverId === activeServer.id && unread.has(agent.id))
    );
  }, [agents, activeServer.id, unreadAgentIds, channels.channels]);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const activeServerOnline = showsOnline(activeServer);
  const canMarkAllRead = hasUnread && !markingAllRead && activeServerOnline;
  const markAllChatsRead = () => {
    if (!canMarkAllRead) return;
    void haptics.impact("soft");
    setMarkingAllRead(true);
    void markAllRead()
      .catch((error: unknown) =>
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.markAllReadTitle"),
          currentText().t("mobile.workspace.alert.markAllReadBody"),
        ),
      )
      .finally(() => setMarkingAllRead(false));
  };
  const unpinnedAgents = useMemo(() => {
    const pinned = new Set(pinnedAgentIds);
    return activeAgents.filter((agent) => !pinned.has(agent.id));
  }, [activeAgents, pinnedAgentIds]);
  const sidebar = sidebarByServer[activeServer.id];
  const waitingAgentIds = useWaitingAgentIds();
  const chatOrder = useChatOrderPreference((state) => state.order);
  const unreadChatIds = useMemo(
    () =>
      chatOrder === "manual" || chatOrder === "recent"
        ? NO_CHAT_IDS
        : new Set<string>([
            ...unreadAgentIds,
            ...openChannels.filter((channel) => channel.unreadCount > 0).map((channel) => channel.id),
          ]),
    [chatOrder, unreadAgentIds, openChannels],
  );
  const [dragging, setDragging] = useState(false);
  const heldItems = useRef<MobileSidebarItem[] | null>(null);
  const items = useMemo(() => {
    if (dragging && chatOrder !== "manual" && heldItems.current) return heldItems.current;
    const layout = sidebar?.layout ?? null;
    const listedAgents = unpinnedAgents.filter((agent) => !waitingAgentIds.has(agent.id));
    const listedChannels = openChannels.filter((channel) => !pinnedChannelIds.includes(channel.id));
    const unread = unreadChatIds;
    const grouped = chatOrder === "unread-group";
    const next = [
      ...mobileWaitingItems(
        layout,
        unpinnedAgents.filter((agent) => waitingAgentIds.has(agent.id)),
      ),
      ...(grouped
        ? mobileUnreadItems(
            layout,
            listedAgents.filter((agent) => unread.has(agent.id)),
            listedChannels.filter((channel) => unread.has(channel.id)),
          )
        : []),
      ...mobileSidebarItems(layout, listedAgents, listedChannels, undefined, t, {
        recent: chatOrder === "recent",
        unreadFirst: chatOrder === "unread-first" ? unread : null,
        aside: grouped ? unread : null,
      }),
    ];
    heldItems.current = next;
    return next;
  }, [
    sidebar?.layout,
    unpinnedAgents,
    waitingAgentIds,
    openChannels,
    pinnedChannelIds,
    chatOrder,
    unreadChatIds,
    dragging,
    t,
  ]);
  const visibleSectionIds = useMemo(
    () => items.filter((item) => item.kind === "section").map((item) => item.id),
    [items],
  );
  const insets = useSafeAreaInsets();
  const barTop = useBarTop();
  const focused = useIsFocused();
  const homeCard = useHomeCard();
  const cardBackground = String(useThemeColor("background"));
  const [stageHeight, setStageHeight] = useState(0);
  const cardEdge = useSharedValue(-1);
  const cardServer = useSharedValue("");
  const scroll = useLargeTitleScroll(pane ? { headerHeight: barTop + PANE_BAR_HEIGHT } : undefined);
  const { headerHeight } = scroll;
  const search = useHomeSearch();
  const searchBarOffset = Math.max(0, headerHeight - insets.top);
  const listServerId = activeServer.id;
  useEffect(() => {
    if (listServerId) scroll.scrolled.set(0);
  }, [listServerId, scroll.scrolled]);
  const showAgentsScene =
    hasSelectedServer &&
    activeServerOnline &&
    activeAgents.length === 0 &&
    items.length === 0 &&
    !hasPins &&
    !sidebar?.error;
  const addAgent = () => {
    void haptics.impact("soft");
    router.push("/add-agent");
  };
  const sceneShows = listReady && showAgentsScene;
  const searchShows = listReady && hasSelectedServer && !onboarding.active && !sceneShows;
  const appUpdate = useAppUpdate();
  const updateHeader = useAppUpdateHeader(searchShows && appUpdate?.kind === "store" ? appUpdate : null);
  const otaBanner = useOtaUpdateBanner(searchShows && appUpdate?.kind === "ready" ? appUpdate : null);
  useRatingAskGate(!pane && searchShows && !search.open && !updateHeader.shown && !otaBanner.update);
  const { open: searchOpen, closeSearch } = search;
  useEffect(() => {
    if (!searchShows && searchOpen) closeSearch();
  }, [searchShows, searchOpen, closeSearch]);
  const updateExpanded = updateHeader.expanded;
  useEffect(() => {
    setHomeSearchUnavailable(listReady && (!searchShows || updateExpanded));
    return () => setHomeSearchUnavailable(false);
  }, [listReady, searchShows, updateExpanded]);
  const finishGate = onboarding.finish;
  const finishOnboarding = useCallback(
    (welcome?: WelcomeHandOff) => {
      setWelcomeHandOff(welcome ?? null);
      finishGate();
    },
    [finishGate],
  );
  const listReveal = useAgentListReveal(listReady, activeServer.id);
  const cardMotionOff = listReveal.reducedMotion;
  const layoutStage = useCallback(
    (height: number) => {
      const edge = height - HOME_CARD_RADIUS;
      const serverId = activeServer.id;
      if (cardServer.get() === serverId || cardEdge.get() < 0 || cardMotionOff) {
        cancelAnimation(cardEdge);
        cardEdge.set(edge);
        cardServer.set(serverId);
        setStageHeight(height);
        return;
      }
      setStageHeight((current) => Math.max(current, height));
      cardEdge.set(
        withTiming(edge, CARD_MOVE, (finished) => {
          if (!finished) return;
          cardServer.set(serverId);
          scheduleOnRN(setStageHeight, height);
        }),
      );
    },
    [activeServer.id, cardEdge, cardMotionOff, cardServer],
  );
  const [collapseLayout, setCollapseLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const collapsedRowIds = useMemo(() => {
    const ids = new Set<string>();
    let sectionCollapsed = false;
    for (const item of items) {
      if (item.kind === "waiting" || item.kind === "unread") sectionCollapsed = false;
      else if (item.kind === "section") {
        const hidden = item.ancestorIds.some((ancestorId) => collapsedSectionIds.has(ancestorId));
        if (hidden) ids.add(item.id);
        sectionCollapsed = hidden || collapsedSectionIds.has(item.id);
      } else if (sectionCollapsed) ids.add(item.id);
    }
    return ids;
  }, [items, collapsedSectionIds]);
  const unreadCounts = useUnreadCounts();
  const activeAgentIds = useMemo(() => activeAgents.map((agent) => agent.id), [activeAgents]);
  useHomeThreadState(activeServer.id, activeAgentIds);
  const folderUnreadKey = useMemo(() => {
    if (!collapsedSectionIds.size) return "[]";
    const unread = new Set(unreadAgentIds);
    const counts = new Map<string, number>();
    let folderIds: readonly string[] = [];
    for (const item of items) {
      if (item.kind === "waiting" || item.kind === "unread") folderIds = [];
      else if (item.kind === "section")
        folderIds = [...item.ancestorIds, item.id].filter((id) => collapsedSectionIds.has(id));
      else {
        const count =
          item.kind === "channel"
            ? item.channel.unreadCount
            : unread.has(item.id)
              ? Math.max(1, unreadCounts[item.id] ?? 1)
              : 0;
        if (count > 0) for (const folderId of folderIds) counts.set(folderId, (counts.get(folderId) ?? 0) + count);
      }
    }
    return JSON.stringify([...counts]);
  }, [items, collapsedSectionIds, unreadAgentIds, unreadCounts]);
  const folderUnread = useMemo(() => new Map<string, number>(JSON.parse(folderUnreadKey)), [folderUnreadKey]);
  const sidebarLayout = sidebar?.layout ?? null;
  const serverId = activeServer.id;
  const toggleSection = useCallback(
    (sectionId: string) => {
      setCollapseLayout(sidebarLayout);
      workspace().toggleSectionCollapsed(serverId, sectionId, sidebarLayout?.order ?? []);
    },
    [serverId, sidebarLayout, workspace],
  );
  const rowOffset = hasPins ? 1 + pinnedAgents.length + pinnedChannels.length : 0;
  const renderRow = useCallback(
    ({ item, index }: { item: MobileSidebarItem; index: number }) =>
      item.kind === "waiting" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <AgentWaitingGroupHeader count={item.count} />
        </AgentListRowReveal>
      ) : item.kind === "unread" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <AgentUnreadGroupHeader count={item.count} />
        </AgentListRowReveal>
      ) : item.kind === "section" ? (
        <CollapsingRow collapsed={collapsedRowIds.has(item.id)}>
          <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
            <SectionDropTarget sectionId={item.id}>
              <SidebarSectionHeader
                key={`${activeServer.id}:${item.id}`}
                id={item.id}
                name={item.name}
                title={item.title}
                parentName={item.parentName}
                custom={item.custom}
                empty={item.empty}
                unread={folderUnread.get(item.id) ?? 0}
                visibleSectionIds={visibleSectionIds}
                collapsed={collapsedSectionIds.has(item.id)}
                first={index === 0}
                onToggle={toggleSection}
              />
            </SectionDropTarget>
          </AgentListRowReveal>
        </CollapsingRow>
      ) : item.kind === "channel" ? (
        <TransitioningChatRow
          channel={item.channel}
          serverId={activeServer.id}
          channelAgents={channelAgents}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedRowIds.has(item.id)}
        />
      ) : (
        <TransitioningChatRow
          agent={item.agent}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedRowIds.has(item.id)}
        />
      ),
    [
      activeServer.id,
      channelAgents,
      collapsedRowIds,
      collapsedSectionIds,
      folderUnread,
      listReveal,
      rowOffset,
      toggleSection,
      visibleSectionIds,
    ],
  );
  const renderItem = useCallback(
    (info: { item: MobileSidebarItem; index: number }) => (
      <HomeCardRow
        card={homeCard}
        background={cardBackground}
        serverId={serverId}
        cardServer={cardServer}
        settled={listReveal.finished}
      >
        {renderRow(info)}
      </HomeCardRow>
    ),
    [renderRow, homeCard, cardBackground, serverId, cardServer, listReveal.finished],
  );
  const listRef = useRef<FlatList>(null);
  const dragScroll = useRef({ offset: 0, content: 0, viewport: 0 });
  const scrollRest = scroll.ownsInset ? 0 : -headerHeight;
  const pinCount = pinnedAgentIds.length + pinnedChannelIds.length;
  const editableLayout = activeServerOnline ? sidebarLayout : null;
  const dragScreen = useMemo<ChatDragScreen>(
    () => ({
      items,
      pins: [
        ...pinnedAgents.map((agent) => ({ kind: "agent" as const, id: agent.id })),
        ...pinnedChannels.map((channel) => ({ kind: "channel" as const, id: channel.id })),
      ],
      collapsedSectionIds,
      drops: editableLayout === null ? "none" : mobileChatOrderSortsSections(chatOrder) ? "folders" : "positions",
      canPin: canAddChatPin(pinCount),
      scrollInsets: { top: headerHeight, bottom: insets.bottom + HOME_SEARCH_HEIGHT },
      beginScroll: () => {
        dragScroll.current.offset = scroll.scrolled.get() + scrollRest;
      },
      scrollBy: (delta) => {
        const state = dragScroll.current;
        const end = Math.max(scrollRest, state.content - state.viewport + (scroll.ownsInset ? 0 : insets.bottom));
        const offset = Math.min(end, Math.max(scrollRest, state.offset + delta));
        if (Math.abs(offset - state.offset) < 0.5) return false;
        state.offset = offset;
        listRef.current?.scrollToOffset({ offset, animated: false });
        return true;
      },
      onDraggingChange: setDragging,
      onDrop: (_dragged, _target, change) => applyChatDrop(workspace(), serverId, change),
      readPins: () => workspace().readChatPins(serverId),
      layout: () => editableLayout,
    }),
    [
      items,
      pinnedAgents,
      pinnedChannels,
      collapsedSectionIds,
      editableLayout,
      chatOrder,
      pinCount,
      headerHeight,
      insets.bottom,
      scroll.scrolled,
      scroll.ownsInset,
      scrollRest,
      serverId,
      workspace,
    ],
  );
  const optionsActions = useMemo<MenuAction[]>(() => {
    const chatActions: MenuAction[] = [
      ...(hasSelectedServer
        ? [
            {
              id: "sort",
              title: t("mobile.agent.home.sort.title"),
              subactions: MOBILE_CHAT_ORDERS.map(
                (order): MenuAction => ({
                  id: `sort:${order}`,
                  title: t(CHAT_ORDER_LABEL[order]),
                  state: order === chatOrder ? "on" : "off",
                }),
              ),
            } satisfies MenuAction,
            {
              id: "mark-all-read",
              title: t("mobile.agent.home.markAllRead"),
              attributes: { disabled: !canMarkAllRead },
            },
          ]
        : []),
      ...(hasHiddenChats ? [{ id: "hidden-chats", title: t("mobile.agent.hidden.title") }] : []),
      ...(hasDeletedChannels ? [{ id: "deleted-chats", title: t("mobile.app.route.deletedChannels") }] : []),
    ];
    return [
      {
        id: "add",
        title: "",
        displayInline: true,
        subactions: [
          { id: "add-agent", title: t("mobile.agent.home.addAgent") },
          ...(sidebar?.layout ? [{ id: "add-section", title: t("mobile.agent.sectionForm.newTitle") }] : []),
          ...(channels.supported ? [{ id: "add-channel", title: t("mobile.agent.home.newChannel") }] : []),
        ],
      },
      ...(chatActions.length > 0 ? [{ id: "chats", title: "", displayInline: true, subactions: chatActions }] : []),
    ];
  }, [
    hasHiddenChats,
    hasDeletedChannels,
    hasSelectedServer,
    canMarkAllRead,
    channels.supported,
    sidebar?.layout,
    chatOrder,
    t,
  ]);

  const onPressOption = (event: string) => {
    if (event === "add-section") router.push({ pathname: "/section-form", params: { serverId: activeServer.id } });
    if (event === "add-agent") router.push("/add-agent");
    if (event === "add-channel") router.push({ pathname: "/add-channel", params: { serverId: activeServer.id } });
    if (event === "hidden-chats") router.push("/hidden-chats");
    if (event === "deleted-chats") router.push({ pathname: "/deleted-chats", params: { serverId: activeServer.id } });
    if (event === "mark-all-read") markAllChatsRead();
    const order = MOBILE_CHAT_ORDERS.find((candidate) => event === `sort:${candidate}`);
    if (order) changeChatOrder(order);
  };
  const openServersButton = (
    <HeaderIconButton accessibilityLabel={t("mobile.agent.home.openServers")} glass={buttonGlass} onPress={openDrawer}>
      <PanelLeft color={iconColor} size={22} strokeWidth={2} style={MIRROR_IN_RTL} />
    </HeaderIconButton>
  );
  const headerLeading = (
    <View className={pane ? "min-w-0 flex-1 flex-row items-center gap-2" : "flex-row items-center gap-2"}>
      {openServersButton}
      <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} fill={pane} />
    </View>
  );
  const headerTrailing = (
    <View className="shrink-0 flex-row items-center gap-1">
      {showsPlanLimits ? (
        isAndroid ? (
          <PlanLimitsHeaderButton
            serverId={activeServer.id}
            rows={planLimits.rows}
            accounts={planLimits.accounts}
            disabled={!planLimits.online}
            androidGlass={buttonGlass}
          />
        ) : (
          <HeaderGlass glass={buttonGlass} capsule>
            <PlanLimitsHeaderButton
              serverId={activeServer.id}
              rows={planLimits.rows}
              accounts={planLimits.accounts}
              disabled={!planLimits.online}
              androidGlass={buttonGlass}
            />
          </HeaderGlass>
        )
      ) : null}
      <MenuView
        actions={optionsActions}
        onPressAction={(event) => onPressOption(event.nativeEvent.event)}
        style={{ height: 48, width: 48 }}
      >
        <View
          accessibilityLabel={t("mobile.agent.home.chatOptions")}
          accessibilityRole="button"
          accessible
          className="size-12 items-center justify-center"
        >
          <HeaderGlass glass={buttonGlass}>
            {isAndroid ? (
              <EllipsisVertical color={iconColor} size={22} strokeWidth={2} />
            ) : (
              <Ellipsis color={iconColor} size={22} strokeWidth={2} />
            )}
          </HeaderGlass>
        </View>
      </MenuView>
    </View>
  );

  const railTree = pane ? (
    <ChatListRail
      header={openServersButton}
      pinnedAgents={pinnedAgents}
      pinnedChannels={pinnedChannels}
      items={items}
      serverId={activeServer.id}
      channelAgents={channelAgents}
      headerHeight={PANE_BAR_HEIGHT}
    />
  ) : null;

  const listTree = (
    <View className="flex-1 bg-background">
      <AndroidBlurTarget target={barBlurTarget} surface="canvas">
        {homeCard && !onboarding.active && !sceneShows ? (
          <HomeCardBackdrop
            height={headerHeight + stageHeight}
            top={headerHeight}
            edge={cardEdge}
            scrolled={scroll.scrolled}
            background={cardBackground}
            active={focused}
          />
        ) : null}
        <HomeSearchList search={search} barHeight={searchBarOffset}>
          {onboarding.active ? null : sceneShows ? (
            <EmptyAgentsScene
              onAddAgent={addAgent}
              style={{ paddingTop: insets.top + CROWD_TOP, paddingBottom: insets.bottom + 12 }}
              afterWelcome={welcomeHandOff}
            />
          ) : listReady ? (
            <ChatDragProvider screen={dragScreen}>
              <Animated.FlatList
                key={activeServer.id}
                ref={listRef}
                scrollEnabled={!dragging}
                onLayout={(event) => {
                  dragScroll.current.viewport = event.nativeEvent.layout.height;
                  listReveal.onLayout();
                }}
                onContentSizeChange={(_width, height) => {
                  dragScroll.current.content = height;
                }}
                itemLayoutAnimation={
                  listReveal.finished && sidebar?.layout !== collapseLayout ? LIST_REFLOW : undefined
                }
                skipEnteringExitingAnimations
                removeClippedSubviews={false}
                className={homeCard ? "flex-1" : "flex-1 bg-background"}
                style={{ marginLeft: insets.left, marginRight: insets.right }}
                alwaysBounceVertical={false}
                contentContainerClassName={items.length > 0 ? undefined : "grow"}
                contentContainerStyle={{
                  paddingTop: scroll.ownsInset ? headerHeight : 0,
                  paddingBottom: insets.bottom + HOME_SEARCH_HEIGHT + 24,
                }}
                scrollEventThrottle={16}
                onScroll={scroll.onScroll}
                contentInsetAdjustmentBehavior={scroll.ownsInset ? "never" : "always"}
                data={items}
                keyExtractor={listItemKey}
                renderItem={renderItem}
                initialNumToRender={LIST_BATCH}
                maxToRenderPerBatch={LIST_BATCH}
                windowSize={dragging ? LIST_DRAG_WINDOW_SIZE : LIST_WINDOW_SIZE}
                ListHeaderComponent={
                  <View onLayout={(event) => layoutStage(event.nativeEvent.layout.height)}>
                    <AgentListRowReveal index={0} reveal={listReveal}>
                      {hasSelectedServer ? <AppUpdateSpacer header={updateHeader} headerHeight={headerHeight} /> : null}
                      {hasSelectedServer ? <OtaUpdateSpacer banner={otaBanner} /> : null}
                      {sidebar?.error ? (
                        <View className="gap-2 px-4">
                          <Typography.Paragraph className="text-danger-text">
                            {sourceText(sidebar.error)}
                          </Typography.Paragraph>
                          <Button
                            variant="secondary"
                            onPress={() =>
                              void workspace()
                                .refreshServer(activeServer.id)
                                .catch(() => undefined)
                            }
                          >
                            <Button.Label>{t("mobile.agent.home.retrySections")}</Button.Label>
                          </Button>
                        </View>
                      ) : null}
                    </AgentListRowReveal>
                    <PinnedAgentsGrid
                      agents={pinnedAgents}
                      animateLayout={!updateHeader.moving && !otaBanner.moving}
                      dropZone={dragging && !hasPins}
                      reveal={listReveal}
                      revealOffset={1}
                    >
                      {pinnedChannels.length > 0
                        ? pinnedChannels.map((channel) => (
                            <ChannelListRow
                              key={channel.id}
                              channel={channel}
                              serverId={activeServer.id}
                              agents={channelAgents}
                              pinned
                            />
                          ))
                        : null}
                    </PinnedAgentsGrid>
                    <HomeCardTop
                      card={homeCard}
                      background={cardBackground}
                      serverId={activeServer.id}
                      cardServer={cardServer}
                      settled={listReveal.finished}
                    />
                  </View>
                }
                ListEmptyComponent={
                  serverDirectoryState === "error" && servers.length === 0 ? (
                    <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                      <View className="size-16 items-center justify-center rounded-3xl bg-control">
                        <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                      </View>
                      <View className="items-center gap-1.5">
                        <Typography.Heading type="h4">{t("mobile.agent.home.serversFailed")}</Typography.Heading>
                        <Typography.Paragraph align="center" className="text-text-secondary">
                          {serverDirectoryError
                            ? sourceText(serverDirectoryError)
                            : t("mobile.agent.home.serversFailedBody")}
                        </Typography.Paragraph>
                      </View>
                      <Button
                        size="md"
                        variant="secondary"
                        onPress={() =>
                          void workspace()
                            .refreshServers()
                            .catch(() => undefined)
                        }
                      >
                        <Button.Label>{t("common.tryAgain")}</Button.Label>
                      </Button>
                    </View>
                  ) : servers.length === 0 ? (
                    <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                      <View className="size-16 items-center justify-center rounded-3xl bg-control">
                        <Layers3 color={mutedColor} size={28} strokeWidth={1.6} />
                      </View>
                      <View className="items-center gap-1.5">
                        <Typography.Heading type="h4">{t("mobile.agent.home.noServers")}</Typography.Heading>
                        <Typography.Paragraph align="center" className="text-text-secondary">
                          {t("mobile.agent.home.noServersBody")}
                        </Typography.Paragraph>
                      </View>
                      <Button size="md" variant="secondary" onPress={openDrawer}>
                        <Button.Label>{t("mobile.agent.home.openServers")}</Button.Label>
                      </Button>
                    </View>
                  ) : !hasSelectedServer ? (
                    <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                      <Typography.Heading type="h4">{t("mobile.agent.home.chooseServer")}</Typography.Heading>
                      <Button size="md" variant="secondary" onPress={openDrawer}>
                        <Button.Label>{t("mobile.agent.home.openServers")}</Button.Label>
                      </Button>
                    </View>
                  ) : activeAgents.length === 0 && !activeServerOnline ? (
                    <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                      <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                      <View className="items-center gap-1.5">
                        <Typography.Heading type="h4">{t("mobile.agent.home.waiting")}</Typography.Heading>
                        <Typography.Paragraph align="center" className="text-text-secondary">
                          {t("mobile.agent.home.waitingBody")}
                        </Typography.Paragraph>
                      </View>
                    </View>
                  ) : activeAgents.length === 0 ? (
                    <EmptyAgentsScene onAddAgent={addAgent} />
                  ) : undefined
                }
              />
            </ChatDragProvider>
          ) : null}
        </HomeSearchList>
      </AndroidBlurTarget>

      {onboarding.active ? null : (
        <LargeTitleBar scroll={scroll} blurTarget={barBlurTarget} androidSurfaceOnScroll={homeCard}>
          <AppUpdateBlock header={updateHeader} scroll={scroll} hidden={search.open} />
          <OtaUpdateBlock banner={otaBanner} scroll={scroll} hidden={search.open} />
        </LargeTitleBar>
      )}

      {searchShows ? <HomeSearchResults search={search} barHeight={searchBarOffset} /> : null}

      {searchShows && !updateHeader.expanded ? <HomeSearchBar search={search} /> : null}

      {onboardingReady ? (
        <Animated.View exiting={ONBOARDING_EXIT} style={StyleSheet.absoluteFill}>
          <OnboardingFlow onFinish={finishOnboarding} />
        </Animated.View>
      ) : null}

      {pane ? (
        headerActions && !search.open ? (
          <View
            className="absolute flex-row items-center justify-between gap-2"
            pointerEvents="box-none"
            style={{
              top: barTop,
              left: insets.left + (isIOS ? 16 : 4),
              right: insets.right + (isIOS ? 16 : 4),
              height: PANE_BAR_HEIGHT,
            }}
          >
            {headerLeading}
            {headerTrailing}
          </View>
        ) : null
      ) : null}

      {pane ? null : (
        <Stack.Screen
          options={{
            headerShown: !onboarding.active,
            headerLeft: isAndroid && headerActions && !search.open ? () => headerLeading : undefined,
            headerRight: isAndroid && headerActions && !search.open ? () => headerTrailing : undefined,
            headerTintColor: foreground,
            headerTransparent: true,
            scrollEdgeEffects: { top: "hidden" },
            title: "",
          }}
        />
      )}

      {isIOS && headerActions && !pane ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="sidebar.leading" hidden={search.open} onPress={openDrawer} />
            <Stack.Toolbar.View hidesSharedBackground hidden={search.open}>
              <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} />
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.View hidden={search.open || !showsPlanLimits}>
              <PlanLimitsHeaderButton
                serverId={activeServer.id}
                rows={planLimits.rows}
                accounts={planLimits.accounts}
                disabled={!planLimits.online}
                androidGlass={buttonGlass}
              />
            </Stack.Toolbar.View>
            <Stack.Toolbar.Menu
              icon="ellipsis"
              accessibilityLabel={t("mobile.agent.home.chatOptions")}
              separateBackground
              hidden={search.open}
            >
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon="plus.circle" onPress={() => openFromMenu("/add-agent")}>
                  {t("mobile.agent.home.addAgent")}
                </Stack.Toolbar.MenuAction>
                {sidebar?.layout ? (
                  <Stack.Toolbar.MenuAction
                    icon="folder.badge.plus"
                    onPress={() => openFromMenu({ pathname: "/section-form", params: { serverId: activeServer.id } })}
                  >
                    {t("mobile.agent.sectionForm.newTitle")}
                  </Stack.Toolbar.MenuAction>
                ) : null}
                {channels.supported ? (
                  <Stack.Toolbar.MenuAction
                    icon="number"
                    onPress={() => openFromMenu({ pathname: "/add-channel", params: { serverId: activeServer.id } })}
                  >
                    {t("mobile.agent.home.newChannel")}
                  </Stack.Toolbar.MenuAction>
                ) : null}
              </Stack.Toolbar.Menu>
              {hasSelectedServer || hasHiddenChats || hasDeletedChannels ? (
                <Stack.Toolbar.Menu inline>
                  {hasSelectedServer ? (
                    <Stack.Toolbar.Menu icon="arrow.up.arrow.down" title={t("mobile.agent.home.sort.title")}>
                      {MOBILE_CHAT_ORDERS.map((order) => (
                        <Stack.Toolbar.MenuAction
                          key={order}
                          isOn={order === chatOrder}
                          onPress={() => changeChatOrder(order)}
                        >
                          {t(CHAT_ORDER_LABEL[order])}
                        </Stack.Toolbar.MenuAction>
                      ))}
                    </Stack.Toolbar.Menu>
                  ) : null}
                  {hasSelectedServer ? (
                    <Stack.Toolbar.MenuAction
                      icon="envelope.open"
                      disabled={!canMarkAllRead}
                      onPress={markAllChatsRead}
                    >
                      {t("mobile.agent.home.markAllRead")}
                    </Stack.Toolbar.MenuAction>
                  ) : null}
                  {hasHiddenChats ? (
                    <Stack.Toolbar.MenuAction icon="eye.slash" onPress={() => openFromMenu("/hidden-chats")}>
                      {t("mobile.agent.hidden.title")}
                    </Stack.Toolbar.MenuAction>
                  ) : null}
                  {hasDeletedChannels ? (
                    <Stack.Toolbar.MenuAction
                      icon="trash"
                      onPress={() =>
                        openFromMenu({ pathname: "/deleted-chats", params: { serverId: activeServer.id } })
                      }
                    >
                      {t("mobile.app.route.deletedChannels")}
                    </Stack.Toolbar.MenuAction>
                  ) : null}
                </Stack.Toolbar.Menu>
              ) : null}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : null}
    </View>
  );
  return pane ? <SplitPaneLayers list={listTree} rail={railTree} /> : listTree;
}

function NoChatOpen() {
  const { t } = useText();
  const muted = useThemeColor("muted");
  return (
    <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
      <Stack.Screen options={{ headerShown: false, title: "" }} />
      <View className="size-16 items-center justify-center rounded-3xl bg-control">
        <MessagesSquare color={String(muted)} size={28} strokeWidth={1.6} />
      </View>
      <View className="items-center gap-1.5">
        <Typography.Heading type="h4">{t("mobile.agent.home.noChatOpen")}</Typography.Heading>
        <Typography.Paragraph align="center" className="text-text-secondary">
          {t("mobile.agent.home.noChatOpenBody")}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

export function ConnectedRoute() {
  return useSplitLayout() ? <NoChatOpen /> : <ConnectedScreen />;
}
