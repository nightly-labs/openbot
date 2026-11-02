import {
  AGENT_FOLDER_BROWSE_LIMIT,
  AGENT_FOLDER_LIMIT,
  type AgentExclusionChange,
  type AgentFolderBrowse,
  type AgentFolderChange,
  type AgentFolderCoverageReason,
  type AgentFolderList,
  agentExclusionPlace,
  agentFolderName,
  agentFolderParent,
  agentPermissionLevel,
  agentProviderDescriptor,
} from "@openbot/contracts/ipc";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import CornerLeftUp from "lucide-react-native/icons/corner-left-up";
import Folder from "lucide-react-native/icons/folder";
import HardDrive from "lucide-react-native/icons/hard-drive";
import House from "lucide-react-native/icons/house";
import Lock from "lucide-react-native/icons/lock";
import Plus from "lucide-react-native/icons/plus";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { PERMISSION_LABEL, useAgentAdminSettings } from "@/features/agents/components/agent-access-fields";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
  useMobileWorkspaceActions,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** What the folder browser picks: a folder to add, a folder to exclude, or the new place of a moved folder. */
type BrowseMode = "add" | "exclude" | "locate";

const COVERED_TEXT = {
  "already-added": "mobile.agent.folders.alreadyAdded",
  "in-workspace": "mobile.agent.folders.inWorkspace",
  "in-shared": "mobile.agent.folders.inShared",
  "in-folder": "mobile.agent.folders.inFolder",
} as const satisfies Record<AgentFolderCoverageReason, string>;

/**
 * The folders that the agent can change besides its workspace, as the host reads them. The host sends
 * `agents-changed` after each change, from this phone or from the desktop, so an open page reads them
 * again (`AGENT_SETTINGS_PARTS`).
 */
function useAgentFolders(agent: MobileAgent, enabled: boolean) {
  const { canManageAgentFolders, loadAgentFolders } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "folders");
  const query = useQuery({
    queryKey,
    queryFn: () => loadAgentFolders(agent.id, agent.serverId),
    enabled: enabled && canManageAgentFolders(agent.serverId),
    retry: false,
    staleTime: 0,
  });
  return { query, queryKey };
}

/**
 * The access label of the agent, and that label again as `wide` when the agent can change all files:
 * the folders then do not apply. They still apply to a provider whose own file tools reach only its
 * folders.
 */
function useAgentAccess(
  agent: MobileAgent,
  host: MobileServer | undefined,
  available: boolean,
): { label: string | null; wide: string | null } {
  const { t } = useText();
  const { settings } = useAgentAdminSettings(agent, host, available);
  if (!settings) return { label: null, wide: null };
  const level = agentPermissionLevel(settings);
  const label = t(PERMISSION_LABEL[level]);
  if (agent.provider !== undefined && agentProviderDescriptor(agent.provider).foldersInFullAccess)
    return { label, wide: null };
  return { label, wide: level === "workspace" ? null : label };
}

/** The Folders row of the agent settings, with the number of added folders. */
export function AgentFoldersRow({
  agent,
  host,
  available,
}: {
  agent: MobileAgent;
  host: MobileServer | undefined;
  available: boolean;
}) {
  const { t } = useText();
  const { query } = useAgentFolders(agent, available);
  const wideAccess = useAgentAccess(agent, host, available).wide;
  const list = query.data;
  const lost = list?.folders.filter((folder) => !folder.found).length ?? 0;
  const value = wideAccess
    ? t("mobile.agent.folders.valueAll")
    : list
      ? [
          list.folders.length > 0
            ? t("mobile.agent.folders.valueCount", { count: list.folders.length })
            : t("mobile.agent.folders.valueNone"),
          ...(lost > 0 ? [t("mobile.agent.folders.valueMissing", { count: lost })] : []),
        ].join(" · ")
      : undefined;
  return (
    <SettingsRow
      supportingText={value}
      onPress={() =>
        router.push({
          pathname: "/agent-info/[agentId]/folders",
          params: { agentId: agent.id, serverId: agent.serverId },
        })
      }
    >
      <Typography.Paragraph>{t("mobile.agent.folders.title")}</Typography.Paragraph>
    </SettingsRow>
  );
}

function openBrowser(agent: MobileAgent, mode: BrowseMode, path?: string, replace?: string) {
  router.push({
    pathname: "/agent-info/[agentId]/folder-browser",
    params: {
      agentId: agent.id,
      serverId: agent.serverId,
      mode,
      ...(path === undefined ? {} : { path }),
      ...(replace === undefined ? {} : { replace }),
    },
  });
}

/** Agent settings > Folders: the folders the agent can always change, the added ones and the excluded ones. */
export function AgentFolders({
  agent,
  host,
  available,
}: {
  agent: MobileAgent;
  host: MobileServer | undefined;
  available: boolean;
}) {
  const { t } = useText();
  const { removeAgentFolder, includeAgentFolder } = useMobileWorkspaceActions();
  const { canManageAgentAccess, canManageAgentHostSettings } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const { query, queryKey } = useAgentFolders(agent, available);
  const access = useAgentAccess(agent, host, available);
  const wideAccess = access.wide;
  // The access decides if the folders apply, so the page opens Permissions too.
  const showPermissions = canManageAgentAccess(agent.serverId) || canManageAgentHostSettings(agent.serverId);
  const muted = String(useThemeColor("muted"));
  const warning = String(useThemeColor("warning"));
  const [busy, setBusy] = useState(false);

  // The screen says that the host is offline.
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
  const names = { workspace: t("mobile.agent.folders.workspace"), shared: t("mobile.agent.folders.shared") };

  async function change(run: () => Promise<{ list: AgentFolderList }>) {
    setBusy(true);
    try {
      const changed = await run();
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, changed.list);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.folders.failed"),
        text.errorMessage(cause, text.t("mobile.agent.folders.failed")),
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(path: string) {
    const folder = agentFolderName(path);
    Alert.alert(
      t("mobile.agent.folders.removeTitle", { folder }),
      t("mobile.agent.folders.removeBody", { agent: agent.name, folder }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.remove"),
          style: "destructive",
          onPress: () => void change(() => removeAgentFolder({ agentId: agent.id, path }, agent.serverId)),
        },
      ],
    );
  }

  function confirmInclude(path: string) {
    const folder = agentFolderName(path);
    Alert.alert(
      t("mobile.agent.folders.includeTitle", { folder }),
      t("mobile.agent.folders.includeBody", { agent: agent.name, folder }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.agent.folders.includeConfirm"),
          onPress: () => void change(() => includeAgentFolder({ agentId: agent.id, path }, agent.serverId)),
        },
      ],
    );
  }

  const wideNote = wideAccess
    ? t("mobile.agent.folders.wideAccess", {
        access: wideAccess,
        agent: agent.name,
        workspace: t(PERMISSION_LABEL.workspace),
      })
    : null;

  return (
    <>
      {showPermissions ? (
        <SettingsSection footer={wideNote ?? undefined}>
          <SettingsRow
            supportingText={access.label ?? undefined}
            onPress={() =>
              router.push({
                pathname: "/agent-info/[agentId]/permissions",
                params: { agentId: agent.id, serverId: agent.serverId },
              })
            }
          >
            <Typography.Paragraph>{t("mobile.agent.permissions.title")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : wideNote ? (
        <SettingsNote>{wideNote}</SettingsNote>
      ) : null}
      <SettingsSection title={t("mobile.agent.folders.always")}>
        <SettingsRow leading={<Folder size={18} color={muted} />} supportingText={list.workspace}>
          <Typography.Paragraph>{names.workspace}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<Folder size={18} color={muted} />} supportingText={list.shared}>
          <Typography.Paragraph>{names.shared}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.folders.added")}>
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
              // A moved folder opens the browser, to pick its new place.
              onPress={folder.found ? undefined : () => openBrowser(agent, "locate", undefined, folder.path)}
              accessibilityLabel={folder.found ? undefined : `${name}, ${t("mobile.agent.folders.locate")}`}
              trailing={
                <RowAction
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
          disabled={busy || list.folders.length >= AGENT_FOLDER_LIMIT}
          disclosure={false}
          leading={<Plus size={18} color={muted} />}
          onPress={() => openBrowser(agent, "add")}
        >
          <Typography.Paragraph>{t("mobile.agent.folders.add")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.agent.folders.excluded")}>
        {list.excluded.map((path) => {
          const name = agentFolderName(path);
          const place = agentExclusionPlace(path, list, names);
          return (
            <SettingsRow
              key={path}
              disabled={busy}
              leading={<Lock size={18} color={muted} />}
              supportingText={place ? t("mobile.agent.folders.excludedIn", { folder: place }) : agentFolderParent(path)}
              trailing={
                <RowAction
                  label={t("mobile.agent.folders.include", { folder: name })}
                  disabled={busy}
                  onPress={() => confirmInclude(path)}
                />
              }
            >
              <Typography.Paragraph numberOfLines={1}>{name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
        <SettingsRow
          disabled={busy || list.excluded.length >= AGENT_FOLDER_LIMIT}
          disclosure={false}
          leading={<Plus size={18} color={muted} />}
          // The browser opens in the first added folder that is there, else in the workspace, as the
          // desktop picker does.
          onPress={() =>
            openBrowser(agent, "exclude", list.folders.find((folder) => folder.found)?.path ?? list.workspace)
          }
        >
          <Typography.Paragraph>{t("mobile.agent.folders.exclude")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function RowAction({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const muted = String(useThemeColor("muted"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
    >
      <X size={18} color={muted} />
    </Pressable>
  );
}

/** The sentence for a folder that the host did not add, or null when it added it. */
function folderRefusal(change: AgentFolderChange, agent: string): string | null {
  const text = currentText();
  if (change.outcome === "covered") {
    const folder = agentFolderName(change.path);
    return text.t(COVERED_TEXT[change.coverage.reason], {
      agent,
      folder,
      parent: agentFolderName(change.coverage.folder),
    });
  }
  if (change.outcome !== "refused") return null;
  const folder = agentFolderName(change.path);
  if (change.refusal === "limit") return text.t("mobile.agent.folders.limit", { count: AGENT_FOLDER_LIMIT });
  if (change.refusal === "protected") return text.t("mobile.agent.folders.protected", { folder });
  return text.t("mobile.agent.folders.missing", { folder });
}

/** The sentence for a folder that the host did not exclude, or null when it excluded it. */
function exclusionRefusal(change: AgentExclusionChange, agent: string): string | null {
  const text = currentText();
  if (change.outcome === "covered") {
    const folder = agentFolderName(change.path);
    return change.folder === change.path
      ? text.t("mobile.agent.folders.alreadyExcluded", { folder })
      : text.t("mobile.agent.folders.inExcluded", { folder, parent: agentFolderName(change.folder) });
  }
  if (change.outcome !== "refused") return null;
  const folder = agentFolderName(change.path);
  if (change.refusal === "limit") return text.t("mobile.agent.folders.excludeLimit", { count: AGENT_FOLDER_LIMIT });
  if (change.refusal === "outside") return text.t("mobile.agent.folders.excludeOutside", { agent, folder });
  if (change.refusal === "root") return text.t("mobile.agent.folders.excludeRoot", { folder });
  return text.t("mobile.agent.folders.missing", { folder });
}

/**
 * Agent settings > Folders > Choose folder: the folders in one folder of the host computer. A folder
 * row shows the folders in it on the same page; the header action picks the folder that it shows.
 */
export function AgentFolderBrowser({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const params = useLocalSearchParams<{ mode?: string; path?: string; replace?: string }>();
  const mode: BrowseMode = params.mode === "exclude" ? "exclude" : params.mode === "locate" ? "locate" : "add";
  const path = params.path || null;
  const { browseAgentFolders, addAgentFolder, excludeAgentFolder, canManageAgentFolders } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const foldersKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "folders");
  const muted = String(useThemeColor("muted"));
  const query = useQuery({
    queryKey: queryKeys.agentFolderBrowse(queryScope, agent.serverId, agent.id, path),
    queryFn: () => browseAgentFolders(agent.id, path, agent.serverId),
    enabled: available && canManageAgentFolders(agent.serverId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    // The last folder stays on the page until the next one is read.
    placeholderData: keepPreviousData,
  });
  const [saving, setSaving] = useState(false);
  const folder = query.data;
  const moving = query.isPlaceholderData;
  // The home folder and the disks do not change between folders, so they stay when a read fails.
  const [places, setPlaces] = useState<Pick<AgentFolderBrowse, "home" | "volumes"> | null>(null);
  useEffect(() => {
    if (query.data && !query.isPlaceholderData) setPlaces({ home: query.data.home, volumes: query.data.volumes });
  }, [query.data, query.isPlaceholderData]);
  const current = path ?? places?.home;

  // The page shows the next folder in place: one page for the whole browse, and Back closes it.
  function go(next: string) {
    router.setParams<"/agent-info/[agentId]/folder-browser">({ path: next });
  }

  async function choose(): Promise<void> {
    if (!folder || moving || saving) return;
    setSaving(true);
    try {
      let list: AgentFolderList;
      let refusal: string | null;
      if (mode === "exclude") {
        const change = await excludeAgentFolder({ agentId: agent.id, path: folder.path }, agent.serverId);
        list = change.list;
        refusal = exclusionRefusal(change, agent.name);
      } else {
        const change = await addAgentFolder(
          {
            agentId: agent.id,
            path: folder.path,
            ...(mode === "locate" && params.replace ? { replace: params.replace } : {}),
          },
          agent.serverId,
        );
        list = change.list;
        refusal = folderRefusal(change, agent.name);
      }
      await queryClient.cancelQueries({ queryKey: foldersKey, exact: true });
      queryClient.setQueryData(foldersKey, list);
      if (refusal) {
        void haptics.notification("warning");
        Alert.alert(
          t(mode === "exclude" ? "mobile.agent.folders.notExcludedTitle" : "mobile.agent.folders.notAddedTitle"),
          refusal,
        );
        return;
      }
      void haptics.notification("success");
      router.dismissTo({
        pathname: "/agent-info/[agentId]/folders",
        params: { agentId: agent.id, serverId: agent.serverId },
      });
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.folders.failed"),
        text.errorMessage(cause, text.t("mobile.agent.folders.failed")),
      );
    } finally {
      setSaving(false);
    }
  }

  // The screen says that the host is offline.
  if (!available) return null;
  return (
    <>
      <SheetSaveAction
        dirty
        canSave={Boolean(folder) && !moving}
        pending={saving}
        label={t(
          mode === "exclude"
            ? "mobile.agent.folders.excludeHere"
            : mode === "locate"
              ? "mobile.agent.folders.locateHere"
              : "mobile.agent.folders.addHere",
        )}
        onSave={() => void choose()}
      />
      {places ? (
        <SettingsSection title={t("mobile.agent.folders.places")}>
          {[
            { name: t("mobile.agent.folders.home"), path: places.home, home: true },
            ...places.volumes.map((volume) => ({ ...volume, home: false })),
          ].map((place) => {
            const here = place.path === current;
            return (
              <SettingsRow
                key={`${place.home}:${place.path}`}
                leading={place.home ? <House size={18} color={muted} /> : <HardDrive size={18} color={muted} />}
                checked={here}
                disclosure={false}
                trailing={here ? <Check size={18} color={muted} /> : undefined}
                disabled={saving}
                onPress={here ? undefined : () => go(place.path)}
              >
                <Typography.Paragraph numberOfLines={1}>{place.name}</Typography.Paragraph>
              </SettingsRow>
            );
          })}
        </SettingsSection>
      ) : null}
      {query.isPending ? <Typography.Paragraph>{t("mobile.agent.folders.loading")}</Typography.Paragraph> : null}
      {query.isError ? (
        <View className="gap-2">
          <Typography.Paragraph accessibilityRole="alert">
            {t("mobile.agent.folders.browseFailed")}
          </Typography.Paragraph>
          <Button variant="ghost" onPress={() => void query.refetch()}>
            <Button.Label>{t("mobile.agent.folders.retry")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {folder ? (
        // The rows of the last folder are dimmed until the next folder is read.
        <View className="gap-5" accessibilityState={{ busy: moving }}>
          <SettingsSection title={moving && path ? path : folder.path}>
            {folder.parentPath === null ? null : (
              <SettingsRow
                leading={<CornerLeftUp size={18} color={muted} />}
                disabled={saving || moving}
                onPress={() => folder.parentPath && go(folder.parentPath)}
              >
                <Typography.Paragraph numberOfLines={1}>
                  {t("mobile.agent.folders.parent", { folder: agentFolderName(folder.parentPath) })}
                </Typography.Paragraph>
              </SettingsRow>
            )}
            {folder.entries.map((entry) => (
              <SettingsRow
                key={entry.path}
                leading={<Folder size={18} color={muted} />}
                disabled={saving || moving}
                onPress={() => go(entry.path)}
              >
                <Typography.Paragraph numberOfLines={1}>{entry.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
            {!folder.entries.length ? (
              <SettingsRow>
                <Typography.Paragraph className="text-grouped-secondary">
                  {t("mobile.agent.folders.browseEmpty")}
                </Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          {folder.truncated ? (
            <SettingsNote>
              {t("mobile.agent.folders.browseTruncated", { count: AGENT_FOLDER_BROWSE_LIMIT })}
            </SettingsNote>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
