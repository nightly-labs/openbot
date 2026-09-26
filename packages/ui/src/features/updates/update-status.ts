import type { UpdateStatus } from "@openbot/contracts/ipc";
import { isUpdateActivePhase, isUpdateBusyPhase } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText, type TextValue } from "../../text";

export interface UpdateStatusPresentation {
  actionLabel: string;
  available: boolean;
  busy: boolean;
  detail: string;
  supported: boolean;
  /** The host installs updates for every tenant: status stays visible, actions stay disabled. */
  managed: boolean;
}

export function presentUpdateStatus(
  status: UpdateStatus,
  text: Pick<TextValue, "t" | "format"> = currentText(),
): UpdateStatusPresentation {
  const available = isUpdateActivePhase(status.phase);
  const busy = isUpdateBusyPhase(status.phase);
  const managed = status.managedByHost === true;
  let actionLabel: AppTextKey = "update.action.check";

  switch (status.phase) {
    case "checking":
      actionLabel = "update.action.checking";
      break;
    case "available":
      actionLabel = "update.action.download";
      break;
    case "downloading":
      actionLabel = "update.action.downloading";
      break;
    case "ready":
      actionLabel = "update.action.restart";
      break;
    case "installing":
      actionLabel = "update.action.restarting";
      break;
    case "error":
      // A failed download is retried in place rather than sending the user back through a check. A
      // failed install is not retryable: shutdown preparation has already run, so the message asks
      // for a relaunch and the action falls back to checking.
      if (status.errorCode === "download_failed") actionLabel = "update.action.retryDownload";
      break;
  }

  let detail = "";
  if (status.phase === "downloading" && status.progress !== null)
    detail = text.format.percent(Math.round(status.progress) / 100);
  else if (status.availableVersion) detail = `v${status.availableVersion}`;
  else if (status.phase === "up-to-date") detail = text.t("update.upToDate");
  else if (status.currentVersion) detail = `v${status.currentVersion}`;

  return {
    actionLabel: text.t(managed ? "update.managedByHost" : actionLabel),
    available,
    busy,
    detail,
    supported: status.phase !== "unsupported",
    managed,
  };
}
