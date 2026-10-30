import type { ChannelSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { BlurTargetView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import { type Href, router, Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import Layers3 from "lucide-react-native/icons/layers";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import WifiOff from "lucide-react-native/icons/wifi-off";
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View, type ViewInstance, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
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
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AgentWaitingGroupHeader } from "@/features/agents/components/agent-wait-badge";
import { ChatListRail } from "@/features/agents/components/chat-list-rail";
import { EmptyAgentsScene, type WelcomeHandOff } from "@/features/agents/components/empty-agents-scene";
import { PinnedAgentsGrid } from "@/features/agents/components/pinned-agents-grid";
import { SidebarSectionHeader } from "@/features/agents/components/sidebar-section-header";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  AppUpdateBlock,
  AppUpdateSpacer,
  useAppUpdateHeader,
} from "@/features/app-update/components/app-update-header";
import { useAppUpdate } from "@/features/app-update/model/app-update";
import { ChannelListRow } from "@/features/channels/components/channel-list";
import { useChannels } from "@/features/channels/components/use-channels";
import { OnboardingFlow } from "@/features/onboarding/components/onboarding-flow";
import { useHomeOnboarding } from "@/features/onboarding/context/home-onboarding-context";
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
import { ConnectionHeaderStatus } from "@/features/workspace/components/connection-header-status";
import { useWaitingAgentIds } from "@/features/workspace/components/use-agent-activity";
import { useUnreadAgentIds } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import {
  type MobileSidebarItem,
  mobileSidebarItems,
  mobileWaitingItems,
} from "@/features/workspace/model/sidebar-layout";
import { SplitPaneLayers, useSplitLayout } from "@/shared/components/adaptive-split";
import { useAppLoadingOverlay, useScreenLoadingLabel } from "@/shared/components/app-loading-overlay";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { BAR_BUTTON_SIZE, NATIVE_BAR_HEIGHT, useBarTop } from "@/shared/lib/native-bar";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ONBOARDING_EXIT = FadeOut.duration(220).easing(EASE_OUT);
const ROW_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const LIST_REFLOW = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
// A row is about 80 pt high. The list keeps a few screens of rows mounted instead of the default 21,
// so a server with many agents mounts fewer avatars, swipe handlers and menus.
const LIST_WINDOW_SIZE = 7;
const LIST_BATCH = 10;

/** A chat row: an agent, or a channel with its server and the agents of that server. */
interface ChatRowTarget {
  agent?: MobileAgent;
  channel?: ChannelSummary;
  serverId?: string;
  channelAgents?: ReadonlyMap<string, MobileAgent>;
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
  const { transition } = useAgentPinTransition();
  const chatId = agent?.id ?? channel?.id;
  const isTarget = transition !== null && transition.chatId === chatId && transition.target === "row";

  const [initiallyExpanded] = useState(!collapsed);
  const [contentMounted, setContentMounted] = useState(!collapsed);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  // An expanded row at rest lays out in the flow with no animated height. A later render then
  // cannot put back a first-render height of 0 when the animated value has not reached React.
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
  // Derive the fade from the same height, so a reversed toggle cannot leave
  // opacity and the accordion at different points in their transitions.
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
            // At rest the row takes its own height, so a collapse starts from the height it has now.
            if (resting) height.set(nextHeight);
            setMeasuredHeight(nextHeight);
          }}
        >
          <Animated.View collapsable={false} entering={isTarget ? ROW_ENTER : undefined}>
            <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
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
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

function listItemKey(item: MobileSidebarItem) {
  return `${item.kind}:${item.id}`;
}

const HEADER_RIPPLE = { borderless: true, radius: 20 } as const;
/**
 * The bar that the chat list pane draws has the height of the native bar of the screens beside it, so
 * the buttons of the two columns line up. Its iOS buttons have the 48 pt glass of the chat header.
 */
const PANE_BAR_HEIGHT = NATIVE_BAR_HEIGHT;

/**
 * On Android, the content under the search field, which the field blurs: Android blurs only the
 * content of a `BlurTargetView`. iOS blurs with its glass and needs no target.
 */
function SearchBlurTarget({ target, children }: { target: RefObject<ViewInstance | null>; children: ReactNode }) {
  if (!isAndroid) return children;
  return (
    <BlurTargetView ref={target} style={{ flex: 1 }}>
      <View className="flex-1 bg-background">{children}</View>
    </BlurTargetView>
  );
}

/**
 * The glass behind a header button that the screen draws. Android has the solid glass of the design.
 * On iOS, the chat list pane draws its own bar, so its buttons take Liquid Glass as the native bar does.
 */
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
        <ChromeGlassSheen />
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
      // A Material tonal icon button: a 40 dp filled circle and ripple in a 48 dp target.
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

/**
 * Home: the chat list of the selected server. On a narrow window it is the first screen of the stack,
 * under the native bar. On a wide window it is the pane beside the detail column and draws its own
 * bar, since the native bar belongs to the screens of the stack.
 */
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
  const [collapsedByServer, setCollapsedByServer] = useState<Record<string, ReadonlySet<string>>>({});
  const collapsedSectionIds = collapsedByServer[activeServer.id];
  const channels = useChannels(activeServer.id);
  const channelAgents = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === activeServer.id).map((agent) => [agent.id, agent])),
    [agents, activeServer.id],
  );
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  // The Android header buttons have the glass of the search field.
  const buttonGlass = useChromeGlass();
  const searchBlurTarget = useRef<ViewInstance>(null);
  const iconColor = String(foreground);
  const mutedColor = String(muted);
  const hasSelectedServer = servers.some((server) => server.id === activeServer.id);
  const planLimits = usePlanLimits(activeServer.id);
  const showsPlanLimits = hasSelectedServer && planLimits.rows.length > 0;
  const showLoader =
    (serverDirectoryState === "loading" && servers.length === 0) ||
    (hasSelectedServer && activeServer.initialConnectionPending);
  // The list comes in as the loader starts to roll up, so the two overlap instead of waiting in turn.
  const listReady = !showLoader && !isLoaderPresent;
  // A new account gets the first-run flow in place of the empty home. The flow shows its own
  // connection state, so the loader does not cover it.
  const onboarding = useHomeOnboarding();
  const onboardingReady = onboarding.active && !isLoaderPresent;
  // Skipped on its welcome, the flow fades off the empty home, which has the welcome's layout. The
  // home reads where the welcome's main action stood when it comes in; later visits do not.
  const [welcomeHandOff, setWelcomeHandOff] = useState<WelcomeHandOff | null>(null);
  useEffect(() => {
    if (welcomeHandOff) setWelcomeHandOff(null);
  }, [welcomeHandOff]);
  // The header actions belong to the list. While the loader shows they have nothing to act on, so
  // they come in with the list. The header itself stays, so its height does not change.
  const headerActions = listReady && !onboarding.active;
  // Connecting to a server continues while the user reads a chat, so the label only
  // belongs to this screen while it is the route on top.
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
  // A deleted channel is archived on the host; the list and the pins leave it out.
  const openChannels = useMemo(
    () => channels.channels.filter((channel) => !channel.archived && !hiddenChannelIds.includes(channel.id)),
    [channels.channels, hiddenChannelIds],
  );
  const pinnedChannels = useMemo(
    () => openChannels.filter((channel) => pinnedChannelIds.includes(channel.id)),
    [openChannels, pinnedChannelIds],
  );
  const hasHiddenChats =
    hiddenAgents.length > 0 ||
    channels.channels.some((channel) => !channel.archived && hiddenChannelIds.includes(channel.id));
  const hasPins = pinnedAgents.length + pinnedChannels.length > 0;
  // As Hidden chats, the menu offers Deleted channels only when the server has one to restore or read.
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
  // A waiting agent leaves its section for "Needs you". A pinned agent stays in its tile, which shows the same badge.
  const waitingAgentIds = useWaitingAgentIds();
  const items = useMemo(
    () => [
      ...mobileWaitingItems(
        sidebar?.layout ?? null,
        unpinnedAgents.filter((agent) => waitingAgentIds.has(agent.id)),
      ),
      ...mobileSidebarItems(
        sidebar?.layout ?? null,
        unpinnedAgents.filter((agent) => !waitingAgentIds.has(agent.id)),
        openChannels.filter((channel) => !pinnedChannelIds.includes(channel.id)),
        undefined,
        t,
      ),
    ],
    [sidebar?.layout, unpinnedAgents, waitingAgentIds, openChannels, pinnedChannelIds, t],
  );
  const visibleSectionIds = useMemo(
    () => items.filter((item) => item.kind === "section").map((item) => item.id),
    [items],
  );
  const insets = useSafeAreaInsets();
  const barTop = useBarTop();
  const scroll = useLargeTitleScroll(pane ? { headerHeight: barTop + PANE_BAR_HEIGHT } : undefined);
  const { headerHeight } = scroll;
  const search = useHomeSearch();
  // Search has no bar: the list and the results move up by the bar's height as it opens.
  const searchBarOffset = Math.max(0, headerHeight - insets.top);
  // A new server shows a new list at its top, which sends no scroll event.
  const listServerId = activeServer.id;
  useEffect(() => {
    if (listServerId) scroll.scrolled.set(0);
  }, [listServerId, scroll.scrolled]);
  // With nothing in the list, the scene replaces it. In a list, the native header and safe-area
  // insets add to a content container that already fills the screen, so iOS would scroll it.
  // Pins and a sidebar error still need the list header, so they keep the scene in the list.
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
  // The same condition as the connection state in the bar.
  const statusShows = hasSelectedServer && !activeServer.initialConnectionPending && !activeServerOnline;
  // The empty scene has its own main action where the field would be.
  const searchShows = listReady && hasSelectedServer && !onboarding.active && !sceneShows;
  // An app update drops the lilac block to a header above the list, where the search field shows.
  const appUpdate = useAppUpdate();
  const updateHeader = useAppUpdateHeader(searchShows ? appUpdate : null);
  const { open: searchOpen, closeSearch } = search;
  useEffect(() => {
    if (!searchShows && searchOpen) closeSearch();
  }, [searchShows, searchOpen, closeSearch]);
  // A quick action waits while the list loads. A ready home without the field drops it, also while
  // What's new hides the field. When home leaves, a request waits again for the next home.
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
  // Collapse keeps stable list cells and changes their heights on the UI thread.
  // Enable cell reflow again when a host layout update moves agents or sections.
  const [collapseLayout, setCollapseLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const collapsedChatIds = useMemo(() => {
    const ids = new Set<string>();
    let sectionCollapsed = false;
    for (const item of items) {
      if (item.kind === "waiting") sectionCollapsed = false;
      else if (item.kind === "section") sectionCollapsed = collapsedSectionIds?.has(item.id) ?? false;
      else if (sectionCollapsed) ids.add(item.id);
    }
    return ids;
  }, [items, collapsedSectionIds]);
  const sidebarLayout = sidebar?.layout ?? null;
  const serverId = activeServer.id;
  const toggleSection = useCallback(
    (sectionId: string) => {
      setCollapseLayout(sidebarLayout);
      setCollapsedByServer((current) => {
        const next = new Set(current[serverId]);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        return { ...current, [serverId]: next };
      });
    },
    [serverId, sidebarLayout],
  );
  // Rows are memoized, so a new message for one agent renders only that agent's row.
  const rowOffset = hasPins ? 1 : 0;
  const renderItem = useCallback(
    ({ item, index }: { item: MobileSidebarItem; index: number }) =>
      item.kind === "waiting" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <AgentWaitingGroupHeader count={item.count} />
        </AgentListRowReveal>
      ) : item.kind === "section" ? (
        <AgentListRowReveal index={index + rowOffset} reveal={listReveal}>
          <SidebarSectionHeader
            key={`${activeServer.id}:${item.id}`}
            id={item.id}
            name={item.name}
            empty={item.empty}
            visibleSectionIds={visibleSectionIds}
            collapsed={collapsedSectionIds?.has(item.id) ?? false}
            onToggle={toggleSection}
          />
        </AgentListRowReveal>
      ) : item.kind === "channel" ? (
        <TransitioningChatRow
          channel={item.channel}
          serverId={activeServer.id}
          channelAgents={channelAgents}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedChatIds.has(item.id)}
        />
      ) : (
        <TransitioningChatRow
          agent={item.agent}
          index={index + rowOffset}
          reveal={listReveal}
          collapsed={collapsedChatIds.has(item.id)}
        />
      ),
    [
      activeServer.id,
      channelAgents,
      collapsedChatIds,
      collapsedSectionIds,
      listReveal,
      rowOffset,
      toggleSection,
      visibleSectionIds,
    ],
  );
  // Add actions come first, then a divider and the actions on existing chats.
  const optionsActions = useMemo<MenuAction[]>(() => {
    const chatActions: MenuAction[] = [
      ...(hasSelectedServer
        ? [
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
  }, [hasHiddenChats, hasDeletedChannels, hasSelectedServer, canMarkAllRead, channels.supported, sidebar?.layout, t]);

  const onPressOption = (event: string) => {
    if (event === "add-section") router.push({ pathname: "/section-form", params: { serverId: activeServer.id } });
    if (event === "add-agent") router.push("/add-agent");
    if (event === "add-channel") router.push({ pathname: "/add-channel", params: { serverId: activeServer.id } });
    if (event === "hidden-chats") router.push("/hidden-chats");
    if (event === "deleted-chats") router.push({ pathname: "/deleted-chats", params: { serverId: activeServer.id } });
    if (event === "mark-all-read") markAllChatsRead();
  };
  // The bar buttons that the screen draws: the Android header of the screen, and the bar of the pane.
  // In the pane, the status takes the room that the buttons leave: the pane can be 320 pt wide.
  const headerLeading = (
    <View className={pane ? "min-w-0 flex-1 flex-row items-center gap-2" : "flex-row items-center gap-2"}>
      <HeaderIconButton
        accessibilityLabel={t("mobile.agent.home.openServers")}
        glass={buttonGlass}
        onPress={openDrawer}
      >
        <Layers3 color={iconColor} size={22} strokeWidth={2} />
      </HeaderIconButton>
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

  // The pane also has its rail of avatars, which shows when the user drags the pane narrow.
  const railTree = pane ? (
    <ChatListRail
      header={
        <HeaderIconButton
          accessibilityLabel={t("mobile.agent.home.openServers")}
          glass={buttonGlass}
          onPress={openDrawer}
        >
          <Layers3 color={iconColor} size={22} strokeWidth={2} />
        </HeaderIconButton>
      }
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
      <SearchBlurTarget target={searchBlurTarget}>
        <HomeSearchList search={search} barHeight={searchBarOffset}>
          {onboarding.active ? null : sceneShows ? (
            // The scene has the insets of the welcome, so the characters stand in the same places on
            // both. Its top leaves the transparent header and its blur clear.
            <EmptyAgentsScene
              onAddAgent={addAgent}
              style={{ paddingTop: insets.top + CROWD_TOP, paddingBottom: insets.bottom + 12 }}
              afterWelcome={welcomeHandOff}
            />
          ) : listReady ? (
            <Animated.FlatList
              key={activeServer.id}
              onLayout={listReveal.onLayout}
              itemLayoutAnimation={listReveal.finished && sidebar?.layout !== collapseLayout ? LIST_REFLOW : undefined}
              skipEnteringExitingAnimations
              removeClippedSubviews={false}
              className="flex-1 bg-background"
              // The side insets (the iPhone Duo rail, the landscape cutout) go outside the list. With
              // `always`, iOS would also inset the content by them.
              style={{ marginLeft: insets.left, marginRight: insets.right }}
              alwaysBounceVertical={false}
              contentContainerClassName={items.length > 0 ? undefined : "grow"}
              // Without a content inset from iOS (Android, the pane, the vertical bar of iPhone Duo), the
              // list starts below the bar. The end of the list scrolls clear of the search field.
              contentContainerStyle={{
                paddingTop: scroll.ownsInset ? headerHeight : 0,
                paddingBottom: insets.bottom + HOME_SEARCH_HEIGHT + 24,
              }}
              scrollEventThrottle={16}
              onScroll={scroll.onScroll}
              // Keep the native header inset even when short content cannot scroll or bounce.
              contentInsetAdjustmentBehavior={scroll.ownsInset ? "never" : "always"}
              data={items}
              keyExtractor={listItemKey}
              renderItem={renderItem}
              initialNumToRender={LIST_BATCH}
              maxToRenderPerBatch={LIST_BATCH}
              windowSize={LIST_WINDOW_SIZE}
              ListHeaderComponent={
                <AgentListRowReveal index={0} reveal={listReveal}>
                  {hasSelectedServer ? (
                    <LargeTitle
                      scroll={scroll}
                      title={activeServer.name}
                      above={<AppUpdateSpacer header={updateHeader} headerHeight={headerHeight} />}
                      accessibilityLabel={t("mobile.agent.home.serverTitle", { name: activeServer.name })}
                      onPress={openDrawer}
                    />
                  ) : null}
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
                  <PinnedAgentsGrid agents={pinnedAgents} animateLayout={!updateHeader.moving}>
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
                </AgentListRowReveal>
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
                    {/* The drawer holds the ways to add a server. Without this, the next step is hidden. */}
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
          ) : null}
        </HomeSearchList>
      </SearchBlurTarget>

      {/* The list scrolls under the transparent header, which gets the blur of the chat header. iOS 27
          shows no native scroll edge effect here. The native top edge is hidden to avoid two effects. */}
      {onboarding.active ? null : (
        <LargeTitleBar
          scroll={scroll}
          title={activeServer.name}
          // The connection state takes the place of the title in the bar.
          hidden={!searchShows || statusShows || search.open}
        >
          <AppUpdateBlock header={updateHeader} scroll={scroll} hidden={search.open} />
        </LargeTitleBar>
      )}

      {/* The results lie over the bar's edge, so its blur cannot soften them; they have their own. */}
      {searchShows ? <HomeSearchResults search={search} barHeight={searchBarOffset} /> : null}

      {/* What's new covers home with the update block, so the field leaves while it shows. */}
      {searchShows && !updateHeader.expanded ? <HomeSearchBar search={search} blurTarget={searchBlurTarget} /> : null}

      {onboardingReady ? (
        // The flow fades out over the home, which comes in under it with its own reveal.
        <Animated.View exiting={ONBOARDING_EXIT} style={StyleSheet.absoluteFill}>
          <OnboardingFlow onFinish={finishOnboarding} />
        </Animated.View>
      ) : null}

      {pane ? (
        // The bar of the pane, over the edge effect of `LargeTitleBar`. The search takes the pane, so
        // the bar buttons go while it is open.
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
            // The first-run flow is a whole screen with its own back and skip actions.
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
            {/* The search takes the screen, so the bar buttons go while it is open. */}
            <Stack.Toolbar.Button icon="square.stack.3d.up.fill" hidden={search.open} onPress={openDrawer} />
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
              {/* Add actions come first, then a divider and the actions on existing chats. */}
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

/** The detail column of a wide window before a chat opens: the list is in the pane beside it. */
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

/**
 * The first route of the stack. A wide window shows the chat list in the pane, so the route shows the
 * empty detail column there. The first-run flow keeps the whole window, so it has no pane.
 */
export function ConnectedRoute() {
  return useSplitLayout() ? <NoChatOpen /> : <ConnectedScreen />;
}
