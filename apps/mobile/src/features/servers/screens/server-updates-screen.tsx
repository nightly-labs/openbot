import type { HostUpdateSettingsChange, HostUpdateStatus, UpdateRestartMode } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import {
  readOnlyRelease,
  type ServerUpdateSnapshot,
  updateBlocked,
  updateRunning,
  useServerUpdate,
} from "@/features/servers/model/use-server-update";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, type MobileText, useText } from "@/shared/lib/text";

/** The restart blockers that the host reports, as the user reads them. */
const RESTART_REASON_KEYS: Record<string, MobileTextKey> = {
  "agent-turn": "mobile.server.update.reason.agentTurn",
  "queued-delivery": "mobile.server.update.reason.queuedDelivery",
  "drain-task": "mobile.server.update.reason.drainTask",
  "routine-run": "mobile.server.update.reason.routineRun",
  "channel-work": "mobile.server.update.reason.channelWork",
  "provider-process": "mobile.server.update.reason.providerProcess",
  "remote-desktop": "mobile.server.update.reason.remoteDesktop",
  "browser-view": "mobile.server.update.reason.browserView",
  "file-transfer": "mobile.server.update.reason.fileTransfer",
  "browser-control": "mobile.server.update.reason.browserControl",
  "update-operation": "mobile.server.update.reason.updateOperation",
  initialization: "mobile.server.update.reason.initialization",
};

const RELEASE_PATH_KEYS = {
  "host-manager": "mobile.server.update.path.hostManager",
  hosted: "mobile.server.update.path.hosted",
  system: "mobile.server.update.path.system",
  container: "mobile.server.update.path.container",
  manual: "mobile.server.update.path.manual",
  unavailable: "mobile.server.update.path.unavailable",
} as const satisfies Record<string, MobileTextKey>;

/**
 * Server settings > Updates: the OpenBot update of the server's host, as the Updates section of the
 * desktop Server Settings shows it. Owners and admins also choose the restart, cancel it and change
 * the automatic updates. A member can only ask for an update that waits for idle agents.
 */
export function ServerUpdatesScreen() {
  const text = useText();
  const { t, errorMessage } = text;
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers } = useMobileWorkspace();
  const { checkServerUpdate, startServerUpdate, cancelServerUpdate, setServerUpdateSettings, checkServerRelease } =
    useMobileWorkspaceActions();
  const { access, query, show } = useServerUpdate(serverId, { poll: true });
  const [busy, setBusy] = useState<"check" | "start" | "cancel" | "settings" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = servers.find((server) => server.id === serverId)?.name ?? "";
  const snapshot = query.data;
  // A host that restarts into the update goes offline. The page keeps its last status until it is back.
  if (!snapshot)
    return (
      <SettingsContent>
        <SettingsNote>
          {!access
            ? t("mobile.server.update.unavailable")
            : query.isError
              ? errorMessage(query.error, t("mobile.server.update.loadFailed", { name }))
              : t("mobile.server.update.loading")}
        </SettingsNote>
      </SettingsContent>
    );
  const { status } = snapshot;
  const release = readOnlyRelease(snapshot);
  const blocked = updateBlocked(status);
  const admin = access === "admin";
  const loadFailed = query.isError;
  // A host that restarts into the update cannot answer. The footer keeps the restart text.
  const showLoadFailure = loadFailed && !updateRunning(status);
  const disabled = !access || busy !== null || loadFailed || blocked;
  const checkDisabled = !access || busy !== null || loadFailed || (release ? release.phase === "unavailable" : blocked);
  const checking = busy === "check" || status.phase === "checking" || release?.phase === "checking";
  const actionsShown = status.phase !== "installing" && !status.restart;

  async function act(key: NonNullable<typeof busy>, call: () => Promise<Partial<ServerUpdateSnapshot>>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await show(await call());
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const current = currentText();
      setError(current.errorMessage(cause, current.t("mobile.server.update.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  function check() {
    if (!access) return;
    void act("check", async () => {
      // The release check leaves the update status as it is. The page reads it again while the check runs.
      return release
        ? { release: await checkServerRelease(serverId) }
        : { status: await checkServerUpdate(serverId, access) };
    });
  }

  function start(restart: UpdateRestartMode) {
    if (!access) return;
    void act("start", async () => ({ status: await startServerUpdate(serverId, access, restart) }));
  }

  function changeSettings(settings: HostUpdateSettingsChange) {
    void act("settings", async () => ({ status: await setServerUpdateSettings(settings, serverId) }));
  }

  function offerUpdate() {
    void haptics.notification("warning");
    const version = status.availableVersion ?? status.currentVersion;
    const description = t(
      status.phase === "ready"
        ? "mobile.server.update.dialog.offerReadyDescription"
        : "mobile.server.update.dialog.offerDescription",
      { name, current: status.currentVersion },
    );
    Alert.alert(
      t("mobile.server.update.dialog.offerTitle", { name, version }),
      admin ? description : `${description} ${t("mobile.server.update.dialog.waitIdleDescription")}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        ...(admin
          ? [
              { text: t("mobile.server.update.dialog.restartWhenIdle"), onPress: () => start("when-idle") },
              { text: t("mobile.server.update.dialog.updateNow"), onPress: () => start("now") },
            ]
          : [{ text: t("mobile.server.update.start"), onPress: () => start("when-idle") }]),
      ],
    );
  }

  const notice = blockedNotice(text, snapshot, name);
  return (
    <SettingsContent>
      {notice ? (
        <SettingsSection>
          <SettingsRow supportingText={notice.description}>
            <Typography.Paragraph>{notice.title}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={t("mobile.server.update.hostTitle", { name })}
        footer={
          error ??
          (showLoadFailure
            ? errorMessage(query.error, t("mobile.server.update.loadFailed", { name }))
            : statusMessage(text, snapshot, name))
        }
      >
        <SettingsRow disclosure={false} trailing={updateRunning(status) ? <Spinner size="sm" color={accent} /> : null}>
          <Typography.Paragraph>
            {t("mobile.server.update.version", { version: status.currentVersion })}
          </Typography.Paragraph>
        </SettingsRow>
        {actionsShown ? (
          <SettingsRow disclosure={false} disabled={checkDisabled || checking} onPress={check}>
            <Typography.Paragraph className="text-accent">
              {checking ? t("mobile.server.update.status.checking") : t("mobile.server.update.check")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {actionsShown && !blocked ? (
          <SettingsRow
            disclosure={false}
            // Only a relaunch of the host recovers from a failed install.
            disabled={disabled || !status.availableVersion || status.errorCode === "install_failed"}
            onPress={offerUpdate}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.update.start")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {status.restart ? (
        <SettingsSection
          title={t(
            status.restart.mode === "now"
              ? "mobile.server.update.scheduledNowTitle"
              : "mobile.server.update.scheduledTitle",
            { name },
          )}
          footer={restartMessage(text, status, name)}
        >
          {admin && status.phase !== "installing" ? (
            <>
              {status.restart.mode === "when-idle" ? (
                <SettingsRow disclosure={false} disabled={disabled} onPress={() => start("now")}>
                  <Typography.Paragraph className="text-accent">
                    {t("mobile.server.update.restartNow")}
                  </Typography.Paragraph>
                </SettingsRow>
              ) : null}
              <SettingsRow
                disclosure={false}
                disabled={!access || busy !== null}
                onPress={() => void act("cancel", async () => ({ status: await cancelServerUpdate(serverId) }))}
              >
                <Typography.Paragraph className="text-danger-text">
                  {t("mobile.server.update.cancel")}
                </Typography.Paragraph>
              </SettingsRow>
            </>
          ) : (
            <SettingsRow disclosure={false} trailing={<Spinner size="sm" color={accent} />}>
              <Typography.Paragraph>
                {status.phase === "installing"
                  ? t("mobile.server.update.restarting")
                  : t("mobile.server.update.version", { version: status.availableVersion ?? status.currentVersion })}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      ) : null}
      {admin && !blocked ? (
        <>
          <SettingsSection footer={t("mobile.server.update.autoDownloadDescription", { name })}>
            <SettingsRow>
              <SettingsSwitch
                value={status.autoDownload}
                disabled={disabled}
                label={t("mobile.server.update.autoDownloadTitle")}
                dark={theme === "dark"}
                onValueChange={(autoDownload) => changeSettings({ autoDownload })}
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection footer={t("mobile.server.update.autoInstallDescription", { name })}>
            <SettingsRow>
              <SettingsSwitch
                value={status.autoInstall}
                disabled={disabled}
                label={t("mobile.server.update.autoInstallTitle")}
                dark={theme === "dark"}
                onValueChange={(autoInstall) => changeSettings({ autoInstall })}
              />
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SettingsContent>
  );
}

/** Why no action can run here, and what the host administrator can do instead. */
function blockedNotice(
  { t }: MobileText,
  snapshot: ServerUpdateSnapshot,
  name: string,
): { title: string; description: string } | null {
  const release = readOnlyRelease(snapshot);
  const { status } = snapshot;
  if (release && release.method !== "self-update")
    return { title: t("mobile.server.update.externalTitle"), description: t(RELEASE_PATH_KEYS[release.method]) };
  if (status.remoteUpdates === "disabled")
    return {
      title: t("mobile.server.update.disabledTitle"),
      description: t("mobile.server.update.disabledDescription", { name }),
    };
  if (status.remoteUpdates === "managed")
    return {
      title: t("mobile.server.update.managedTitle"),
      description: t("mobile.server.update.managedDescription", { name }),
    };
  if (status.phase === "unsupported")
    return {
      title: t("mobile.server.update.unsupportedTitle", { name }),
      description: t("mobile.server.update.unsupportedDescription", { name }),
    };
  return null;
}

function statusMessage({ t, format }: MobileText, snapshot: ServerUpdateSnapshot, name: string): string {
  const { status } = snapshot;
  const checked = readOnlyRelease(snapshot);
  const version = status.availableVersion ?? status.currentVersion;
  if (checked && !updateRunning(status) && status.phase !== "ready" && status.errorCode !== "install_failed") {
    switch (checked.phase) {
      case "checking":
        return t("mobile.server.update.status.checking");
      case "available":
        return t("mobile.server.update.status.available", { version: checked.latestVersion ?? "" });
      case "up-to-date":
        return t("mobile.server.update.status.upToDate", { name });
      case "error":
        return t("mobile.server.update.releaseCheckFailed", { name });
      case "unavailable":
        return t("mobile.server.update.releaseUnavailable");
      default:
        return t("mobile.server.update.status.idle");
    }
  }
  if (status.phase === "unsupported") return t("mobile.server.update.releaseUnavailable");
  if (status.errorCode === "install_failed") return t("mobile.server.update.status.installFailed", { name });
  switch (status.phase) {
    case "checking":
      return t("mobile.server.update.status.checking");
    case "available":
      return t("mobile.server.update.status.available", { version });
    case "downloading":
      return status.progress === null
        ? t("mobile.server.update.status.downloadingUnknown", { version })
        : t("mobile.server.update.status.downloading", { version, progress: format.percent(status.progress / 100) });
    case "ready":
      return t("mobile.server.update.status.ready", { version });
    case "installing":
      return t("mobile.server.update.status.installing", { name });
    case "up-to-date":
      return t("mobile.server.update.status.upToDate", { name });
    case "error":
      return status.errorCode === "download_failed"
        ? t("mobile.server.update.status.downloadFailed", { name })
        : t("mobile.server.update.status.checkFailed", { name });
    default:
      return t("mobile.server.update.status.idle");
  }
}

/** Who asked for the restart, and the work that it waits for. */
function restartMessage({ t, format }: MobileText, status: HostUpdateStatus, name: string): string {
  const restart = status.restart;
  if (!restart) return "";
  const origin =
    restart.requestedBy === null
      ? t("mobile.server.update.automatic", { name })
      : t("mobile.server.update.requestedBy", { member: restart.requestedBy });
  if (restart.waitingFor.length === 0) return origin;
  const reasons = format.list(
    restart.waitingFor.map((reason) => t(RESTART_REASON_KEYS[reason] ?? "mobile.server.update.reason.other")),
  );
  return `${origin} ${t("mobile.server.update.waitingFor", { reasons })}`;
}
