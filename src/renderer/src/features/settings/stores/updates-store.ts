import type { AppInfo, UpdateStatus } from "@openbot/contracts/ipc";
import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
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
  const installedVersion = () => props.updateStatus.currentVersion || props.appInfo?.version || "Unknown";
  const targetUpdate = () =>
    props.updateStatus.availableVersion
      ? `OpenBot v${props.updateStatus.availableVersion}`
      : "The latest OpenBot update";
  const message = () => {
    if (error()) return error();
    switch (props.updateStatus.phase) {
      case "idle":
        return "Check for updates to find the latest Stable release.";
      case "checking":
        return "Checking the Stable track for updates…";
      case "available":
        return `${targetUpdate()} is available to download.`;
      case "downloading":
        return `Downloading ${targetUpdate()}${
          props.updateStatus.progress === null ? "…" : ` · ${Math.round(props.updateStatus.progress)}%`
        }`;
      case "ready":
        return `${targetUpdate()} is ready. Restart to apply.`;
      case "installing":
        return `Restarting to apply ${targetUpdate()}…`;
      case "up-to-date":
        return "OpenBot is up to date on the Stable track.";
      case "error":
        return props.updateStatus.message ?? "OpenBot could not check for updates.";
      case "unsupported":
        return props.updateStatus.message ?? "Updates are unavailable in this build.";
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
      setError(failure instanceof Error ? failure.message : "Could not update OpenBot.");
    }
  }

  return { installedVersion, message, messageClass, presentation, runAction };
}

export type SettingsUpdatesStore = ReturnType<typeof createSettingsUpdatesStore>;
