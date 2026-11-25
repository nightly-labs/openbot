import {
  agentFolderName,
  agentFolderParent,
  CHANNEL_FOLDER_LIMIT,
  type ChannelFolderChange,
  type ChannelFolderList,
} from "@openbot/contracts/ipc";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Folder from "lucide-react-native/icons/folder";
import Plus from "lucide-react-native/icons/plus";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useState } from "react";
import { Alert, View } from "react-native";
import {
  alertFolderFailure,
  FolderBrowserListing,
  FolderRowAction,
  useTypedHostFolder,
} from "@/features/agents/components/agent-folders";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

export interface ChannelFolderTarget {
  serverId: string;
  channelId: string;
  name: string;
}

function useChannelFolders(serverId: string, channelId: string, enabled: boolean) {
  const { canManageChannelFolders, loadChannelFolders } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const queryKey = queryKeys.channelInfo(queryScope, serverId, channelId, "folders");
  const query = useQuery({
    queryKey,
    queryFn: () => loadChannelFolders(channelId, serverId),
    enabled: enabled && canManageChannelFolders(serverId),
    retry: false,
    staleTime: 0,
  });
  return { query, queryKey };
}

function alertChannelFolderFailure(cause: unknown) {
  alertFolderFailure(cause, "team");
}

export function ChannelFoldersRow({
  serverId,
  channelId,
  available,
  disabled,
}: {
  serverId: string;
  channelId: string;
  available: boolean;
  disabled: boolean;
}) {
  const { t } = useText();
  const { query } = useChannelFolders(serverId, channelId, available);
  const list = query.data;
  const lost = list?.folders.filter((folder) => !folder.found).length ?? 0;
  const value = list
    ? [
        list.folders.length > 0
          ? t("mobile.agent.folders.valueCount", { count: list.folders.length })
          : t("mobile.agent.folders.valueNone"),
        ...(lost > 0 ? [t("mobile.agent.folders.valueMissing", { count: lost })] : []),
      ].join(" · ")
    : undefined;
  return (
    <SettingsRow
      leading={<RowIcon icon={Folder} />}
      supportingText={value}
      disabled={disabled}
      onPress={() => router.push({ pathname: "/channel-info/[channelId]/folders", params: { channelId, serverId } })}
    >
      <Typography.Paragraph>{t("mobile.agent.folders.title")}</Typography.Paragraph>
    </SettingsRow>
  );
}

export function ChannelFolders({ channel, available }: { channel: ChannelFolderTarget; available: boolean }) {
  const { t } = useText();
  const { removeChannelFolder } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const { query, queryKey } = useChannelFolders(channel.serverId, channel.channelId, available);
  const muted = String(useThemeColor("muted"));
  const warning = String(useThemeColor("warning"));
  const [busy, setBusy] = useState(false);

  if (!available) return null;
  if (query.isPending) return <Typography.Paragraph>{t("mobile.agent.folders.loading")}</Typography.Paragraph>;
  if (query.isError)
    return (
      <View className="gap-2">
        <Typography.Paragraph accessibilityRole="alert">{t("mobile.agent.folders.readFailed")}</Typography.Paragraph>
        <Button variant="ghost" onPress={() => void query.refetch()}>
          <Button.Label>{t("mobile.agent.folders.retry")}</Button.Label>
        </Button>
      </View>
    );
  const list = query.data;

  async function remove(path: string) {
    setBusy(true);
    try {
      const changed = await removeChannelFolder({ channelId: channel.channelId, path }, channel.serverId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, changed.list);
      void haptics.notification("success");
    } catch (cause) {
      alertChannelFolderFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(path: string) {
    const folder = agentFolderName(path);
    Alert.alert(
      t("mobile.agent.folders.removeTitle", { folder }),
      t("mobile.channel.folders.removeBody", { channel: channel.name, folder }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.remove"), style: "destructive", onPress: () => void remove(path) },
      ],
    );
  }

  return (
    <SettingsSection
      title={t("mobile.agent.folders.added")}
      footer={t("mobile.channel.folders.description", { channel: channel.name })}
    >
      {list.folders.map((folder) => {
        const name = agentFolderName(folder.path);
        return (
          <SettingsRow
            key={folder.path}
            disabled={busy}
            leading={folder.found ? <Folder size={18} color={muted} /> : <TriangleAlert size={18} color={warning} />}
            supportingText={
              folder.found
                ? agentFolderParent(folder.path)
                : t("mobile.agent.folders.notFound", { path: agentFolderParent(folder.path) })
            }
            trailing={
              <FolderRowAction
                label={t("mobile.agent.folders.remove", { folder: name })}
                disabled={busy}
                onPress={() => confirmRemove(folder.path)}
              />
            }
          >
            <Typography.Paragraph numberOfLines={1}>{name}</Typography.Paragraph>
          </SettingsRow>
        );
      })}
      <SettingsRow
        disabled={busy || list.folders.length >= CHANNEL_FOLDER_LIMIT}
        disclosure={false}
        leading={<Plus size={18} color={muted} />}
        onPress={() =>
          router.push({
            pathname: "/channel-info/[channelId]/folder-browser",
            params: { channelId: channel.channelId, serverId: channel.serverId },
          })
        }
      >
        <Typography.Paragraph>{t("mobile.agent.folders.add")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function folderRefusal(change: ChannelFolderChange): string | null {
  const text = currentText();
  if (change.outcome === "covered") {
    const folder = agentFolderName(change.path);
    return change.folder === change.path
      ? text.t("mobile.agent.folders.alreadyAdded", { folder })
      : text.t("mobile.agent.folders.inFolder", { folder, parent: agentFolderName(change.folder) });
  }
  if (change.outcome !== "refused") return null;
  const folder = agentFolderName(change.path);
  if (change.refusal === "limit") return text.t("mobile.agent.folders.limit", { count: CHANNEL_FOLDER_LIMIT });
  if (change.refusal === "protected") return text.t("mobile.agent.folders.protected", { folder });
  return text.t("mobile.agent.folders.missing", { folder });
}

export function ChannelFolderBrowser({ channel, available }: { channel: ChannelFolderTarget; available: boolean }) {
  const { t } = useText();
  const params = useLocalSearchParams<{ path?: string }>();
  const path = params.path || null;
  const { browseChannelFolders, addChannelFolder, canManageChannelFolders } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const foldersKey = queryKeys.channelInfo(queryScope, channel.serverId, channel.channelId, "folders");
  const query = useQuery({
    queryKey: queryKeys.channelFolderBrowse(queryScope, channel.serverId, channel.channelId, path),
    queryFn: () => browseChannelFolders(channel.channelId, path, channel.serverId),
    enabled: available && canManageChannelFolders(channel.serverId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
  const [saving, setSaving] = useState(false);
  const typed = useTypedHostFolder(query);
  const moving = query.isPlaceholderData;

  function go(next: string) {
    router.setParams<"/channel-info/[channelId]/folder-browser">({ path: next });
  }

  async function choose(): Promise<void> {
    const target = typed.target;
    if (!target || moving || saving) return;
    setSaving(true);
    try {
      const change = await addChannelFolder({ channelId: channel.channelId, path: target }, channel.serverId);
      await queryClient.cancelQueries({ queryKey: foldersKey, exact: true });
      queryClient.setQueryData<ChannelFolderList>(foldersKey, change.list);
      const refusal = folderRefusal(change);
      if (refusal) {
        void haptics.notification("warning");
        Alert.alert(t("mobile.agent.folders.notAddedTitle"), refusal);
        return;
      }
      void haptics.notification("success");
      router.dismissTo({
        pathname: "/channel-info/[channelId]/folders",
        params: { channelId: channel.channelId, serverId: channel.serverId },
      });
    } catch (cause) {
      alertChannelFolderFailure(cause);
    } finally {
      setSaving(false);
    }
  }

  if (!available) return null;
  return (
    <>
      <SheetSaveAction
        dirty
        canSave={Boolean(typed.target) && !moving}
        pending={saving}
        label={t("mobile.agent.folders.addHere")}
        onSave={() => void choose()}
      />
      <FolderBrowserListing query={query} path={path} typed={typed} busy={saving} onGo={go} />
    </>
  );
}
