import { Link, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";
import { ChannelAvatar } from "../components/channel-avatar";
import { useChannels } from "../components/use-channels";

export function DeletedChatsScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { agents, servers } = useMobileWorkspace();
  const state = useChannels(serverId);
  const deleted = state.channels.filter((channel) => channel.archived);
  const members = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent])),
    [agents, serverId],
  );
  const online = servers.some((server) => server.id === serverId && server.state === "online");
  return (
    <SheetScrollView contentContainerClassName="gap-5 px-5 pt-5 pb-safe-offset-5">
      <Typography.Paragraph className="text-text-secondary">{t("mobile.channel.deleted.note")}</Typography.Paragraph>
      {state.error ? (
        <Typography.Paragraph accessibilityRole="alert">
          {errorMessage(state.error.cause, t("mobile.channel.loadFailed"))}
        </Typography.Paragraph>
      ) : null}
      {!deleted.length ? (
        <Typography.Paragraph>
          {t(state.loading ? "mobile.channel.deleted.loading" : "mobile.channel.deleted.empty")}
        </Typography.Paragraph>
      ) : null}
      <View className="overflow-hidden rounded-3xl bg-control">
        {deleted.map((channel) => (
          <Link
            key={channel.id}
            href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }}
            asChild
            dismissTo
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.channel.deleted.preview", { name: channel.name })}
              className="min-h-18 flex-row items-center gap-3 px-3 py-3"
            >
              <ChannelAvatar channel={channel} agents={members} size={46} disconnected={!online} />
              <View className="min-w-0 flex-1 gap-1">
                <Typography.Paragraph weight="semibold" numberOfLines={1}>
                  {channel.name}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
                  {channel.lastMessage?.text ?? t("mobile.channel.list.noMessages")}
                </Typography.Paragraph>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
    </SheetScrollView>
  );
}
