import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { ChannelSummary } from "@openbot/contracts/ipc";
import { router, Stack, useIsFocused } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Bot, Layers3, Plus, Search, WifiOff } from "lucide-react-native";
import { useLayoutEffect, useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import {
  type AgentListRevealState,
  AgentListRowReveal,
  useAgentListReveal,
} from "@/features/agents/components/agent-list-reveal";
import { AgentListRow } from "@/features/agents/components/agent-list-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { PinnedAgentsGrid } from "@/features/agents/components/pinned-agents-grid";
import { ChannelListRow } from "@/features/channels/components/channel-list";
import { useChannels } from "@/features/channels/components/use-channels";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import { ConnectionHeaderStatus } from "@/features/workspace/components/connection-header-status";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useAppLoadingOverlay } from "@/shared/components/app-loading-overlay";
import { isAndroid, isIOS } from "@/shared/lib/platform";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const ROW_ENTER = FadeIn.duration(180).easing(EASE_IN_OUT).reduceMotion(ReduceMotion.System);
const ROW_EXIT = FadeOut.duration(120).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
// Agent search is not available in the current mobile release, so keep its entry points hidden until it is ready.
const IS_AGENT_SEARCH_ENABLED = false;

function TransitioningChatRow({
  chatId,
  children,
  index,
  reveal,
}: {
  chatId: string;
  children: React.ReactNode;
  index: number;
  reveal: AgentListRevealState;
}) {
  const { transition } = useAgentPinTransition();
  const isTarget = transition?.chatId === chatId && transition.target === "row";
  const isSource = transition?.chatId === chatId && transition.source === "row";

  return (
    <Animated.View entering={isTarget ? ROW_ENTER : undefined} exiting={isSource ? ROW_EXIT : undefined}>
      <AgentListRowReveal index={index} reveal={reveal} skip={isTarget}>
        {children}
      </AgentListRowReveal>
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
  const isFocused = useIsFocused();
  const { setLoadingLabel, isLoaderPresent } = useAppLoadingOverlay();
  const { openDrawer } = useAppDrawer();
  const {
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
  useLayoutEffect(() => {
    if (!isFocused) return;
    setLoadingLabel(showLoader ? (hasSelectedServer ? "Connecting to server" : "Loading your servers") : null);
    return () => setLoadingLabel(null);
  }, [hasSelectedServer, isFocused, setLoadingLabel, showLoader]);
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
  const unpinnedAgents = activeAgents.filter((agent) => !pinnedAgentIds.includes(agent.id));
  const items: ({ kind: "agent"; agent: MobileAgent } | { kind: "channel"; channel: ChannelSummary })[] = [
    ...channels.channels
      .filter(
        (channel) =>
          !hiddenChannelIds.includes(channel.id) && !channel.archived && !pinnedChannelIds.includes(channel.id),
      )
      .map((channel) => ({ kind: "channel" as const, channel })),
    ...unpinnedAgents.map((agent) => ({ kind: "agent" as const, agent })),
  ];
  const listReveal = useAgentListReveal(listReady, items.length + (hasPins ? 1 : 0));
  const optionsActions = useMemo<MenuAction[]>(
    () => [
      { id: "add-agent", title: "Add agent" },
      ...(channels.supported ? [{ id: "add-channel", title: "New channel" }] : []),
      ...(hasHiddenChats ? [{ id: "hidden-chats", title: "Hidden chats" }] : []),
    ],
    [hasHiddenChats, channels.supported],
  );

  return (
    <View className="flex-1 bg-background">
      {listReady ? (
        <FlatList
          className="flex-1 bg-background"
          alwaysBounceVertical={false}
          contentContainerClassName={items.length > 0 ? "pb-safe-offset-8 pt-3" : "grow pb-safe-offset-8 pt-3"}
          // Keep the native header inset even when short content cannot scroll or bounce.
          contentInsetAdjustmentBehavior="always"
          data={items}
          keyExtractor={(item) => (item.kind === "agent" ? `agent:${item.agent.id}` : `channel:${item.channel.id}`)}
          renderItem={({ item, index }) => (
            <TransitioningChatRow
              chatId={item.kind === "agent" ? item.agent.id : item.channel.id}
              index={index + (hasPins ? 1 : 0)}
              reveal={listReveal}
            >
              {item.kind === "channel" ? (
                <ChannelListRow channel={item.channel} serverId={activeServer.id} agents={channelAgents} />
              ) : (
                <AgentListRow agent={item.agent} leftInset={15} rightInset={24} />
              )}
            </TransitioningChatRow>
          )}
          ListHeaderComponent={
            <AgentListRowReveal index={0} reveal={listReveal}>
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
