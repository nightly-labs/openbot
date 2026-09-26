import type { AppInfo, UpdateStatus } from "@openbot/contracts/ipc";
import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import { currentText } from "../../../text";
import { presentUpdateStatus } from "../../updates/update-status";

interface UpdatesStoreProps {
  appInfo: AppInfo | null;
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
}

/**
 * The Updates tab's view of the updater. Every value but `error` is derived from the live
 * `updateStatus` prop, so the store holds one signal: what the last action call threw.
 */
export function createSettingsUpdatesStore(props: UpdatesStoreProps) {
  const [error, setError] = createSignal<string | null>(null);

  const presentation = createMemo(() => presentUpdateStatus(props.updateStatus));
  const installedVersion = () =>
    props.updateStatus.currentVersion || props.appInfo?.version || currentText().t("settings.updates.versionUnknown");
  const targetUpdate = () =>
    props.updateStatus.availableVersion
      ? `OpenBot v${props.updateStatus.availableVersion}`
      : currentText().t("settings.updates.target.latest");
  /**
   * Host phases arrive mapped onto the shared update phases, so the managed wording says what the
   * host is doing rather than asking a tenant to restart an application the host replaces.
   */
  const hostMessage = () => {
    const { t, errorMessage } = currentText();
    switch (props.updateStatus.phase) {
      case "idle":
      case "up-to-date":
        return t("settings.updates.host.upToDate");
      case "ready":
        return t("settings.updates.host.ready", { target: targetUpdate() });
      case "installing":
        return t("settings.updates.host.installing", { target: targetUpdate() });
      case "error":
        return errorMessage(props.updateStatus.message, t("settings.updates.host.failed"));
      default:
        return null;
    }
  };
  const message = () => {
    if (error()) return error();
    const { t, format, errorMessage, sourceText } = currentText();
    if (presentation().managed) {
      const managedMessage = hostMessage();
      if (managedMessage) return managedMessage;
    }
    switch (props.updateStatus.phase) {
      case "idle":
        return t("settings.updates.status.idle");
      case "checking":
        return t("settings.updates.status.checking");
      case "available":
        return t("settings.updates.status.available", { target: targetUpdate() });
      case "downloading":
        return props.updateStatus.progress === null
          ? t("settings.updates.status.downloading", { target: targetUpdate() })
          : t("settings.updates.status.downloadingProgress", {
              target: targetUpdate(),
              progress: format.percent(Math.round(props.updateStatus.progress) / 100),
            });
      case "ready":
        return t("settings.updates.status.ready", { target: targetUpdate() });
      case "installing":
        return t("settings.updates.status.installing", { target: targetUpdate() });
      case "up-to-date":
        return t("settings.updates.status.upToDate");
      case "error":
        return errorMessage(props.updateStatus.message, t("settings.updates.status.checkFailed"));
      case "unsupported":
        return props.updateStatus.message !== null
          ? sourceText(props.updateStatus.message)
          : t("settings.updates.status.unsupported");
    }
  };
  const messageClass = () => {
    if (error() || props.updateStatus.phase === "error") return "settings-modal-update-status settings-modal-error";
    if (isUpdateActivePhase(props.updateStatus.phase)) {
      return "settings-modal-update-status settings-modal-update-status-active";
    }
    return "settings-modal-update-status";
  };

  async function runAction(): Promise<void> {
    if (presentation().busy || !presentation().supported) return;
    setError(null);
    try {
      await props.onUpdateAction();
    } catch (failure) {
      const text = currentText();
      setError(text.errorMessage(failure, text.t("settings.updates.actionFailed")));
    }
  }

  return { installedVersion, message, messageClass, presentation, runAction };
}

export type SettingsUpdatesStore = ReturnType<typeof createSettingsUpdatesStore>;
