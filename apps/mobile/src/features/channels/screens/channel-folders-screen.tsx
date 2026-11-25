import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { ChannelFolderBrowser, ChannelFolders } from "@/features/channels/components/channel-folders";
import { useChannels } from "@/features/channels/components/use-channels";
import { SettingsContent } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export function ChannelFoldersScreen({ page }: { page: "folders" | "folder-browser" }) {
  const { t } = useText();
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  const canManage = useMobileWorkspaceSelector((current) => current.canManageChannelFolders(serverId));
  const { channels } = useChannels(serverId);
  const channel = channels.find((candidate) => candidate.id === channelId && !candidate.archived);
  const available = canManage && Boolean(channel);
  const target = channel ? { serverId, channelId, name: channel.name } : null;
  return (
    <SettingsContent>
      {!available ? <Typography.Paragraph>{t("mobile.channel.records.connect")}</Typography.Paragraph> : null}
      {target && page === "folders" ? <ChannelFolders channel={target} available={available} /> : null}
      {target && page === "folder-browser" ? <ChannelFolderBrowser channel={target} available={available} /> : null}
    </SettingsContent>
  );
}
