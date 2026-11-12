import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useMemo, useRef, useState } from "react";
import { ChannelPictureEditor } from "@/features/channels/components/channel-picture-editor";
import { useChannels } from "@/features/channels/components/use-channels";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";

/** The channel picture route of Channel info. Each choice saves at once, so the screen has no save action. */
export function ChannelPictureScreen() {
  const { t } = useText();
  const params = useLocalSearchParams<{ serverId?: string; channelId?: string }>();
  const workspace = useMobileWorkspaceReader();
  const [serverId] = useState(params.serverId ?? workspace().activeServer.id);
  const channelId = params.channelId ?? "";
  const state = useChannels(serverId);
  const current = state.channels.find((channel) => channel.id === channelId);
  const last = useRef(current);
  if (current) last.current = current;
  const channel = current ?? last.current;
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const agentsById = useMemo(
    () => new Map(agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent])),
    [agents, serverId],
  );
  return (
    <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pt-5 pb-safe-offset-5">
      {channel ? (
        <ChannelPictureEditor
          channel={channel}
          serverId={serverId}
          agents={agentsById}
          store={state.store}
          disabled={!state.supported || !state.canSetPicture || !online || !current || channel.archived}
        />
      ) : (
        <Typography.Paragraph>
          {t(state.loading ? "mobile.channel.form.loading" : "mobile.channel.form.gone")}
        </Typography.Paragraph>
      )}
      {channel && (!online || !current) ? (
        <Typography.Paragraph>{t("mobile.channel.form.unavailable")}</Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
