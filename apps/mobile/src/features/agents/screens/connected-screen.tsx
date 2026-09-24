import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { router, Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Bot, Layers3, Plus, Search, WifiOff } from "lucide-react-native";
import { useLayoutEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import {
  type AgentListRevealState,
  AgentListRowReveal,
  useAgentListReveal,
} from "@/features/agents/components/agent-list-reveal";
import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { PinnedAgentsGrid } from "@/features/agents/components/pinned-agents-grid";
import { SidebarSectionHeader } from "@/features/agents/components/sidebar-section-header";
import { ChannelListRow } from "@/features/channels/components/channel-list";
import { useChannels } from "@/features/channels/components/use-channels";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { ConnectionHeaderStatus } from "@/features/workspace/components/connection-header-status";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { mobileSidebarItems } from "@/features/workspace/model/sidebar-layout";
import { useAppLoadingOverlay, useScreenLoadingLabel } from "@/shared/components/app-loading-overlay";
import { isAndroid, isIOS } from "@/shared/lib/platform";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ROW_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const LIST_REFLOW = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
// Agent search is not available in the current mobile release, so keep its entry points hidden until it is ready.
const IS_AGENT_SEARCH_ENABLED = false;

function TransitioningChatRow({
  chatId,
  children,
  index,
  reveal,
  collapsed,
}: {
  chatId: string;
  children: React.ReactNode;
  index: number;
  reveal: AgentListRevealState;
  collapsed: boolean;
}) {
  const { transition } = useAgentPinTransition();
  const isTarget = transition?.chatId === chatId && transition.target === "row";

  const [initiallyExpanded] = useState(!collapsed);
  const [contentMounted, setContentMounted] = useState(!collapsed);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const height = useSharedValue(0);
  useLayoutEffect(() => {
    if (!collapsed) setContentMounted(true);
    if (measuredHeight === null) return;
    let active = true;
    const releaseContent = () => {
      if (active) setContentMounted(false);
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
          if (finished && collapsed) scheduleOnRN(releaseContent);
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

  return (
    <Animated.View
      style={bodyStyle}
      pointerEvents={collapsed ? "none" : "auto"}
      accessibilityElementsHidden={collapsed}
      importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
    >
      {contentMounted ? (
        <Animated.View
          style={[
            measuredHeight === null && initiallyExpanded
              ? undefined
              : { position: "absolute", top: 0, left: 0, right: 0 },
            contentStyle,
          ]}
          onLayout={({ nativeEvent }) => {
            const nextHeight = nativeEvent.layout.height;
            if (measuredHeight === null && initiallyExpanded) height.set(nextHeight);
            setMeasuredHeight(nextHeight);
          }}
        >
          <Animated.View collapsable={false} entering={isTarget ? ROW_ENTER : undefined}>
            <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
              {children}
            </AgentListRowReveal>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function HeaderIconButton({
  accessibilityLabel,
  children,
  onPress,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      className="size-11 items-center justify-center rounded-full"
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

export function ConnectedScreen() {
  const { isLoaderPresent } = useAppLoadingOverlay();
  const { openDrawer } = useAppDrawer();
  const {
    sidebarByServer,
    refreshServer,
    agents,
    activeAgents,
    activeServer,
    hiddenAgents,
    hiddenChannelIds,
    pinnedAgentIds,
    pinnedChannelIds,
    refreshServers,
    serverDirectoryError,
    serverDirectoryState,
    servers,
  } = useMobileWorkspace();
  const [collapsedByServer, setCollapsedByServer] = useState<Record<string, ReadonlySet<string>>>({});
  const collapsedSectionIds = collapsedByServer[activeServer.id];
  const channels = useChannels(activeServer.id);
  const channelAgents = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === activeServer.id).map((agent) => [agent.id, agent])),
    [agents, activeServer.id],
  );
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const iconColor = String(foreground);
  const mutedColor = String(muted);
  const hasSelectedServer = servers.some((server) => server.id === activeServer.id);
  const showLoader =
    (serverDirectoryState === "loading" && servers.length === 0) ||
    (hasSelectedServer && activeServer.initialConnectionPending);
  const listReady = !showLoader && !isLoaderPresent;
  // Connecting to a server continues while the user reads a chat, so the label only
  // belongs to this screen while it is the route on top.
  useScreenLoadingLabel(
    "/connected",
    showLoader ? (hasSelectedServer ? "Connecting to server" : "Loading your servers") : null,
  );
  const pinnedAgents = pinnedAgentIds
    .map((agentId) => activeAgents.find((agent) => agent.id === agentId))
    .filter((agent): agent is (typeof activeAgents)[number] => Boolean(agent));
  const hasHiddenChats =
    hiddenAgents.length > 0 ||
    channels.channels.some((channel) => !channel.archived && hiddenChannelIds.includes(channel.id));
  const pinnedChannels = channels.channels.filter(
    (channel) => !channel.archived && !hiddenChannelIds.includes(channel.id) && pinnedChannelIds.includes(channel.id),
  );
  const hasPins = pinnedAgents.length + pinnedChannels.length > 0;
  const unpinnedAgents = useMemo(
    () => activeAgents.filter((agent) => !pinnedAgentIds.includes(agent.id)),
    [activeAgents, pinnedAgentIds],
  );
  const sidebar = sidebarByServer[activeServer.id];
  const items = useMemo(
    () =>
      mobileSidebarItems(
        sidebar?.layout ?? null,
        unpinnedAgents,
        channels.channels.filter(
          (channel) =>
            !hiddenChannelIds.includes(channel.id) && !channel.archived && !pinnedChannelIds.includes(channel.id),
        ),
      ),
    [sidebar?.layout, unpinnedAgents, channels.channels, hiddenChannelIds, pinnedChannelIds],
  );
  const visibleSectionIds = items.filter((item) => item.kind === "section").map((item) => item.id);
  const listReveal = useAgentListReveal(listReady, activeServer.id);
  // Collapse keeps stable list cells and changes their heights on the UI thread.
  // Enable cell reflow again when a host layout update moves agents or sections.
  const [collapseLayout, setCollapseLayout] = useState<SidebarLayoutSnapshot | null>(null);
  const collapsedChatIds = useMemo(() => {
    const ids = new Set<string>();
    let sectionCollapsed = false;
    for (const item of items) {
      if (item.kind === "section") sectionCollapsed = collapsedSectionIds?.has(item.id) ?? false;
      else if (sectionCollapsed) ids.add(item.id);
    }
    return ids;
  }, [items, collapsedSectionIds]);
  const optionsActions = useMemo<MenuAction[]>(
    () => [
      { id: "add-agent", title: "Add agent" },
      ...(sidebar?.layout ? [{ id: "add-section", title: "New section" }] : []),
      ...(channels.supported ? [{ id: "add-channel", title: "New channel" }] : []),
      ...(hasHiddenChats ? [{ id: "hidden-chats", title: "Hidden chats" }] : []),
    ],
    [hasHiddenChats, channels.supported, sidebar?.layout],
  );

  return (
    <View className="flex-1 bg-background">
      {listReady ? (
        <Animated.FlatList
          key={activeServer.id}
          onLayout={listReveal.onLayout}
          itemLayoutAnimation={listReveal.finished && sidebar?.layout !== collapseLayout ? LIST_REFLOW : undefined}
          skipEnteringExitingAnimations
          removeClippedSubviews={false}
          className="flex-1 bg-background"
          alwaysBounceVertical={false}
          contentContainerClassName={items.length > 0 ? "pb-safe-offset-4" : "grow pb-safe-offset-4"}
          // Keep the native header inset even when short content cannot scroll or bounce.
          contentInsetAdjustmentBehavior="always"
          data={items}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          renderItem={({ item, index }) =>
            item.kind === "section" ? (
              <AgentListRowReveal index={index + (hasPins ? 1 : 0)} reveal={listReveal}>
                <SidebarSectionHeader
                  key={`${activeServer.id}:${item.id}`}
                  id={item.id}
                  name={item.name}
                  empty={item.empty}
                  visibleSectionIds={visibleSectionIds}
                  collapsed={collapsedSectionIds?.has(item.id) ?? false}
                  onToggle={() => {
                    setCollapseLayout(sidebar?.layout ?? null);
                    setCollapsedByServer((current) => {
                      const next = new Set(current[activeServer.id]);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return { ...current, [activeServer.id]: next };
                    });
                  }}
                />
              </AgentListRowReveal>
            ) : (
              <TransitioningChatRow
                chatId={item.kind === "agent" ? item.agent.id : item.channel.id}
                index={index + (hasPins ? 1 : 0)}
                reveal={listReveal}
                collapsed={collapsedChatIds.has(item.id)}
              >
                {item.kind === "channel" ? (
                  <ChannelListRow channel={item.channel} serverId={activeServer.id} agents={channelAgents} />
                ) : (
                  <AgentListRow agent={item.agent} leftInset={15} rightInset={24} />
                )}
              </TransitioningChatRow>
            )
          }
          ListHeaderComponent={
            <AgentListRowReveal index={0} reveal={listReveal}>
              {sidebar?.error ? (
                <View className="gap-2 px-4">
                  <Typography.Paragraph className="text-danger-text">{sidebar.error}</Typography.Paragraph>
                  <Button
                    variant="secondary"
                    onPress={() => void refreshServer(activeServer.id).catch(() => undefined)}
                  >
                    <Button.Label>Retry sections</Button.Label>
                  </Button>
                </View>
              ) : null}
              <PinnedAgentsGrid agents={pinnedAgents}>
                {pinnedChannels.length
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
                  <Typography.Heading type="h4">Couldn’t load your servers</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    {serverDirectoryError ?? "Check that the desktop app is running and try again."}
                  </Typography.Paragraph>
                </View>
                <Button size="md" variant="secondary" onPress={() => void refreshServers().catch(() => undefined)}>
                  <Button.Label>Try again</Button.Label>
                </Button>
              </View>
            ) : servers.length === 0 ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <View className="size-16 items-center justify-center rounded-3xl bg-control">
                  <Layers3 color={mutedColor} size={28} strokeWidth={1.6} />
                </View>
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">No servers available</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    Connect the desktop app again or join a remote server.
                  </Typography.Paragraph>
                </View>
              </View>
            ) : !hasSelectedServer ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <Typography.Heading type="h4">Choose a server</Typography.Heading>
                <Button size="md" variant="secondary" onPress={openDrawer}>
                  <Button.Label>Open servers</Button.Label>
                </Button>
              </View>
            ) : activeAgents.length === 0 && activeServer.state !== "online" ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <WifiOff color={mutedColor} size={28} strokeWidth={1.6} />
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">Waiting for connection</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    The agent list will load once this server is connected.
                  </Typography.Paragraph>
                </View>
              </View>
            ) : activeAgents.length === 0 ? (
              <View className="flex-1 items-center justify-center gap-5 px-8 py-16">
                <View className="size-16 items-center justify-center rounded-3xl bg-control">
                  <Bot color={mutedColor} size={30} strokeWidth={1.6} />
                </View>
                <View className="items-center gap-1.5">
                  <Typography.Heading type="h4">No agents on this server</Typography.Heading>
                  <Typography.Paragraph align="center" className="text-text-secondary">
                    Add an agent to start working from your phone.
                  </Typography.Paragraph>
                </View>
                <Button size="md" variant="secondary" onPress={() => router.push("/add-agent")}>
                  <Plus color={iconColor} size={18} strokeWidth={2} />
                  <Button.Label>Add agent</Button.Label>
                </Button>
              </View>
            ) : null
          }
        />
      ) : null}

      <Stack.Screen
        options={{
          headerLeft: isAndroid
            ? () => (
                <View className="flex-row items-center gap-2">
                  <HeaderIconButton accessibilityLabel="Open servers" onPress={openDrawer}>
                    <Layers3 color={iconColor} size={22} strokeWidth={1.8} />
                  </HeaderIconButton>
                  <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} />
                </View>
              )
            : undefined,
          headerRight: isAndroid
            ? () => (
                <View className="flex-row items-center gap-1">
                  {IS_AGENT_SEARCH_ENABLED ? (
                    <HeaderIconButton accessibilityLabel="Search agents" onPress={() => router.push("/search-agents")}>
                      <Search color={iconColor} size={22} strokeWidth={1.9} />
                    </HeaderIconButton>
                  ) : null}
                  <MenuView
                    actions={optionsActions}
                    onPressAction={(event) => {
                      if (event.nativeEvent.event === "add-section")
                        router.push({ pathname: "/section-form", params: { serverId: activeServer.id } });
                      if (event.nativeEvent.event === "add-agent") router.push("/add-agent");
                      if (event.nativeEvent.event === "add-channel")
                        router.push({ pathname: "/add-channel", params: { serverId: activeServer.id } });
                      if (event.nativeEvent.event === "hidden-chats") router.push("/hidden-chats");
                    }}
                    style={{ height: 44, width: 44 }}
                  >
                    <View
                      accessibilityLabel="Chat options"
                      accessibilityRole="button"
                      accessible
                      className="size-11 items-center justify-center rounded-full"
                    >
                      <Plus color={iconColor} size={24} strokeWidth={1.9} />
                    </View>
                  </MenuView>
                </View>
              )
            : undefined,
          headerTintColor: foreground,
          title: "",
        }}
      />

      {isIOS ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="square.stack.3d.up.fill" onPress={openDrawer} />
            <Stack.Toolbar.View hidesSharedBackground>
              <ConnectionHeaderStatus server={hasSelectedServer ? activeServer : undefined} />
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            {IS_AGENT_SEARCH_ENABLED ? (
              <Stack.Toolbar.Button icon="magnifyingglass" onPress={() => router.push("/search-agents")} />
            ) : null}
            <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Chat options">
              <Stack.Toolbar.MenuAction icon="plus.circle" onPress={() => router.push("/add-agent")}>
                Add agent
              </Stack.Toolbar.MenuAction>
              {sidebar?.layout ? (
                <Stack.Toolbar.MenuAction
                  icon="folder.badge.plus"
                  onPress={() => router.push({ pathname: "/section-form", params: { serverId: activeServer.id } })}
                >
                  New section
                </Stack.Toolbar.MenuAction>
              ) : null}
              {channels.supported ? (
                <Stack.Toolbar.MenuAction
                  icon="number"
                  onPress={() => router.push({ pathname: "/add-channel", params: { serverId: activeServer.id } })}
                >
                  New channel
                </Stack.Toolbar.MenuAction>
              ) : null}
              {hasHiddenChats ? (
                <Stack.Toolbar.MenuAction icon="eye.slash" onPress={() => router.push("/hidden-chats")}>
                  Hidden chats
                </Stack.Toolbar.MenuAction>
              ) : null}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : null}
    </View>
  );
}
