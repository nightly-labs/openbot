import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Link } from "expo-router";
import { memo, type ReactNode, useMemo } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentWaitBadge } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { useAgentWaitReason } from "@/features/workspace/components/use-agent-activity";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileSidebarItem } from "@/features/workspace/model/sidebar-layout";
import { useBarTop } from "@/shared/lib/native-bar";
import { useText } from "@/shared/lib/text";

const AVATAR_SIZE = 44;
const RAIL_BATCH = 16;
const RAIL_WINDOW_SIZE = 5;

type RailEntry =
  | { kind: "agent"; key: string; agent: MobileAgent }
  | { kind: "channel"; key: string; channel: ChannelSummary }
  | { kind: "divider"; key: string };

/**
 * The avatars in the order of the list: the pinned chats, then each section. A section or the waiting
 * group starts with a divider; the first one has a divider only below the pins.
 */
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

function RailUnreadDot() {
  return <View pointerEvents="none" className="absolute top-1 right-1 size-2.5 rounded-full bg-accent" />;
}

const RailAgent = memo(function RailAgent({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const background = useChatRowBackground(agent.id);
  const unread = useAgentUnread(agent.id);
  const waitReason = useAgentWaitReason(agent.id);
  return (
    <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
      <ChatLinkPressable
        chatId={agent.id}
        accessibilityRole="button"
        accessibilityLabel={t("mobile.agent.list.open", { name: agent.name })}
        className="size-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: background, borderCurve: "continuous" }}
      >
        <View>
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={AVATAR_SIZE}
            animateIdle={false}
            rings
          />
          {waitReason ? <AgentWaitBadge reason={waitReason} size={16} /> : null}
        </View>
        {unread && !waitReason ? <RailUnreadDot /> : null}
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
        <ChannelAvatar channel={channel} agents={agents} size={AVATAR_SIZE} />
        {unread ? <RailUnreadDot /> : null}
      </ChatLinkPressable>
    </Link>
  );
});

function RailDivider() {
  return <View className="my-1.5 h-px w-8 bg-border" />;
}

/**
 * The chat list pane collapsed to the avatars of its chats, in the order of the list: the pinned chats,
 * then each section. The detail column gets the room. A divider marks where the pins and each section
 * start; the names show in the accessibility labels.
 */
export function ChatListRail({
  header,
  pinnedAgents,
  pinnedChannels,
  items,
  serverId,
  channelAgents,
  headerHeight,
}: {
  /** The button that opens the servers, as the bar of the full list has. */
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
      <View className="items-center justify-center" style={{ marginTop: barTop, height: headerHeight }}>
        {header}
      </View>
      {/* Virtualized: the rail stays mounted under the full list, so it renders only the avatars
          near the screen, however many chats the server has. */}
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
      />
    </View>
  );
}
