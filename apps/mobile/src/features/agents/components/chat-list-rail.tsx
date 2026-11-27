import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Link } from "expo-router";
import { memo, type ReactNode, useMemo } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentUnreadBadge } from "@/features/agents/components/agent-unread-badge";
import { AgentWaitBadge, agentListStateLabel } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import {
  agentListWaitReason,
  useAgentListActivity,
  useAgentListUnreadCount,
  useAgentListUnreadThreads,
} from "@/features/workspace/components/use-agent-activity";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import type { MobileSidebarItem } from "@/features/workspace/model/sidebar-layout";
import { CornerSafeArea } from "@/shared/components/corner-safe-area";
import { useBarTop } from "@/shared/lib/native-bar";
import { useText } from "@/shared/lib/text";

const AVATAR_SIZE = 44;
const RAIL_BATCH = 16;
const RAIL_WINDOW_SIZE = 5;

type RailEntry =
  | { kind: "agent"; key: string; agent: MobileAgent }
  | { kind: "channel"; key: string; channel: ChannelSummary }
  | { kind: "divider"; key: string };

function railEntries(
  pinnedAgents: readonly MobileAgent[],
  pinnedChannels: readonly ChannelSummary[],
  items: readonly MobileSidebarItem[],
): RailEntry[] {
  const entries: RailEntry[] = [
    ...pinnedAgents.map((agent): RailEntry => ({ kind: "agent", key: `pin:${agent.id}`, agent })),
    ...pinnedChannels.map((channel): RailEntry => ({ kind: "channel", key: `pin:${channel.id}`, channel })),
  ];
  for (const item of items) {
    if (item.kind === "agent") entries.push({ kind: "agent", key: `agent:${item.id}`, agent: item.agent });
    else if (item.kind === "channel")
      entries.push({ kind: "channel", key: `channel:${item.id}`, channel: item.channel });
    else if (entries.length > 0) entries.push({ kind: "divider", key: `${item.kind}:${item.id}` });
  }
  return entries;
}

function railEntryKey(entry: RailEntry): string {
  return entry.key;
}

const RailAgent = memo(function RailAgent({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const background = useChatRowBackground(agent.id);
  const unreadCount = useAgentListUnreadCount(agent.id);
  const unreadThreads = useAgentListUnreadThreads(agent.id);
  const openLabel = t("mobile.agent.list.open", { name: agent.name });
  const activity = useAgentListActivity(agent.id);
  const waitReason = agentListWaitReason(activity);
  return (
    <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } }} asChild>
      <ChatLinkPressable
        chatId={agent.id}
        accessibilityRole="button"
        accessibilityLabel={agentListStateLabel(t, openLabel, undefined, unreadCount, unreadThreads)}
        className="size-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: background, borderCurve: "continuous" }}
      >
        <View>
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            color={agent.avatarColor}
            seed={agent.avatarSeed}
            avatarUrl={agent.avatarUrl}
            size={AVATAR_SIZE}
            animateIdle={false}
            rings
            activityMood={agentActivityMood(activity)}
          />
          {waitReason ? (
            <AgentWaitBadge reason={waitReason} size={16} />
          ) : unreadCount > 0 || unreadThreads ? (
            <AgentUnreadBadge count={unreadCount} avatarSize={AVATAR_SIZE} ringColor={background} />
          ) : null}
        </View>
      </ChatLinkPressable>
    </Link>
  );
});

const RailChannel = memo(function RailChannel({
  channel,
  serverId,
  agents,
}: {
  channel: ChannelSummary;
  serverId: string;
  agents: ReadonlyMap<string, MobileAgent>;
}) {
  const { t } = useText();
  const background = useChatRowBackground(channel.id);
  const unread = channel.unreadCount > 0;
  const openLabel = t("mobile.channel.list.open", { name: channel.name });
  return (
    <Link href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }} asChild>
      <ChatLinkPressable
        chatId={channel.id}
        accessibilityRole="button"
        accessibilityLabel={
          unread ? `${openLabel}, ${t("mobile.channel.list.unread", { count: channel.unreadCount })}` : openLabel
        }
        className="size-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: background, borderCurve: "continuous" }}
      >
        <View>
          <ChannelAvatar channel={channel} agents={agents} size={AVATAR_SIZE} serverId={serverId} />
          {unread ? (
            <AgentUnreadBadge count={channel.unreadCount} avatarSize={AVATAR_SIZE} ringColor={background} />
          ) : null}
        </View>
      </ChatLinkPressable>
    </Link>
  );
});

function RailDivider() {
  return <View className="my-1.5 h-px w-8 bg-border" />;
}

export function ChatListRail({
  header,
  pinnedAgents,
  pinnedChannels,
  items,
  serverId,
  channelAgents,
  headerHeight,
}: {
  header: ReactNode;
  pinnedAgents: readonly MobileAgent[];
  pinnedChannels: readonly ChannelSummary[];
  items: readonly MobileSidebarItem[];
  serverId: string;
  channelAgents: ReadonlyMap<string, MobileAgent>;
  headerHeight: number;
}) {
  const insets = useSafeAreaInsets();
  const barTop = useBarTop();
  const entries = useMemo(
    () => railEntries(pinnedAgents, pinnedChannels, items),
    [pinnedAgents, pinnedChannels, items],
  );
  return (
    <View className="flex-1 bg-background" style={{ paddingLeft: insets.left }}>
      <CornerSafeArea cornerAdaptation="vertical" style={{ flex: 0, marginTop: barTop }}>
        {(headerInsets) => (
          <View className="items-center justify-center" style={{ marginTop: headerInsets.top, height: headerHeight }}>
            {header}
          </View>
        )}
      </CornerSafeArea>
      <FlatList
        className="flex-1"
        data={entries}
        keyExtractor={railEntryKey}
        renderItem={({ item }) =>
          item.kind === "agent" ? (
            <RailAgent agent={item.agent} />
          ) : item.kind === "channel" ? (
            <RailChannel channel={item.channel} serverId={serverId} agents={channelAgents} />
          ) : (
            <RailDivider />
          )
        }
        initialNumToRender={RAIL_BATCH}
        maxToRenderPerBatch={RAIL_BATCH}
        windowSize={RAIL_WINDOW_SIZE}
        contentContainerClassName="items-center gap-1"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
      />
    </View>
  );
}
