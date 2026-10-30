import { DEFAULT_TEAM_MEMBER_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Camera from "lucide-react-native/icons/camera";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { timeZoneLabel } from "@/features/servers/model/time-zones";
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
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { currentText, useText } from "@/shared/lib/text";

export function ServerSettingsScreen() {
  const { t, sourceText, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const {
    servers,
    memberCountByServer,
    leaveServer,
    removeServer,
    refreshServer,
    hostedServerStarting,
    canManageConnectors,
    canManageOnePasswordConnector,
    canManageBitwardenConnector,
    canManageVault,
    canReadServerStorage,
    canManageProviders,
    canManageMcpServers,
    canViewHostedSites,
    canManageServerRoles,
  } = useMobileWorkspace();
  const server = useLiveServerRecovery(servers.find((item) => item.id === serverId));
  const update = useServerUpdate(serverId, { poll: false });
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState<string | null>(null);
  const { session } = useMobileSession();
  const owner = server?.role === "owner";
  // Billing deletes a hosted server, so Remove shows only after the owner's hosted servers are known.
  const [hostedServerIds, setHostedServerIds] = useState<ReadonlySet<string> | null>(null);
  // The same rule as the Restart item of the desktop server menu.
  const canRestart =
    server?.kind === "remote" &&
    (owner || server.role === "admin") &&
    (server.hosted === true || Boolean(hostedServerIds?.has(serverId)));
  useEffect(() => {
    if (!session || !owner) return;
    let current = true;
    hostedServerCalls(session)
      .list()
      .then(
        (list) => {
          if (current) setHostedServerIds(new Set(list.servers.map((item) => item.serverId)));
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [session, owner]);
  async function perform(operation: () => Promise<void>, failure?: (error: unknown) => string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setRestarted(null);
    try {
      await operation();
      void haptics.notification("success");
    } catch (caught) {
      setError(failure?.(caught) ?? t("mobile.server.settings.updateFailed"));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const memberCount = memberCountByServer[serverId];
  const memberLimit = server.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
  const connectors =
    canManageConnectors(serverId) || canManageOnePasswordConnector(serverId) || canManageBitwardenConnector(serverId);
  return (
    <SettingsContent>
      {canAdministerServer(server.role) ? <ServerIdentityForm server={server} /> : <ServerHeader server={server} />}
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
        <SettingsRow
          trailing={
            memberCount === undefined ? undefined : (
              <TrailingValue
                value={t("mobile.server.settings.memberCount", { count: memberCount, limit: memberLimit })}
              />
            )
          }
          onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.settings.members")}</Typography.Paragraph>
        </SettingsRow>
        {canManageServerRoles(serverId) ? (
          <SettingsRow onPress={() => router.push({ pathname: "/server-settings/roles", params: { serverId } })}>
            <Typography.Paragraph>{t("mobile.server.route.roles")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <ServerGeneralSettings serverId={serverId} />
      {/* A section shows only when the host serves one of its pages to this role. */}
      {canManageProviders(serverId) || canManageMcpServers(serverId) || connectors ? (
        <SettingsSection title={t("mobile.server.settings.aiSection")}>
          {canManageProviders(serverId) ? <ServerProvidersRow serverId={serverId} /> : null}
          {canManageMcpServers(serverId) ? <ServerMcpRow serverId={serverId} /> : null}
          {connectors ? (
            <SettingsRow onPress={() => router.push({ pathname: "/server-settings/connectors", params: { serverId } })}>
              <Typography.Paragraph>{t("mobile.server.settings.connectors")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {canManageVault(serverId) || canViewHostedSites(serverId) || canReadServerStorage(serverId) ? (
        <SettingsSection title={t("mobile.server.settings.dataSection")}>
          {canManageVault(serverId) ? (
            <SettingsRow onPress={() => router.push({ pathname: "/server-settings/vault", params: { serverId } })}>
              <Typography.Paragraph>{t("mobile.server.settings.vault")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {canViewHostedSites(serverId) ? <ServerSitesRow serverId={serverId} /> : null}
          {canReadServerStorage(serverId) ? (
            <SettingsRow onPress={() => router.push({ pathname: "/server-settings/storage", params: { serverId } })}>
              <Typography.Paragraph>{t("mobile.server.settings.storage")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.server.settings.maintenanceSection")} footer={error ?? restarted}>
        {update.access || update.query.data ? <ServerUpdatesRow serverId={serverId} update={update} /> : null}
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph className="text-accent">
            {busy && !restarting ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {canRestart ? (
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
      {server.role !== "owner" ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.leaveTitle", { name: server.name }),
                t("mobile.server.settings.leaveBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.leave"),
                    style: "destructive",
                    onPress: () =>
                      void perform(async () => {
                        await leaveServer(serverId);
                        router.dismiss();
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.settings.leave")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : hostedServerIds && !hostedServerIds.has(serverId) ? (
        // The owner removes the server from the account. The host does not need to be online.
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.removeTitle", { name: server.name }),
                t("mobile.server.settings.removeBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.remove"),
                    style: "destructive",
                    onPress: () =>
                      void perform(
                        async () => {
                          await removeServer(serverId);
                          router.dismiss();
                        },
                        // The account service explains a refusal, such as a hosted server that Billing deletes.
                        (caught) => errorMessage(caught, t("mobile.server.settings.updateFailed")),
                      ),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.settings.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

/** The logo and name of the server, for a member, who cannot change them. */
function ServerHeader({ server }: { server: MobileServer }) {
  return (
    <View className="items-center gap-3">
      <ServerAvatar server={server} size={112} showStatus={false} />
      <Typography.Heading type="h4" align="center" numberOfLines={2} className="px-4">
        {server.name}
      </Typography.Heading>
    </View>
  );
}

/**
 * The server timezone and the memories per agent, for an owner or admin of a host that serves them.
 * The host checks the role and the value again.
 */
function ServerGeneralSettings({ serverId }: { serverId: string }) {
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
      title={t("mobile.server.settings.general")}
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

/** The server name and logo. The host saves both and tells every connected client. */
function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
  const foreground = useThemeColor("foreground");
  const available = canEditServerIdentity(server.id);
  const [draftName, setDraftName] = useState<string | undefined>();
  // Undefined keeps the saved logo; null removes it.
  const [logo, setLogo] = useState<AvatarPhoto | null | undefined>();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = draftName ?? server.name;
  const trimmed = name.trim();
  const nameChanged = draftName !== undefined && trimmed !== server.name;
  const logoChanged = logo !== undefined && (logo !== null || server.logoKey !== null);
  const dirty = nameChanged || logoChanged;
  // A saved name from an older rule stays valid until the user changes it.
  const nameValid =
    !nameChanged || (trimmed.length >= INPUT_LIMITS.serverNameMin && trimmed.length <= INPUT_LIMITS.serverName);
  const hasLogo = logo === undefined ? server.logoKey !== null : logo !== null;

  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && (dirty || saving || picking), ({ repeat }) => {
    if (pending.current || picking) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });

  async function chooseLogo(): Promise<void> {
    if (pending.current || picking) return;
    setPicking(true);
    setError(null);
    try {
      const photo = await pickAvatarPhoto({ pathname: "/server-settings/crop-logo" });
      if (photo) setLogo(photo);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.shared.photo.openFailed")));
    } finally {
      setPicking(false);
    }
  }

  function editLogo(): void {
    void haptics.impact("soft");
    if (!hasLogo) {
      void chooseLogo();
      return;
    }
    Alert.alert(t("mobile.server.settings.logo"), undefined, [
      { text: t("mobile.server.settings.changeLogo"), onPress: () => void chooseLogo() },
      {
        text: t("mobile.server.settings.removeLogo"),
        style: "destructive",
        onPress: () => {
          setError(null);
          setLogo(null);
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function save(): Promise<void> {
    if (!dirty || !nameValid || !available || picking || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateServerIdentity(server.id, {
        ...(nameChanged ? { serverName: trimmed } : {}),
        ...(logoChanged ? { logo: logo ? { mimeType: logo.mimeType, bytes: logo.bytes } : null } : {}),
      });
      setDraftName(undefined);
      setLogo(undefined);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.settings.identitySaveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const locked = !available || saving || picking;
  return (
    <View className="gap-5">
      <Pressable
        className="self-center"
        accessibilityRole="button"
        accessibilityLabel={t(hasLogo ? "mobile.server.settings.editLogo" : "mobile.server.settings.addLogo")}
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        onPress={editLogo}
      >
        <ServerAvatar
          server={{ ...server, name: trimmed || server.name }}
          size={112}
          showStatus={false}
          logoUri={logo === undefined ? undefined : (logo?.uri ?? null)}
        />
        <View className="absolute -right-2 -bottom-2 size-9 items-center justify-center rounded-full border-4 border-sheet bg-grouped">
          <Camera color={foreground} size={14} />
        </View>
      </Pressable>
      <SheetFormField
        label={t("mobile.server.settings.name")}
        autoCapitalize="words"
        maxLength={INPUT_LIMITS.serverName}
        value={name}
        editable={!locked}
        hint={
          !nameValid
            ? t("mobile.server.settings.nameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName })
            : undefined
        }
        onChangeText={(value) => {
          setDraftName(value);
          setError(null);
        }}
      />
      {!available ? (
        <SettingsNote>
          {t(
            server.state === "online"
              ? "mobile.server.settings.identityUnsupported"
              : "mobile.server.settings.identityOffline",
          )}
        </SettingsNote>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={nameValid && available}
        pending={saving || picking}
        onSave={() => void save()}
      />
    </View>
  );
}
