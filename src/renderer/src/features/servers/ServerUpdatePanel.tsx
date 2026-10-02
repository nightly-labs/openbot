import type {
  HostUpdateSettingsChange,
  HostUpdateStatus,
  OpenBotDesktopApi,
  UpdateRestartMode,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Clock3,
  ConfirmDialog,
  Info,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  SettingsSection,
  SwitchField,
  TriangleAlert,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { watchHostUpdate } from "./host-update-toast";

/** The update calls of one server's host. The desktop reaches them through main. */
export type HostUpdateCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getUpdateStatus" | "checkForUpdate" | "startUpdate" | "cancelUpdate" | "setUpdateSettings"
>;

export interface ServerUpdateOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostUpdateCalls;
}

/** How often the status is read again while the host checks, downloads or waits to restart. */
const POLL_MS = 1000;
/** The wait after a read failed, so a host that restarts is not asked every second. */
const RETRY_MS = 5000;

const REASON_LABELS: Record<string, AppTextKey> = {
  "agent-turn": "server.update.reason.agentTurn",
  "queued-delivery": "server.update.reason.queuedDelivery",
  "drain-task": "server.update.reason.drainTask",
  "routine-run": "server.update.reason.routineRun",
  "channel-work": "server.update.reason.channelWork",
  "provider-process": "server.update.reason.providerProcess",
  "remote-desktop": "server.update.reason.remoteDesktop",
  "browser-view": "server.update.reason.browserView",
  "file-transfer": "server.update.reason.fileTransfer",
  "browser-control": "server.update.reason.browserControl",
  "update-operation": "server.update.reason.updateOperation",
  initialization: "server.update.reason.initialization",
};

/**
 * Server Settings > Updates: the OpenBot update of a joined server's host (`host-update-v1`). The
 * host sends no progress event, so the panel reads the status again while something runs there.
 * The host checks the admin role again on every call.
 */
export function ServerUpdatePanel(
  props: ServerUpdateOptions & { serverId: string; hostName: string; actionsAvailable: boolean },
) {
  const { t, format, errorMessage } = useText();
  const calls = (): HostUpdateCalls => props.calls ?? window.openbot.hostAdmin;
  const [status, setStatus] = createSignal<HostUpdateStatus | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [confirmRestart, setConfirmRestart] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped for each server and on unmount, so an answer for an earlier one is dropped. */
  let generation = 0;

  function stopPolling(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function show(next: HostUpdateStatus): void {
    setStatus(next);
    setLoadError(null);
    stopPolling();
    if (running(next)) timer = setTimeout(() => void read(), POLL_MS);
  }

  async function read(): Promise<void> {
    const current = generation;
    const serverId = props.serverId;
    try {
      const next = await calls().getUpdateStatus(serverId);
      if (current === generation) show(next);
    } catch (error) {
      if (current !== generation) return;
      setLoadError(errorMessage(error, t("server.update.loadFailed", { name: props.hostName })));
      stopPolling();
      timer = setTimeout(() => void read(), RETRY_MS);
    }
  }

  createEffect(
    () => props.serverId,
    () => {
      generation += 1;
      stopPolling();
      setStatus(null);
      setLoadError(null);
      void untrack(read);
    },
  );
  onCleanup(() => {
    generation += 1;
    stopPolling();
  });

  async function act(key: string, call: (serverId: string) => Promise<HostUpdateStatus>): Promise<void> {
    if (busy()) return;
    const current = generation;
    setBusy(key);
    try {
      const next = await call(props.serverId);
      if (current === generation) show(next);
    } catch (error) {
      actionToast.error(t("server.settings.actionFailedTitle"), {
        description: errorMessage(error, t("server.settings.actionFailed")),
      });
    } finally {
      setBusy(null);
    }
  }

  const changeSettings = (settings: HostUpdateSettingsChange) =>
    act("settings", (serverId) => calls().setUpdateSettings(settings, serverId));
  // The download toast keeps the percentage in view after Server Settings closes.
  const start = (mode: UpdateRestartMode) =>
    act(`start-${mode}`, async (serverId) => {
      const next = await calls().startUpdate(mode, serverId);
      watchHostUpdate({ serverId, name: props.hostName, calls: calls(), offer: false }, next);
      return next;
    });
  const blocked = () => {
    const remote = status()?.remoteUpdates;
    return remote === "disabled" || remote === "managed" || status()?.phase === "unsupported";
  };
  const disabled = () => !props.actionsAvailable || Boolean(busy()) || blocked();
  const version = (current: HostUpdateStatus) => current.availableVersion ?? current.currentVersion;
  const waitingFor = (current: HostUpdateStatus) =>
    format.list(
      current.restart?.waitingFor.map((reason) => t(REASON_LABELS[reason] ?? "server.update.reason.other")) ?? [],
    );

  function message(current: HostUpdateStatus): string {
    const name = props.hostName;
    if (current.errorCode === "install_failed") return t("server.update.status.installFailed", { name });
    switch (current.phase) {
      case "checking":
        return t("server.update.status.checking");
      case "available":
        return t("server.update.status.available", { version: version(current) });
      case "downloading":
        return t("server.update.status.downloading", {
          version: version(current),
          progress: format.percent((current.progress ?? 0) / 100),
        });
      case "ready":
        return t("server.update.status.ready", { version: version(current) });
      case "installing":
        return t("server.update.status.installing", { name });
      case "up-to-date":
        return t("server.update.status.upToDate", { name });
      case "error":
        return current.errorCode === "download_failed"
          ? t("server.update.status.downloadFailed", { name })
          : t("server.update.status.checkFailed", { name });
      default:
        return t("server.update.status.idle");
    }
  }

  return (
    <>
      <SettingsSection title={t("server.update.hostTitle", { name: props.hostName })}>
        <Show when={loadError()}>
          {(error) => (
            <Alert tone="danger" role="alert">
              <AlertIcon>
                <TriangleAlert />
              </AlertIcon>
              <AlertContent>
                <AlertDescription>{error()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>
        <Show when={status()}>
          {(current) => (
            <>
              <BlockedNotice status={current()} hostName={props.hostName} />
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{t("server.update.version", { version: current().currentVersion })}</ItemTitle>
                    <ItemDescription aria-live="polite">{message(current())}</ItemDescription>
                    <Show when={current().phase === "downloading"}>
                      <Progress
                        value={current().progress ?? 0}
                        indeterminate={current().progress === null}
                        aria-label={message(current())}
                      />
                    </Show>
                  </ItemContent>
                  <ItemActions>
                    <Show when={current().phase !== "installing" && !current().restart}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        loading={busy() === "check" || current().phase === "checking"}
                        disabled={disabled()}
                        onClick={() => void act("check", (serverId) => calls().checkForUpdate(serverId))}
                      >
                        {t("server.update.check")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        loading={busy() === "start-when-idle"}
                        // Only a relaunch of the host recovers from a failed install.
                        disabled={
                          disabled() || current().phase === "up-to-date" || current().errorCode === "install_failed"
                        }
                        onClick={() => void start("when-idle")}
                      >
                        {t("server.update.start")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
                <SwitchField
                  checked={current().autoDownload}
                  disabled={disabled()}
                  onChange={(autoDownload) => void changeSettings({ autoDownload })}
                  label={t("server.update.autoDownloadTitle")}
                  description={t("server.update.autoDownloadDescription", { name: props.hostName })}
                />
                <SwitchField
                  checked={current().autoInstall}
                  disabled={disabled()}
                  onChange={(autoInstall) => void changeSettings({ autoInstall })}
                  label={t("server.update.autoInstallTitle")}
                  description={t("server.update.autoInstallDescription", { name: props.hostName })}
                />
              </ItemGroup>
              <Show when={current().restart}>
                {(restart) => (
                  <Alert tone="neutral" role="status">
                    <AlertIcon>
                      <Clock3 />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>
                        {restart().mode === "now"
                          ? t("server.update.scheduledNowTitle", { name: props.hostName })
                          : t("server.update.scheduledTitle", { name: props.hostName })}
                      </AlertTitle>
                      <AlertDescription>
                        {restart().requestedBy === null
                          ? t("server.update.automatic", { name: props.hostName })
                          : t("server.update.requestedBy", { member: restart().requestedBy ?? "" })}
                        <Show when={restart().waitingFor.length > 0}>
                          {" "}
                          {t("server.update.waitingFor", { reasons: waitingFor(current()) })}
                        </Show>
                      </AlertDescription>
                    </AlertContent>
                    <Show when={current().phase !== "installing"}>
                      <AlertActions>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={busy() === "cancel"}
                          disabled={!props.actionsAvailable || Boolean(busy())}
                          onClick={() => void act("cancel", (serverId) => calls().cancelUpdate(serverId))}
                        >
                          {t("server.update.cancel")}
                        </Button>
                        <Show when={restart().mode === "when-idle"}>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={disabled()}
                            onClick={() => setConfirmRestart(true)}
                          >
                            {t("server.update.restartNow")}
                          </Button>
                        </Show>
                      </AlertActions>
                    </Show>
                  </Alert>
                )}
              </Show>
            </>
          )}
        </Show>
      </SettingsSection>
      <Show when={confirmRestart()}>
        <ConfirmDialog
          open
          tone="destructive"
          initialFocus="cancel"
          pending={busy() === "start-now"}
          title={t("server.update.restartConfirmTitle", { name: props.hostName })}
          description={t("server.update.restartConfirmDescription", { name: props.hostName })}
          confirmLabel={t("server.update.restartNow")}
          pendingLabel={t("server.update.restarting")}
          onCancel={() => setConfirmRestart(false)}
          onConfirm={async () => {
            await start("now");
            setConfirmRestart(false);
          }}
        />
      </Show>
    </>
  );
}

/** Why no action can run: the host user turned it off, a Host Manager owns updates, or no updater. */
function BlockedNotice(props: { status: HostUpdateStatus; hostName: string }) {
  const { t } = useText();
  const notice = (): { title: string; description: string } | null => {
    const name = props.hostName;
    if (props.status.remoteUpdates === "disabled")
      return { title: t("server.update.disabledTitle"), description: t("server.update.disabledDescription", { name }) };
    if (props.status.remoteUpdates === "managed")
      return { title: t("server.update.managedTitle"), description: t("server.update.managedDescription", { name }) };
    if (props.status.phase === "unsupported")
      return {
        title: t("server.update.unsupportedTitle", { name }),
        description: t("server.update.unsupportedDescription", { name }),
      };
    return null;
  };
  return (
    <Show when={notice()}>
      {(current) => (
        <Alert tone="warning" role="status">
          <AlertIcon>
            <Info />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{current().title}</AlertTitle>
            <AlertDescription>{current().description}</AlertDescription>
          </AlertContent>
        </Alert>
      )}
    </Show>
  );
}

function running(status: HostUpdateStatus): boolean {
  return (
    status.phase === "checking" ||
    status.phase === "downloading" ||
    status.phase === "installing" ||
    status.restart !== null
  );
}
