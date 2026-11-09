import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import AppWindow from "lucide-react-native/icons/app-window";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import Blocks from "lucide-react-native/icons/blocks";
import Brain from "lucide-react-native/icons/brain";
import Clock from "lucide-react-native/icons/clock";
import Download from "lucide-react-native/icons/download";
import Earth from "lucide-react-native/icons/earth";
import Fingerprint from "lucide-react-native/icons/fingerprint-pattern";
import HardDrive from "lucide-react-native/icons/hard-drive";
import KeyRound from "lucide-react-native/icons/key-round";
import RefreshCcw from "lucide-react-native/icons/refresh-ccw";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import RotateCcwClock from "lucide-react-native/icons/rotate-ccw-clock";
import RotateCcwKey from "lucide-react-native/icons/rotate-ccw-key";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import UserRound from "lucide-react-native/icons/user-round";
import UsersRound from "lucide-react-native/icons/users-round";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { confirmOwner } from "@/features/app-lock/model/app-lock";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { canRestartServer } from "@/features/servers/model/server-settings-access";
import { timeZoneLabel } from "@/features/servers/model/time-zones";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { useServerSites } from "@/features/servers/model/use-server-sites";
import { useServerTimezone } from "@/features/servers/model/use-server-timezone";
import { updateAvailable, useServerUpdate } from "@/features/servers/model/use-server-update";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

function LinkRow({ label, icon, pathname, serverId, trailing }: LinkRowProps) {
  return (
    <SettingsRow
      leading={<RowIcon icon={icon} />}
      trailing={trailing}
      onPress={() => router.push({ pathname, params: { serverId } })}
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

interface LinkRowProps {
  label: string;
  icon: LucideIcon;
  pathname:
    | "/server-settings/members"
    | "/server-settings/roles"
    | "/server-settings/audit"
    | "/server-settings/vault"
    | "/server-settings/storage"
    | "/server-settings/import"
    | "/server-settings/transfer";
  serverId: string;
  trailing?: ReactNode;
}

/** The role of this member, the members, and the roles and the audit log for a role that the host serves them to. */
export function ServerPeopleSection({ server }: { server: MobileServer }) {
  const { t } = useText();
  const { memberCountByServer, canManageServerRoles, canReadServerAudit } = useMobileWorkspace();
  const memberCount = memberCountByServer[server.id];
  return (
    <SettingsSection title={t("mobile.server.settings.peopleSection")}>
      <SettingsRow
        disclosure={false}
        leading={<RowIcon icon={UserRound} />}
        trailing={
          <Typography.Paragraph className="text-grouped-secondary">
            {t(SERVER_ROLE_LABEL_KEYS[server.role])}
          </Typography.Paragraph>
        }
      >
        <Typography.Paragraph>{t("mobile.server.settings.yourRole")}</Typography.Paragraph>
      </SettingsRow>
      <LinkRow
        label={t("mobile.server.settings.members")}
        icon={UsersRound}
        pathname="/server-settings/members"
        serverId={server.id}
        trailing={
          memberCount === undefined ? undefined : (
            <TrailingValue
              value={t("mobile.server.settings.memberCount", {
                count: memberCount,
                limit: server.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT,
              })}
            />
          )
        }
      />
      {canManageServerRoles(server.id) ? (
        <LinkRow
          label={t("mobile.server.route.roles")}
          icon={ShieldCheck}
          pathname="/server-settings/roles"
          serverId={server.id}
        />
      ) : null}
      {canReadServerAudit(server.id) ? (
        <LinkRow
          label={t("mobile.server.route.audit")}
          icon={RotateCcwClock}
          pathname="/server-settings/audit"
          serverId={server.id}
        />
      ) : null}
    </SettingsSection>
  );
}

/**
 * The AI providers and MCP servers of the computer that runs the server. Its connectors are apps of the
 * Marketplace, as on the desktop.
 */
export function ServerAiSection({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { canManageProviders, canManageMcpServers } = useMobileWorkspace();
  if (!canManageProviders(serverId) && !canManageMcpServers(serverId)) return null;
  return (
    <SettingsSection title={t("mobile.server.settings.aiSection")}>
      {canManageProviders(serverId) ? <ServerProvidersRow serverId={serverId} /> : null}
      {canManageMcpServers(serverId) ? <ServerMcpRow serverId={serverId} /> : null}
    </SettingsSection>
  );
}

/** The data that the server keeps, and the moves of agents and servers into and out of it. */
export function ServerDataSections({ serverId }: { serverId: string }) {
  const { t } = useText();
  const {
    canManageVault,
    canManageBrowserProfiles,
    canViewHostedSites,
    canReadServerStorage,
    canImportAgents,
    canTransferServer,
  } = useMobileWorkspace();
  return (
    <>
      {canManageVault(serverId) ||
      canManageBrowserProfiles(serverId) ||
      canViewHostedSites(serverId) ||
      canReadServerStorage(serverId) ? (
        <SettingsSection title={t("mobile.server.settings.dataSection")}>
          {canManageVault(serverId) ? (
            <LinkRow
              label={t("mobile.server.settings.vault")}
              icon={KeyRound}
              pathname="/server-settings/vault"
              serverId={serverId}
            />
          ) : null}
          {canManageBrowserProfiles(serverId) ? <ServerBrowserProfilesRow serverId={serverId} /> : null}
          {canViewHostedSites(serverId) ? <ServerSitesRow serverId={serverId} /> : null}
          {canReadServerStorage(serverId) ? (
            <LinkRow
              label={t("mobile.server.settings.storage")}
              icon={HardDrive}
              pathname="/server-settings/storage"
              serverId={serverId}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {canImportAgents(serverId) || canTransferServer(serverId) ? (
        <SettingsSection title={t("mobile.server.settings.moveSection")}>
          {canImportAgents(serverId) ? (
            <LinkRow
              label={t("mobile.server.settings.importAgents")}
              icon={Download}
              pathname="/server-settings/import"
              serverId={serverId}
            />
          ) : null}
          {canTransferServer(serverId) ? (
            <LinkRow
              label={t("mobile.server.settings.transfer")}
              icon={ArrowLeftRight}
              pathname="/server-settings/transfer"
              serverId={serverId}
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </>
  );
}

/** The refresh and restart actions. */
export function ServerConnectionSection({
  server,
  hostedServerIds,
}: {
  server: MobileServer;
  hostedServerIds: ReadonlySet<string> | null;
}) {
  const { t } = useText();
  const serverId = server.id;
  const { refreshServer, hostedServerStarting } = useMobileWorkspace();
  const { session } = useMobileSession();
  const action = useLockedAction();
  const { busy, error } = action;
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState<string | null>(null);
  function perform(operation: () => Promise<void>, failure?: (error: unknown) => string) {
    setRestarted(null);
    return action.perform(operation, failure);
  }
  return (
    <SettingsSection footer={error ?? restarted}>
      <SettingsRow
        leading={<RowIcon icon={RefreshCcw} tone="accent" />}
        disclosure={false}
        disabled={busy}
        onPress={() => void perform(() => refreshServer(serverId))}
      >
        <Typography.Paragraph className="text-accent">
          {busy && !restarting ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
        </Typography.Paragraph>
      </SettingsRow>
      {canRestartServer(server, hostedServerIds) ? (
        // The account server stops the hosted server and starts it again. The app connects again after it.
        <SettingsRow
          leading={<RowIcon icon={RotateCcw} tone="accent" />}
          disclosure={false}
          disabled={busy}
          onPress={() =>
            Alert.alert(
              t("mobile.server.settings.restartTitle", { name: server.name }),
              t("mobile.server.settings.restartBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.settings.restartConfirm"),
                  onPress: () =>
                    void perform(
                      async () => {
                        if (!session) throw new Error(currentText().t("mobile.server.hosted.restartFailed"));
                        setRestarting(true);
                        try {
                          const hosted = await hostedServerCalls(session).restart(serverId);
                          // The connection drops when the server stops. The app connects again, as after a wake.
                          if (WAKE_RECONNECT_STATES.has(hosted.state)) hostedServerStarting(serverId);
                        } finally {
                          setRestarting(false);
                        }
                        setRestarted(currentText().t("mobile.server.settings.restarted", { name: server.name }));
                      },
                      // The account server explains a refusal, such as a server that cannot restart now.
                      (caught) => {
                        const text = currentText();
                        return text.errorMessage(caught, text.t("mobile.server.hosted.restartFailed"));
                      },
                    ),
                },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-accent">
            {restarting ? t("mobile.server.settings.restarting") : t("mobile.server.settings.restart")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/**
 * The OpenBot update of the host, and the server timezone and the memories per agent, for an owner or
 * admin of a host that serves them. The host checks the role and the value again.
 */
export function ServerGeneralSection({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { canManageAgentMemoryLimit } = useMobileWorkspace();
  const { loadAgentMemoryLimit, setAgentMemoryLimit } = useMobileWorkspaceActions();
  const timezone = useServerTimezone(serverId);
  const update = useServerUpdate(serverId, { poll: false });
  const updateShown = Boolean(update.access || update.query.data);
  const memoryLimitKey = queryKeys.agentMemoryLimit(queryScope, serverId);
  const memoryLimitAvailable = canManageAgentMemoryLimit(serverId);
  const memoryLimit = useQuery({
    queryKey: memoryLimitKey,
    enabled: memoryLimitAvailable,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadAgentMemoryLimit(serverId),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!updateShown && !timezone.available && !memoryLimitAvailable) return null;
  const zone = timezone.query.data;
  const limit = memoryLimit.data;

  function chooseLimit(next: number) {
    if (saving || next === limit?.limit) return;
    void haptics.selection();
    setSaving(true);
    setError(null);
    setAgentMemoryLimit(next, serverId)
      .then(async (saved) => {
        await queryClient.cancelQueries({ queryKey: memoryLimitKey, exact: true });
        queryClient.setQueryData(memoryLimitKey, saved);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.memoryLimitSaveFailed")));
      })
      .finally(() => setSaving(false));
  }

  return (
    <SettingsSection
      title={t("mobile.server.settings.serverSection")}
      footer={
        error ??
        (memoryLimit.isError
          ? errorMessage(memoryLimit.error, t("mobile.server.settings.memoryLimitLoadFailed"))
          : timezone.query.isError
            ? errorMessage(timezone.query.error, t("mobile.server.settings.timezoneLoadFailed"))
            : memoryLimitAvailable
              ? t("mobile.server.settings.memoryLimitDescription")
              : undefined)
      }
    >
      {updateShown ? <ServerUpdatesRow serverId={serverId} update={update} /> : null}
      {timezone.available ? (
        <SettingsRow
          leading={<RowIcon icon={Clock} />}
          trailing={
            zone ? (
              <TrailingValue
                value={zone.timezone ? timeZoneLabel(zone.timezone) : t("mobile.server.settings.timezoneAutomatic")}
              />
            ) : undefined
          }
          disabled={!zone}
          onPress={() => router.push({ pathname: "/server-settings/timezone", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.settings.timezone")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {memoryLimitAvailable ? (
        <SettingsRow
          leading={<RowIcon icon={Brain} />}
          disclosure={false}
          trailing={
            limit ? (
              <SettingsPicker
                value={limit.limit}
                // A host that no longer permits its saved value still shows it.
                options={(limit.choices.includes(limit.limit) ? limit.choices : [limit.limit, ...limit.choices]).map(
                  (choice) => ({ value: choice, label: String(choice) }),
                )}
                enabled={!saving}
                dark={theme === "dark"}
                label={t("mobile.server.settings.memoryLimit")}
                onChange={chooseLimit}
              />
            ) : null
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.memoryLimit")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/**
 * The server key. Every member sees when the host last changed it. The owner can change it on a host
 * that serves `host-key-rotation-v1`: the host signs a handover with the current and the new key, and
 * this app trusts the new key only when the server list brings that handover. The host checks the
 * role again; the app lock, when it is on, confirms the owner first.
 */
export function ServerKeySettings({ server }: { server: MobileServer }) {
  const { t, format } = useText();
  const { canRotateServerKey } = useMobileWorkspace();
  const { rotateServerKey, reloadServerList } = useMobileWorkspaceActions();
  const locked = useRef(false);
  const [changing, setChanging] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRotate = canRotateServerKey(server.id);
  // A change from another device arrives with the server list. Read it once when the page opens.
  const reload = useRef(reloadServerList);
  useEffect(() => {
    void reload.current().catch(() => undefined);
  }, []);
  if (!canRotate && server.keyChangedAt === undefined && newKey === null) return null;

  async function change() {
    if (locked.current) return;
    locked.current = true;
    try {
      if (!(await confirmOwner())) return;
      setChanging(true);
      setError(null);
      setNewKey(null);
      const rotated = await rotateServerKey(server.id);
      setNewKey(rotated.publicKey);
      void haptics.notification("success");
    } catch (caught) {
      setError(currentText().errorMessage(caught, currentText().t("mobile.server.settings.keyChangeFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setChanging(false);
    }
  }

  // Until the server list brings the handover, this app still connects with the previous key.
  const footer =
    error ??
    (changing
      ? undefined
      : newKey !== null
        ? newKey === server.publicKey
          ? t("mobile.server.settings.keyChangedNow")
          : t("mobile.server.settings.keyFollowing")
        : canRotate
          ? t("mobile.server.settings.keyDescription")
          : t("mobile.server.settings.keySigned"));
  return (
    <SettingsSection title={t("mobile.server.settings.keySection")} footer={footer}>
      {server.keyChangedAt === undefined ? null : (
        <SettingsRow
          leading={<RowIcon icon={Fingerprint} />}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {format.date(new Date(server.keyChangedAt), { dateStyle: "medium", timeStyle: "short" })}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.keyChanged")}</Typography.Paragraph>
        </SettingsRow>
      )}
      {canRotate ? (
        <SettingsRow
          leading={<RowIcon icon={RotateCcwKey} tone="accent" />}
          disclosure={false}
          disabled={changing}
          onPress={() =>
            Alert.alert(
              t("mobile.server.settings.keyConfirmTitle", { name: server.name }),
              t("mobile.server.settings.keyConfirmBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("mobile.server.settings.keyConfirm"),
                  style: "destructive",
                  onPress: () => void change(),
                },
              ],
            )
          }
        >
          <Typography.Paragraph className="text-accent">
            {changing ? t("mobile.server.settings.keyChanging") : t("mobile.server.settings.keyChange")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/** Opens the OpenBot update of the host. The value is the version that runs there, or a new one. */
function ServerUpdatesRow({ serverId, update }: { serverId: string; update: ReturnType<typeof useServerUpdate> }) {
  const { t } = useText();
  const status = update.query.data?.status;
  return (
    <SettingsRow
      leading={<RowIcon icon={RefreshCw} />}
      trailing={
        status ? (
          <TrailingValue
            value={
              updateAvailable(status)
                ? t("mobile.server.settings.updateAvailable")
                : t("mobile.server.update.version", { version: status.currentVersion })
            }
          />
        ) : undefined
      }
      onPress={() => router.push({ pathname: "/server-settings/updates", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.updates")}</Typography.Paragraph>
    </SettingsRow>
  );
}

/**
 * The Providers row, for an owner or admin of a host that serves `providers-v1`: the AI providers of
 * the computer that runs the server, and how many are connected.
 */
function ServerProvidersRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { status, rows } = useServerProviders(serverId);
  const connected = rows.filter((row) => row.status?.state === "available").length;
  return (
    <SettingsRow
      leading={<RowIcon icon={Sparkles} />}
      trailing={
        status.data ? (
          <TrailingValue value={t("mobile.server.settings.providersConnected", { count: connected })} />
        ) : undefined
      }
      onPress={() => router.push({ pathname: "/server-settings/providers", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.providers")}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** The MCP servers row, for a user who manages the MCP servers of the host (`canManageMcpServers`). */
function ServerMcpRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { list } = useMcpServerList(serverId);
  return (
    <SettingsRow
      leading={<RowIcon icon={Blocks} />}
      trailing={
        list.data ? (
          <TrailingValue value={t("mobile.server.settings.mcpCount", { count: list.data.length })} />
        ) : undefined
      }
      onPress={() => router.push({ pathname: "/server-settings/mcp", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.mcp")}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** The Browser profiles row, for an owner or admin of a host that serves `browser-profiles-v1`. */
function ServerBrowserProfilesRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { profiles } = useServerBrowserProfiles(serverId);
  return (
    <SettingsRow
      leading={<RowIcon icon={AppWindow} />}
      trailing={profiles ? <TrailingValue value={String(profiles.length)} /> : undefined}
      onPress={() => router.push({ pathname: "/server-settings/browser-profiles", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.route.browserProfiles")}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** The Sites row, for every member of a host that serves `hosted-sites-v1`. */
function ServerSitesRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { query } = useServerSites(serverId);
  const list = query.data;
  return (
    <SettingsRow
      leading={<RowIcon icon={Earth} />}
      trailing={
        list ? (
          <TrailingValue value={t("mobile.server.settings.siteCount", { count: list.used, limit: list.limit })} />
        ) : undefined
      }
      onPress={() => router.push({ pathname: "/server-settings/sites", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.sites")}</Typography.Paragraph>
    </SettingsRow>
  );
}
