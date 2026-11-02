import type { ChannelSummary } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { Link, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { ChannelAvatar } from "../components/channel-avatar";
import { useChannels } from "../components/use-channels";

export function DeletedChatsScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === serverId));
  const foreground = useThemeColor("foreground");
  const state = useChannels(serverId);
  const deleted = state.channels.filter((channel) => channel.archived);
  const members = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent])),
    [agents, serverId],
  );
  const online = showsOnline(server);
  // As on desktop, the people who can delete a channel can restore it. The host checks the role again.
  const canRestore = online && server?.role !== "member" && state.canDelete;
  const [restoring, setRestoring] = useState<string | null>(null);
  const pending = useRef(false);
  const restore = (channel: ChannelSummary) => {
    if (pending.current) return;
    pending.current = true;
    setRestoring(channel.id);
    void state.store
      .command(serverId, { type: "restore", operationId: Crypto.randomUUID(), channelId: channel.id })
      .then(() => haptics.notification())
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "team",
          text.t("mobile.channel.deleted.restoreFailed"),
          text.errorMessage(cause, text.t("mobile.channel.deleted.restoreFailedBody")),
        );
      })
      .finally(() => {
        pending.current = false;
        setRestoring(null);
      });
  };
  return (
    <SheetScrollView contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-7">
      {/* A sheet of the home menu, as Hidden chats: it has no native header. */}
      <View className="items-center gap-2 px-4">
        <Typography.Heading type="h4" align="center">
          {t("mobile.app.route.deletedChannels")}
        </Typography.Heading>
        <Typography.Paragraph type="body-xs" align="center" className="text-text-secondary">
          {t("mobile.channel.deleted.note")}
        </Typography.Paragraph>
      </View>
      {state.error ? (
        <Typography.Paragraph accessibilityRole="alert">
          {errorMessage(state.error.cause, t("mobile.channel.loadFailed"))}
        </Typography.Paragraph>
      ) : null}
      {!deleted.length ? (
        <Typography.Paragraph>
          {t(state.loading ? "mobile.channel.deleted.loading" : "mobile.channel.deleted.empty")}
        </Typography.Paragraph>
      ) : (
        <View className="overflow-hidden rounded-3xl bg-control">
          {deleted.map((channel) => (
            <View key={channel.id} className="min-h-18 flex-row items-center gap-2 px-3 py-2">
              <Link
                href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }}
                asChild
                dismissTo
                onPress={() => {
                  void haptics.impact("soft");
                }}
              >
                <Link.Trigger>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("mobile.channel.deleted.preview", { name: channel.name })}
                    className="min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl px-1 py-1"
                    style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
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
                </Link.Trigger>
              </Link>
              {canRestore ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.channel.deleted.restoreNamed", { name: channel.name })}
                  accessibilityState={{ busy: restoring === channel.id, disabled: restoring !== null }}
                  disabled={restoring !== null}
                  className="min-h-10 flex-row items-center gap-1.5 rounded-full bg-control-active px-3"
                  style={{ opacity: restoring !== null && restoring !== channel.id ? 0.5 : 1 }}
                  onPress={() => restore(channel)}
                >
                  <RotateCcw color={String(foreground)} size={16} strokeWidth={1.9} />
                  <Typography.Paragraph type="body-xs" weight="semibold">
                    {t("mobile.channel.deleted.restore")}
                  </Typography.Paragraph>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </SheetScrollView>
  );
}
