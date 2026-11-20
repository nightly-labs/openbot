import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import AppWindow from "lucide-react-native/icons/app-window";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import Bot from "lucide-react-native/icons/bot";
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
import UserRoundCog from "lucide-react-native/icons/user-round-cog";
import UsersRound from "lucide-react-native/icons/users-round";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { confirmOwner } from "@/features/app-lock/model/app-lock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import {
  ServerBrowsingMemoryRow,
  ServerMemoryLimitRow,
  ServerMemoryReviewRow,
  ServerPersonalityRow,
  ServerSkillLearningRow,
} from "@/features/servers/components/server-learning-rows";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { canRestartServer, useOwnerHostedServerIds } from "@/features/servers/model/server-settings-access";
import { timeZoneLabel } from "@/features/servers/model/time-zones";
import { useLockedAction } from "@/features/servers/model/use-locked-action";
import { useServerBrowserProfiles } from "@/features/servers/model/use-server-browser-profiles";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { useServerSites } from "@/features/servers/model/use-server-sites";
import { useServerTimezone } from "@/features/servers/model/use-server-timezone";
import { updateAvailable, useServerUpdate } from "@/features/servers/model/use-server-update";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { type ServerRowState, serverRowState } from "@/features/workspace/model/server-row-state";
import type { MobileServer, ServerChecks } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

function useServerRows(serverId: string) {
  const workspace = useMobileWorkspace();
  return (permits: (checks: ServerChecks) => unknown) => serverRowState(workspace, serverId, permits);
}

function LinkRow({ label, icon, pathname, serverId, trailing, disabled }: LinkRowProps) {
  return (
    <SettingsRow
      leading={<RowIcon icon={icon} />}
      trailing={trailing}
      disabled={disabled}
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
    | "/server-settings/owner-transfer"
    | "/server-settings/roles"
    | "/server-settings/audit"
    | "/server-settings/vault"
    | "/server-settings/storage"
    | "/server-settings/import"
    | "/server-settings/transfer";
  serverId: string;
  trailing?: ReactNode;
  disabled?: boolean;
}

export function ServerPeopleSection({ server }: { server: MobileServer }) {
  const { t } = useText();
  const { memberCountByServer } = useMobileWorkspace();
  const row = useServerRows(server.id);
  const roles = row((checks) => checks.canManageServerRoles(server.id));
  const audit = row((checks) => checks.canReadServerAudit(server.id));
  const ownerTransfer = row((checks) => checks.canTransferOwnership(server.id));
  const hostedServerIds = useOwnerHostedServerIds(server);
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
      {roles === "hidden" ? null : (
        <LinkRow
          label={t("mobile.server.route.roles")}
          icon={ShieldCheck}
          pathname="/server-settings/roles"
          serverId={server.id}
          disabled={roles === "disabled"}
        />
      )}
      {audit === "hidden" ? null : (
        <LinkRow
          label={t("mobile.server.route.audit")}
          icon={RotateCcwClock}
          pathname="/server-settings/audit"
          serverId={server.id}
          disabled={audit === "disabled"}
        />
      )}
      {ownerTransfer === "hidden" || hostedServerIds?.has(server.id) ? null : (
        <LinkRow
          label={t("mobile.server.route.ownerTransfer")}
          icon={UserRoundCog}
          pathname="/server-settings/owner-transfer"
          serverId={server.id}
          disabled={ownerTransfer === "disabled"}
        />
      )}
    </SettingsSection>
  );
}

export function ServerAiSection({ serverId }: { serverId: string }) {
  const { t } = useText();
  const row = useServerRows(serverId);
  const providers = row((checks) => checks.canManageProviders(serverId));
  if (providers === "hidden") return null;
  return (
    <SettingsSection title={t("mobile.server.settings.aiSection")}>
      <ServerProvidersRow serverId={serverId} disabled={providers === "disabled"} />
    </SettingsSection>
  );
}

export function ServerDataSections({ serverId }: { serverId: string }) {
  const { t } = useText();
  const row = useServerRows(serverId);
  const vault = row((checks) => checks.canManageVault(serverId));
  const browserProfiles = row((checks) => checks.canManageBrowserProfiles(serverId));
  const sites = row((checks) => checks.canViewHostedSites(serverId));
  const storage = row((checks) => checks.canReadServerStorage(serverId));
  const importAgents = row((checks) => checks.canImportAgents(serverId));
  const transfer = row((checks) => checks.canTransferServer(serverId));
  const shown = (state: ServerRowState) => state !== "hidden";
  return (
    <>
      {shown(vault) || shown(browserProfiles) || shown(sites) || shown(storage) ? (
        <SettingsSection title={t("mobile.server.settings.dataSection")}>
          {shown(vault) ? (
            <LinkRow
              label={t("mobile.server.settings.vault")}
              icon={KeyRound}
              pathname="/server-settings/vault"
              serverId={serverId}
              disabled={vault === "disabled"}
            />
          ) : null}
          {shown(browserProfiles) ? (
            <ServerBrowserProfilesRow serverId={serverId} disabled={browserProfiles === "disabled"} />
          ) : null}
          {shown(sites) ? <ServerSitesRow serverId={serverId} disabled={sites === "disabled"} /> : null}
          {shown(storage) ? (
            <LinkRow
              label={t("mobile.server.settings.storage")}
              icon={HardDrive}
              pathname="/server-settings/storage"
              serverId={serverId}
              disabled={storage === "disabled"}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {shown(importAgents) || shown(transfer) ? (
        <SettingsSection title={t("mobile.server.settings.moveSection")}>
          {shown(importAgents) ? (
            <LinkRow
              label={t("mobile.server.settings.importAgents")}
              icon={Download}
              pathname="/server-settings/import"
              serverId={serverId}
              disabled={importAgents === "disabled"}
            />
          ) : null}
          {shown(transfer) ? (
            <LinkRow
              label={t("mobile.server.settings.transfer")}
              icon={ArrowLeftRight}
              pathname="/server-settings/transfer"
              serverId={serverId}
              disabled={transfer === "disabled"}
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </>
  );
}

export function ServerConnectionSection({
  server,
  hostedServerIds,
}: {
  server: MobileServer;
  hostedServerIds: ReadonlySet<string> | null;
}) {
  const { t } = useText();
  const serverId = server.id;
  const { refreshServer, hostedServerStarting, canRestartServerItself, restartServerItself } = useMobileWorkspace();
  const { session } = useMobileSession();
  const action = useLockedAction();
  const { busy, error } = action;
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState<string | null>(null);
  const hosted = canRestartServer(server, hostedServerIds);
  const selfHosted = !hosted && canRestartServerItself(serverId);
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
      {hosted || selfHosted ? (
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
                        setRestarting(true);
                        try {
                          if (selfHosted) await restartServerItself(serverId);
                          else {
                            if (!session) throw new Error(currentText().t("mobile.server.hosted.restartFailed"));
                            const restart = await hostedServerCalls(session).restart(serverId);
                            if (WAKE_RECONNECT_STATES.has(restart.state)) hostedServerStarting(serverId);
                          }
                        } finally {
                          setRestarting(false);
                        }
                        setRestarted(currentText().t("mobile.server.settings.restarted", { name: server.name }));
                      },
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

function permitsAgentSettings(checks: ServerChecks, serverId: string): boolean {
  return (
    checks.canManageServerPersonality(serverId) ||
    checks.canManageAgentMemoryLimit(serverId) ||
    checks.canManageMemoryReview(serverId) ||
    checks.canManageSkillLearning(serverId) ||
    checks.canManageBrowsingMemory(serverId)
  );
}

export function useAgentSettingsAvailable(serverId: string): boolean {
  return permitsAgentSettings(useMobileWorkspace(), serverId);
}

export function ServerGeneralSection({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const timezone = useServerTimezone(serverId);
  const update = useServerUpdate(serverId, { poll: false });
  const row = useServerRows(serverId);
  const updateRow = row((checks) => checks.serverUpdateAccess(serverId));
  const timezoneRow = row((checks) => checks.canManageServerTimezone(serverId));
  const agentsRow = row((checks) => permitsAgentSettings(checks, serverId));
  const updateShown = Boolean(update.access || update.query.data) || updateRow === "disabled";
  if (!updateShown && timezoneRow === "hidden" && agentsRow === "hidden") return null;
  const zone = timezone.query.data;
  return (
    <SettingsSection
      title={t("mobile.server.settings.serverSection")}
      footer={
        timezone.query.isError
          ? errorMessage(timezone.query.error, t("mobile.server.settings.timezoneLoadFailed"))
          : undefined
      }
    >
      {updateShown ? (
        <ServerUpdatesRow serverId={serverId} update={update} disabled={updateRow === "disabled"} />
      ) : null}
      {timezoneRow === "hidden" ? null : (
        <SettingsRow
          leading={<RowIcon icon={Clock} />}
          trailing={
            zone ? (
              <TrailingValue
                value={zone.timezone ? timeZoneLabel(zone.timezone) : t("mobile.server.settings.timezoneAutomatic")}
              />
            ) : undefined
          }
          disabled={!zone || timezoneRow === "disabled"}
          onPress={() => router.push({ pathname: "/server-settings/timezone", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.settings.timezone")}</Typography.Paragraph>
        </SettingsRow>
      )}
      {agentsRow === "hidden" ? null : (
        <SettingsRow
          leading={<RowIcon icon={Bot} />}
          disabled={agentsRow === "disabled"}
          onPress={() => router.push({ pathname: "/server-settings/agents", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.route.agents")}</Typography.Paragraph>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

export function ServerAgentsSection({ serverId }: { serverId: string }) {
  const {
    canManageServerPersonality,
    canManageAgentMemoryLimit,
    canManageMemoryReview,
    canManageSkillLearning,
    canManageBrowsingMemory,
  } = useMobileWorkspace();
  return (
    <>
      {canManageServerPersonality(serverId) ? <ServerPersonalityRow serverId={serverId} /> : null}
      {canManageAgentMemoryLimit(serverId) ? <ServerMemoryLimitRow serverId={serverId} /> : null}
      {canManageMemoryReview(serverId) ? <ServerMemoryReviewRow serverId={serverId} /> : null}
      {canManageSkillLearning(serverId) ? <ServerSkillLearningRow serverId={serverId} /> : null}
      {canManageBrowsingMemory(serverId) ? <ServerBrowsingMemoryRow serverId={serverId} /> : null}
    </>
  );
}

export function ServerKeySettings({ server }: { server: MobileServer }) {
  const { t, format } = useText();
  const keyRow = useServerRows(server.id)((checks) => checks.canRotateServerKey(server.id));
  const { rotateServerKey, reloadServerList } = useMobileWorkspaceActions();
  const locked = useRef(false);
  const [changing, setChanging] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRotate = keyRow !== "hidden";
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
          disabled={changing || keyRow === "disabled"}
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

function ServerUpdatesRow({
  serverId,
  update,
  disabled,
}: {
  serverId: string;
  update: ReturnType<typeof useServerUpdate>;
  disabled?: boolean;
}) {
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
      disabled={disabled}
      onPress={() => router.push({ pathname: "/server-settings/updates", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.updates")}</Typography.Paragraph>
    </SettingsRow>
  );
}

function ServerProvidersRow({ serverId, disabled }: { serverId: string; disabled?: boolean }) {
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
      disabled={disabled}
      onPress={() => router.push({ pathname: "/server-settings/providers", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.providers")}</Typography.Paragraph>
    </SettingsRow>
  );
}

function ServerBrowserProfilesRow({ serverId, disabled }: { serverId: string; disabled?: boolean }) {
  const { t } = useText();
  const { profiles } = useServerBrowserProfiles(serverId);
  return (
    <SettingsRow
      leading={<RowIcon icon={AppWindow} />}
      trailing={profiles ? <TrailingValue value={String(profiles.length)} /> : undefined}
      disabled={disabled}
      onPress={() => router.push({ pathname: "/server-settings/browser-profiles", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.route.browserProfiles")}</Typography.Paragraph>
    </SettingsRow>
  );
}

function ServerSitesRow({ serverId, disabled }: { serverId: string; disabled?: boolean }) {
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
      disabled={disabled}
      onPress={() => router.push({ pathname: "/server-settings/sites", params: { serverId } })}
    >
      <Typography.Paragraph>{t("mobile.server.settings.sites")}</Typography.Paragraph>
    </SettingsRow>
  );
}
