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
  typedHostFolder,
} from "@openbot/contracts/ipc";
import { keepPreviousData, type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
  useMobileWorkspaceActions,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

type BrowseMode = "add" | "exclude" | "locate";

const COVERED_TEXT = {
  "already-added": "mobile.agent.folders.alreadyAdded",
  "in-workspace": "mobile.agent.folders.inWorkspace",
  "in-shared": "mobile.agent.folders.inShared",
  "in-folder": "mobile.agent.folders.inFolder",
} as const satisfies Record<AgentFolderCoverageReason, string>;

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
      leading={<RowIcon icon={Folder} />}
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

export function alertFolderFailure(cause: unknown, operation: Parameters<typeof showFailureAlert>[1] = "agent") {
  void haptics.notification("error");
  const text = currentText();
  showFailureAlert(
    cause,
    operation,
    text.t("mobile.agent.folders.failed"),
    text.errorMessage(cause, text.t("mobile.agent.folders.failed")),
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
  const showPermissions = canManageAgentAccess(agent.serverId) || canManageAgentHostSettings(agent.serverId);
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
  const names = { workspace: t("mobile.agent.folders.workspace"), shared: t("mobile.agent.folders.shared") };

  async function change(run: () => Promise<{ list: AgentFolderList }>) {
    setBusy(true);
    try {
      const changed = await run();
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, changed.list);
      void haptics.notification("success");
    } catch (cause) {
      alertFolderFailure(cause);
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
              onPress={folder.found ? undefined : () => openBrowser(agent, "locate", undefined, folder.path)}
              accessibilityLabel={folder.found ? undefined : `${name}, ${t("mobile.agent.folders.locate")}`}
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
                <FolderRowAction
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

export function FolderRowAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
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

export function AgentFolderBrowser({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const params = useLocalSearchParams<{ mode?: string; path?: string; replace?: string }>();
  const mode: BrowseMode = params.mode === "exclude" ? "exclude" : params.mode === "locate" ? "locate" : "add";
  const path = params.path || null;
  const { browseAgentFolders, addAgentFolder, excludeAgentFolder, canManageAgentFolders } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const foldersKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "folders");
  const query = useQuery({
    queryKey: queryKeys.agentFolderBrowse(queryScope, agent.serverId, agent.id, path),
    queryFn: () => browseAgentFolders(agent.id, path, agent.serverId),
    enabled: available && canManageAgentFolders(agent.serverId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
  const [saving, setSaving] = useState(false);
  const folder = query.data;
  const moving = query.isPlaceholderData;

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
      alertFolderFailure(cause);
    } finally {
      setSaving(false);
    }
  }

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
      <FolderBrowserListing query={query} path={path} busy={saving} onGo={go} />
    </>
  );
}

export function FolderBrowserListing({
  query,
  path,
  busy,
  onGo,
}: {
  query: UseQueryResult<AgentFolderBrowse>;
  path: string | null;
  busy: boolean;
  onGo: (path: string) => void;
}) {
  const { t } = useText();
  const muted = String(useThemeColor("muted"));
  const folder = query.data;
  const moving = query.isPlaceholderData;
  const [places, setPlaces] = useState<Pick<AgentFolderBrowse, "home" | "volumes"> | null>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    setPlaces({ home: query.data.home, volumes: query.data.volumes });
    setTyped(query.data.path);
  }, [query.data, query.isPlaceholderData]);
  const current = path ?? places?.home;
  function goTyped() {
    if (!folder || moving) return;
    const target = typedHostFolder(typed, folder);
    if (target && target !== folder.path) onGo(target);
  }
  return (
    <>
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
                disabled={busy}
                onPress={here ? undefined : () => onGo(place.path)}
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
        <SheetFormField
          label={t("mobile.agent.folders.path")}
          hideLabel
          appearance="soft"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          returnKeyType="go"
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={goTyped}
        />
      ) : null}
      {folder ? (
        <View className="gap-5" accessibilityState={{ busy: moving }}>
          <SettingsSection title={moving && path ? path : folder.path}>
            {folder.parentPath === null ? null : (
              <SettingsRow
                leading={<CornerLeftUp size={18} color={muted} style={MIRROR_IN_RTL} />}
                disabled={busy || moving}
                onPress={() => folder.parentPath && onGo(folder.parentPath)}
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
                disabled={busy || moving}
                onPress={() => onGo(entry.path)}
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
