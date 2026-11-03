import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { confirmOwner } from "@/features/app-lock/model/app-lock";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { canRestartServer, useOwnerHostedServerIds } from "@/features/servers/model/server-settings-categories";
import { timeZoneLabel } from "@/features/servers/model/time-zones";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { useServerSites } from "@/features/servers/model/use-server-sites";
import { useServerTimezone } from "@/features/servers/model/use-server-timezone";
import { updateAvailable, useServerUpdate } from "@/features/servers/model/use-server-update";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** Shows the page of the server in the route, or a note when this app no longer has the server. */
function ServerSettingsPage({ children }: { children: (server: MobileServer) => ReactNode }) {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const server = useLiveServerRecovery(servers.find((item) => item.id === serverId));
  return (
    <SettingsContent>
      {server ? children(server) : <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>}
    </SettingsContent>
  );
}

function LinkRow({ label, pathname, serverId, trailing }: LinkRowProps) {
  return (
    <SettingsRow trailing={trailing} onPress={() => router.push({ pathname, params: { serverId } })}>
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

interface LinkRowProps {
  label: string;
  pathname:
    | "/server-settings/members"
    | "/server-settings/roles"
    | "/server-settings/audit"
    | "/server-settings/connectors"
    | "/server-settings/vault"
    | "/server-settings/storage"
    | "/server-settings/import"
    | "/server-settings/transfer";
  serverId: string;
  trailing?: ReactNode;
}

/** The status and role of this member, the server preferences, and the server key. */
export function ServerSettingsGeneralScreen() {
  const { t, sourceText } = useText();
  return (
    <ServerSettingsPage>
      {(server) => (
        <>
          <SettingsSection footer={server.connectionMessage ? sourceText(server.connectionMessage) : undefined}>
            <SettingsRow disclosure={false} trailing={<ServerStatusLabel server={server} />}>
              <Typography.Paragraph>{t("mobile.server.settings.status")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              disclosure={false}
              trailing={
                <Typography.Paragraph className="text-grouped-secondary">
                  {t(SERVER_ROLE_LABEL_KEYS[server.role])}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>{t("mobile.server.settings.yourRole")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <ServerPreferences serverId={server.id} />
          <ServerKeySettings server={server} />
        </>
      )}
    </ServerSettingsPage>
  );
}

/** The members, and the roles and the audit log for a role that the host serves them to. */
export function ServerSettingsPeopleScreen() {
  const { t } = useText();
  const { memberCountByServer, canManageServerRoles, canReadServerAudit } = useMobileWorkspace();
  return (
    <ServerSettingsPage>
      {(server) => {
        const memberCount = memberCountByServer[server.id];
        return (
          <SettingsSection>
            <LinkRow
              label={t("mobile.server.settings.members")}
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
              <LinkRow label={t("mobile.server.route.roles")} pathname="/server-settings/roles" serverId={server.id} />
            ) : null}
            {canReadServerAudit(server.id) ? (
              <LinkRow label={t("mobile.server.route.audit")} pathname="/server-settings/audit" serverId={server.id} />
            ) : null}
          </SettingsSection>
        );
      }}
    </ServerSettingsPage>
  );
}

/** The AI providers, MCP servers and connectors of the computer that runs the server. */
export function ServerSettingsAiScreen() {
  const { t } = useText();
  const {
    canManageProviders,
    canManageMcpServers,
    canManageConnectors,
    canManageOnePasswordConnector,
    canManageBitwardenConnector,
  } = useMobileWorkspace();
  return (
    <ServerSettingsPage>
      {({ id: serverId }) => (
        <SettingsSection>
          {canManageProviders(serverId) ? <ServerProvidersRow serverId={serverId} /> : null}
          {canManageMcpServers(serverId) ? <ServerMcpRow serverId={serverId} /> : null}
          {canManageConnectors(serverId) ||
          canManageOnePasswordConnector(serverId) ||
          canManageBitwardenConnector(serverId) ? (
            <LinkRow
              label={t("mobile.server.settings.connectors")}
              pathname="/server-settings/connectors"
              serverId={serverId}
            />
          ) : null}
        </SettingsSection>
      )}
    </ServerSettingsPage>
  );
}

/** The data that the server keeps, and the moves of agents and servers into and out of it. */
export function ServerSettingsDataScreen() {
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
    <ServerSettingsPage>
      {({ id: serverId }) => (
        <>
          {canManageVault(serverId) ||
          canManageBrowserProfiles(serverId) ||
          canViewHostedSites(serverId) ||
          canReadServerStorage(serverId) ? (
            <SettingsSection>
              {canManageVault(serverId) ? (
                <LinkRow
                  label={t("mobile.server.settings.vault")}
                  pathname="/server-settings/vault"
                  serverId={serverId}
                />
              ) : null}
              {canManageBrowserProfiles(serverId) ? <ServerBrowserProfilesRow serverId={serverId} /> : null}
              {canViewHostedSites(serverId) ? <ServerSitesRow serverId={serverId} /> : null}
              {canReadServerStorage(serverId) ? (
                <LinkRow
                  label={t("mobile.server.settings.storage")}
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
                  pathname="/server-settings/import"
                  serverId={serverId}
                />
              ) : null}
              {canTransferServer(serverId) ? (
                <LinkRow
                  label={t("mobile.server.settings.transfer")}
                  pathname="/server-settings/transfer"
                  serverId={serverId}
                />
              ) : null}
            </SettingsSection>
          ) : null}
        </>
      )}
    </ServerSettingsPage>
  );
}

/** The OpenBot update of the host, and the refresh and restart actions. */
export function ServerSettingsMaintenanceScreen() {
  return <ServerSettingsPage>{(server) => <ServerMaintenance server={server} />}</ServerSettingsPage>;
}

function ServerMaintenance({ server }: { server: MobileServer }) {
  const { t } = useText();
  const serverId = server.id;
  const { refreshServer, hostedServerStarting } = useMobileWorkspace();
  const { session } = useMobileSession();
  const update = useServerUpdate(serverId, { poll: false });
  const hostedServerIds = useOwnerHostedServerIds(server);
  const action = useLockedAction();
  const { busy, error } = action;
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState<string | null>(null);
  function perform(operation: () => Promise<void>, failure?: (error: unknown) => string) {
    setRestarted(null);
    return action.perform(operation, failure);
  }
  return (
    <>
      {update.access || update.query.data ? (
        <SettingsSection>
          <ServerUpdatesRow serverId={serverId} update={update} />
        </SettingsSection>
      ) : null}
      <SettingsSection footer={error ?? restarted}>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph className="text-accent">
            {busy && !restarting ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {canRestartServer(server, hostedServerIds) ? (
          // The account server stops the hosted server and starts it again. The app connects again after it.
          <SettingsRow
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
    </>
  );
}

/**
 * The server timezone and the memories per agent, for an owner or admin of a host that serves them.
 * The host checks the role and the value again.
 */
function ServerPreferences({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { canManageAgentMemoryLimit } = useMobileWorkspace();
  const { loadAgentMemoryLimit, setAgentMemoryLimit } = useMobileWorkspaceActions();
  const timezone = useServerTimezone(serverId);
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
  if (!timezone.available && !memoryLimitAvailable) return null;
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
      {timezone.available ? (
        <SettingsRow
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
function ServerKeySettings({ server }: { server: MobileServer }) {
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

/** The MCP servers row, for an owner or admin of a host that serves `mcp-servers-v1`. */
function ServerMcpRow({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { list } = useMcpServerList(serverId);
  return (
    <SettingsRow
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
