import { type Href, Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Eye } from "lucide-react-native";
import { type ReactNode, useMemo } from "react";
import { Pressable, View } from "react-native";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { useChannels } from "@/features/channels/components/use-channels";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";

export function HiddenChatsScreen() {
  const { hiddenAgents, unhideAgent, agents, activeServer, hiddenChannelIds, unhideChannel } = useMobileWorkspace();
  const channels = useChannels(activeServer.id);
  const hiddenChannels = channels.channels.filter((channel) => hiddenChannelIds.includes(channel.id));
  const members = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === activeServer.id).map((agent) => [agent.id, agent])),
    [agents, activeServer.id],
  );
  const foreground = useThemeColor("foreground");
  const total = hiddenAgents.length + hiddenChannels.length;
  const items: { id: string; name: string; href: Href; avatar: ReactNode; show: () => void }[] = [
    ...hiddenAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      href: { pathname: "/chat/[agentId]" as const, params: { agentId: agent.id } },
      avatar: (
        <BloubAvatar agentId={agent.id} hue={agent.avatarHue} seed={agent.avatarSeed} size={46} animateIdle={false} />
      ),
      show: () => {
        unhideAgent(agent.id);
        void haptics.notification();
        if (total === 1) router.back();
      },
    })),
    ...hiddenChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      href: { pathname: "/channel/[channelId]" as const, params: { channelId: channel.id, serverId: activeServer.id } },
      avatar: (
        <ChannelAvatar channel={channel} agents={members} size={46} disconnected={activeServer.state !== "online"} />
      ),
      show: () => {
        if (!unhideChannel(channel.id, activeServer.id)) return;
        void haptics.notification();
        if (total === 1) router.back();
      },
    })),
  ];

  return (
    <SheetScrollView contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-7">
      <View className="items-center gap-2 px-4">
        <Typography.Heading type="h4" align="center">
          Hidden chats
        </Typography.Heading>
        <Typography.Paragraph type="body-xs" align="center" className="text-text-secondary">
          Hidden chats keep working. They&apos;re just not shown on the home screen.
        </Typography.Paragraph>
      </View>

      <View className="overflow-hidden rounded-3xl bg-control">
        {items.map((item) => (
          <View key={item.id} className="min-h-18 flex-row items-center gap-2 px-3 py-2">
            <Link
              href={item.href}
              asChild
              dismissTo
              onPress={() => {
                void haptics.impact("soft");
              }}
            >
              <Link.Trigger>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat with ${item.name}`}
                  className="min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl px-1 py-1"
                  style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
                >
                  {item.avatar}
                  <Typography.Paragraph className="min-w-0 flex-1" weight="semibold" numberOfLines={1}>
                    {item.name}
                  </Typography.Paragraph>
                </Pressable>
              </Link.Trigger>
            </Link>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.name}`}
              className="min-h-10 flex-row items-center gap-1.5 rounded-full bg-control-active px-3"
              onPress={item.show}
            >
              <Eye color={String(foreground)} size={16} strokeWidth={1.9} />
              <Typography.Paragraph type="body-xs" weight="semibold">
                Show
              </Typography.Paragraph>
            </Pressable>
          </View>
        ))}
      </View>
    </SheetScrollView>
  );
}
