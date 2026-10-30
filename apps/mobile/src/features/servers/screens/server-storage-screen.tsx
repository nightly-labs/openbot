import {
  CLEARABLE_STORAGE_CATEGORIES,
  type ClearableStorageCategory,
  canAdministerServer,
  type StorageCategory,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { Size, StoredFile } from "@/features/agents/components/agent-files";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { StorageRing } from "@/features/servers/components/storage-ring";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { useServerStorage } from "@/features/servers/model/use-server-storage";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

/** The groups and the colors of the desktop storage bar, in its fixed order, so a group keeps its color. */
const GROUPS = ["workspaces", "files", "chats", "downloads", "runtimes", "app"] as const;
type StorageGroup = (typeof GROUPS)[number];
const GROUP_OF: Record<StorageCategory, StorageGroup> = {
  workspaces: "workspaces",
  attachments: "files",
  generated: "files",
  chats: "chats",
  downloads: "downloads",
  caches: "app",
  runtimes: "runtimes",
  logs: "app",
};
const GROUP_LABELS: Record<StorageGroup, MobileTextKey> = {
  workspaces: "mobile.server.storage.group.workspaces",
  files: "mobile.server.storage.group.files",
  chats: "mobile.server.storage.group.chats",
  downloads: "mobile.server.storage.group.downloads",
  runtimes: "mobile.server.storage.category.runtimes",
  app: "mobile.server.storage.group.app",
};
const CLEARABLE_LABELS: Record<ClearableStorageCategory, MobileTextKey> = {
  caches: "mobile.server.storage.category.caches",
  logs: "mobile.server.storage.category.logs",
};
const CLEAR_CONFIRM: Record<ClearableStorageCategory, { title: MobileTextKey; body: MobileTextKey }> = {
  caches: { title: "mobile.server.storage.clearTitle.caches", body: "mobile.server.storage.clearBody.caches" },
  logs: { title: "mobile.server.storage.clearTitle.logs", body: "mobile.server.storage.clearBody.logs" },
};
const LARGEST_CHATS = 5;

/**
 * Server sheet > Storage: how much space OpenBot takes on the host, which agents and chats take it,
 * and every stored file, like Server Settings > Storage on desktop. Every member reads it; an owner
 * or admin also clears caches and logs. Chats and workspaces are never cleared from here.
 */
export function ServerStorageScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, agents } = useMobileWorkspace();
  const { clearServerStorage } = useMobileWorkspaceActions();
  const server = servers.find((item) => item.id === serverId);
  const { available, query, rescan } = useServerStorage(serverId);
  const groupColor = useStorageGroupColors();
  const [selectedGroup, setSelectedGroup] = useState<StorageGroup | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [clearing, setClearing] = useState<ClearableStorageCategory | null>(null);
  if (!server || !available)
    return (
      <SettingsContent>
        <SettingsNote>
          {t(server ? "mobile.workspace.error.filesUnsupported" : "mobile.server.unavailable")}
        </SettingsNote>
      </SettingsContent>
    );
  const usage = query.data;
  const busy = measuring || query.isFetching;
  const agentName = (agentId: string) =>
    agents.find((agent) => agent.id === agentId && agent.serverId === serverId)?.name ??
    t("mobile.server.storage.removedAgent");

  function measure() {
    if (busy) return;
    setMeasuring(true);
    rescan()
      .catch(() => undefined)
      .finally(() => setMeasuring(false));
  }

  function confirmClear(category: ClearableStorageCategory) {
    Alert.alert(t(CLEAR_CONFIRM[category].title), t(CLEAR_CONFIRM[category].body), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.server.storage.clear"),
        style: "destructive",
        onPress: () => {
          setClearing(category);
          clearServerStorage(category, serverId)
            .then(() => {
              void haptics.notification("success");
            })
            .catch((cause: unknown) => {
              void haptics.notification("error");
              const text = currentText();
              showFailureAlert(
                cause,
                "maintenance",
                text.t("mobile.server.storage.clearFailed"),
                text.errorMessage(cause, text.t("mobile.server.storage.clearFailedBody")),
              );
            })
            .finally(() => {
              setClearing(null);
              measure();
            });
        },
      },
    ]);
  }

  const measureAction = <MeasureAction disabled={busy} onPress={measure} />;
  if (!usage)
    return (
      <SettingsContent>
        {measureAction}
        <SettingsSection
          footer={query.isError ? errorMessage(query.error, t("mobile.server.storage.loadFailed")) : undefined}
        >
          {query.isError ? (
            <SettingsRow disclosure={false} disabled={busy} onPress={measure}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.storage.retry")}</Typography.Paragraph>
            </SettingsRow>
          ) : (
            <SettingsRow disclosure={false}>
              <Typography.Paragraph className="text-grouped-secondary">
                {t("mobile.server.storage.measuring")}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      </SettingsContent>
    );

  const total = usage.breakdown.reduce((sum, entry) => sum + entry.bytes, 0);
  const groups = GROUPS.map((group) => ({
    key: group,
    label: t(GROUP_LABELS[group]),
    color: groupColor[group],
    bytes: usage.breakdown
      .filter((entry) => GROUP_OF[entry.category] === group)
      .reduce((sum, entry) => sum + entry.bytes, 0),
  })).filter((group) => group.bytes > 0);
  // A group that a new measurement leaves empty is no longer selected.
  const selected = groups.find((group) => group.key === selectedGroup);
  const agentRows = [...usage.agents].sort((left, right) => right.bytes - left.bytes);
  const chats = [...usage.conversations].sort((left, right) => right.bytes - left.bytes).slice(0, LARGEST_CHATS);
  const filesBytes = usage.files.reduce((sum, file) => sum + file.size, 0);
  const removable = canAdministerServer(server.role)
    ? usage.breakdown.flatMap((entry) =>
        entry.removable && entry.bytes > 0 && isOneOf(CLEARABLE_STORAGE_CATEGORIES, entry.category)
          ? [{ category: entry.category, bytes: entry.bytes }]
          : [],
      )
    : [];
  const removableBytes = removable.reduce((sum, entry) => sum + entry.bytes, 0);

  return (
    <SettingsContent>
      {measureAction}
      <SettingsSection
        title={t("mobile.server.storage.total", { name: server.name })}
        footer={
          query.isError
            ? errorMessage(query.error, t("mobile.server.storage.loadFailed"))
            : usage.freeBytes !== null
              ? t("mobile.server.storage.free", { size: format.fileSize(usage.freeBytes) })
              : undefined
        }
      >
        {groups.length ? (
          <StorageRing
            segments={groups}
            selected={selected?.key ?? null}
            value={format.fileSize(selected?.bytes ?? total)}
            caption={selected?.label ?? t("mobile.server.storage.used")}
            label={`${t("mobile.server.storage.byType")}: ${groups.map((group) => `${group.label} ${format.fileSize(group.bytes)}`).join(", ")}`}
          />
        ) : null}
        {groups.map((group) => (
          <SettingsRow
            key={group.key}
            disclosure={false}
            checked={selected?.key === group.key}
            onPress={() => setSelectedGroup((current) => (current === group.key ? null : group.key))}
            leading={<View className="size-3 rounded-full" style={{ backgroundColor: group.color }} />}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary">
                {`${format.fileSize(group.bytes)} · ${format.percent(sharePercent(group.bytes, total) / 100, { maximumFractionDigits: 1 })}`}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph numberOfLines={1}>{group.label}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {!groups.length ? (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.storage.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {agentRows.length ? (
        <SettingsSection title={t("mobile.server.storage.agents")}>
          {agentRows.map((row) => {
            const agent = agents.find((item) => item.id === row.agentId && item.serverId === serverId);
            return (
              <SettingsRow
                key={row.agentId}
                leading={
                  <BloubAvatar
                    agentId={row.agentId}
                    serverId={serverId}
                    hue={agent?.avatarHue ?? null}
                    seed={agent?.avatarSeed ?? row.agentId}
                    size={36}
                    animateIdle={false}
                  />
                }
                supportingText={`${t("mobile.agent.files.fileCount", { count: row.fileCount })} · ${t("mobile.server.storage.chatCount", { count: row.conversationCount })}`}
                trailing={<Size bytes={row.bytes} />}
              >
                <Typography.Paragraph numberOfLines={1}>{agentName(row.agentId)}</Typography.Paragraph>
              </SettingsRow>
            );
          })}
        </SettingsSection>
      ) : null}
      {chats.length ? (
        <SettingsSection title={t("mobile.server.storage.largestChats")}>
          {chats.map((chat) => (
            <SettingsRow
              key={chat.id}
              supportingText={`${agentName(chat.agentId)} · ${t("mobile.agent.files.fileCount", { count: chat.fileCount })} · ${t("mobile.agent.files.messageCount", { count: chat.messageCount })}`}
              trailing={<Size bytes={chat.bytes} />}
            >
              <Typography.Paragraph numberOfLines={1}>{chat.title}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {usage.files.length ? (
        <SettingsSection title={t("mobile.agent.files.files")}>
          <SettingsRow
            supportingText={t("mobile.agent.files.fileCount", { count: usage.files.length })}
            trailing={<TrailingValue value={format.fileSize(filesBytes)} />}
            onPress={() => router.push({ pathname: "/server-settings/storage-files", params: { serverId } })}
          >
            <Typography.Paragraph>{t("mobile.server.storage.allFiles")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {removable.length ? (
        <SettingsSection
          title={t("mobile.server.storage.cleanUp")}
          footer={t("mobile.server.storage.canBeCleared", { size: format.fileSize(removableBytes) })}
        >
          {removable.map((entry) => (
            <SettingsRow
              key={entry.category}
              disclosure={false}
              disabled={busy || clearing !== null}
              supportingText={format.fileSize(entry.bytes)}
              trailing={
                <Typography.Paragraph className="text-accent">
                  {t(clearing === entry.category ? "mobile.server.storage.clearing" : "mobile.server.storage.clear")}
                </Typography.Paragraph>
              }
              accessibilityLabel={t("mobile.server.storage.clearCategory", {
                category: t(CLEARABLE_LABELS[entry.category]),
              })}
              onPress={() => confirmClear(entry.category)}
            >
              <Typography.Paragraph>{t(CLEARABLE_LABELS[entry.category])}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {usage.truncated ? <SettingsNote>{t("mobile.agent.files.truncated")}</SettingsNote> : null}
    </SettingsContent>
  );
}

function useStorageGroupColors(): Record<StorageGroup, string> {
  return {
    workspaces: String(useCSSVariable("--openbot-chart-storage-workspaces")),
    files: String(useCSSVariable("--openbot-chart-storage-files")),
    chats: String(useCSSVariable("--openbot-chart-storage-chats")),
    downloads: String(useCSSVariable("--openbot-chart-storage-downloads")),
    runtimes: String(useCSSVariable("--openbot-chart-storage-runtimes")),
    app: String(useCSSVariable("--openbot-chart-storage-app")),
  };
}

/** The share of the total as a percent, as on desktop: a share above 0 never rounds to 0. */
function sharePercent(bytes: number, total: number): number {
  if (total <= 0 || bytes <= 0) return 0;
  const percent = (bytes / total) * 100;
  return percent < 1 ? Math.max(0.1, Math.round(percent * 10) / 10) : Math.round(percent);
}

/** "Measure again" in the header: the native toolbar on iOS. The host caches a scan; this one is new. */
function MeasureAction({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { t } = useText();
  const label = t(disabled ? "mobile.server.storage.measuring" : "mobile.server.storage.measureAgain");
  const press = () => {
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        icon={RotateCw}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={isIOS ? "arrow.clockwise" : undefined}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={press}
      >
        {isIOS ? undefined : label}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/** Server sheet > Storage > All files: every file sent in a chat or made by an agent on the host. */
export function ServerStorageFilesScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const { query, rescan } = useServerStorage(serverId);
  const files = query.data?.files ?? [];
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsSection
        footer={
          query.isError && !query.data ? errorMessage(query.error, t("mobile.server.storage.loadFailed")) : undefined
        }
      >
        {files.map((file) => (
          <StoredFile
            key={file.id}
            serverId={serverId}
            file={file}
            canDelete={canAdministerServer(server.role) && file.deletable}
            onChanged={() => void rescan().catch(() => undefined)}
          />
        ))}
        {query.isError && !query.data ? (
          <SettingsRow
            disclosure={false}
            disabled={query.isFetching}
            onPress={() => void rescan().catch(() => undefined)}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.storage.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : !files.length ? (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t(query.isSuccess ? "mobile.server.storage.noFiles" : "mobile.server.storage.measuring")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {query.data?.truncated ? <SettingsNote>{t("mobile.agent.files.truncated")}</SettingsNote> : null}
    </SettingsContent>
  );
}
