// A newer OpenBot migrated the database, and then an older copy started, for example from an old
// shortcut or a second install (#4969). The older copy cannot read the data, and it must not change
// it. It installs the latest release instead, which opens the data. When it cannot, the user gets a
// download link in place of a dead-end error.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { app, type BrowserWindow, dialog, shell } from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { DOWNLOAD_URL } from "./download-url";
import { readUpdatePreference, UPDATE_PREFERENCE_FILE } from "./update-preference-store";
import {
  electronUpdaterCacheDirectory,
  isNixStoreInstall,
  isValidSemver,
  loadElectronUpdater,
  supportsInstalledUpdates,
  UPDATE_INSTALL_TIMEOUT_MS,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";

const logger = createOpenBotLogger("update");
// The time that the user has to read the download dialog after a stalled install, before the app exits.
const STALLED_INSTALL_DIALOG_MS = 10 * 60_000;
const GUIDE_URL =
  "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md#openbot-says-a-newer-version-saved-your-data";

interface NewerDatabaseRecoveryOptions {
  window: BrowserWindow | null;
  translate: AppTranslate;
  /** Shutdown preparation of the app, as for an in-app update. It exits the app after the deadline. */
  beforeInstall: (deadlineMs: number) => Promise<void>;
}

/**
 * Installs the latest release and restarts into it. Shows a download dialog and quits when the
 * update is not possible or fails. The install quits the app, so this returns only after a failure.
 */
export async function recoverFromNewerDatabase(options: NewerDatabaseRecoveryOptions): Promise<void> {
  const updater = await createRecoveryUpdater(options.beforeInstall);
  if (updater) {
    const progress = new AbortController();
    const quit = { chosen: false };
    void showUpdating(options, progress.signal, quit);
    await installLatest(updater, quit);
    progress.abort();
    if (quit.chosen) return;
    await Effect.runPromise(updater.stop());
  }
  await showUpdateRequired(options.translate);
  app.quit();
}

/**
 * The updater of an installed desktop copy, as `createApplicationServices` builds it. `null` when
 * this copy cannot update itself, or when the user turned off automatic downloads.
 */
async function createRecoveryUpdater(
  beforeInstall: NewerDatabaseRecoveryOptions["beforeInstall"],
): Promise<UpdateService | null> {
  const currentVersion = app.getVersion();
  if (
    !app.isPackaged ||
    isNixStoreInstall() ||
    !supportsInstalledUpdates(process.platform) ||
    !existsSync(join(process.resourcesPath, "app-update.yml")) ||
    !isValidSemver(currentVersion)
  ) {
    return null;
  }
  const preference = await runCauseEffect(
    readUpdatePreference(join(app.getPath("userData"), UPDATE_PREFERENCE_FILE)),
  ).catch(() => null);
  if (!preference?.autoDownload) return null;
  const adapter = await loadElectronUpdater();
  if (!adapter) return null;
  return new UpdateService(adapter, {
    currentVersion,
    enabled: true,
    autoDownload: true,
    // The install times out after `UPDATE_INSTALL_TIMEOUT_MS` from the end of the shutdown preparation.
    // The forced exit waits longer, so the download dialog can show after a stalled install.
    beforeInstall: () => beforeInstall(UPDATE_INSTALL_TIMEOUT_MS + STALLED_INSTALL_DIALOG_MS),
    checkSiblingInstances: () =>
      listSiblingOpenBotInstances({
        executablePath: app.getPath("exe"),
        currentPid: process.pid,
        platform: process.platform,
      }),
    ...(typeof process.getuid === "function" ? { currentUid: process.getuid() } : {}),
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    updaterCacheDirectory: electronUpdaterCacheDirectory(),
  });
}

/** Resolves with the first status in `phases`. `cancel` removes the listener. */
function nextPhase(updater: UpdateService, phases: readonly UpdateStatus["phase"][]) {
  let cancel = () => {};
  const status = new Promise<UpdateStatus>((resolve) => {
    const listener = (next: UpdateStatus) => {
      if (!phases.includes(next.phase)) return;
      cancel();
      resolve(next);
    };
    cancel = () => updater.off("status", listener);
    updater.on("status", listener);
  });
  return { status, cancel };
}

/**
 * Checks, downloads and installs. The install quits the app, so this returns only when no newer
 * release is ready, when the install failed, or when the user chose Quit before the install.
 */
async function installLatest(updater: UpdateService, quit: { readonly chosen: boolean }): Promise<void> {
  updater.start(false);
  // Subscribed before the check: a download that ends at once must not be missed.
  const downloaded = nextPhase(updater, ["ready", "up-to-date", "unsupported", "error"]);
  // With automatic download on, the check starts the download of an available release.
  const checked = await Effect.runPromise(updater.checkForUpdates());
  logger.info(`An older OpenBot started over newer data. Update check: ${checked.phase}.`);
  if (checked.phase !== "available" && checked.phase !== "downloading" && checked.phase !== "ready") {
    downloaded.cancel();
    return;
  }
  const outcome = checked.phase === "ready" ? checked : await downloaded.status;
  downloaded.cancel();
  if (outcome.phase !== "ready" || quit.chosen) return;
  // `quitAndInstall` can return without quitting and report the failure as an error status later.
  const installFailed = nextPhase(updater, ["error"]);
  try {
    await Effect.runPromise(updater.installUpdate());
  } catch (error) {
    installFailed.cancel();
    logger.error("The update over newer data did not install:", toLogValue(error));
    return;
  }
  await installFailed.status;
}

/**
 * A box that says what happens while the update downloads. The main window has not loaded, because
 * the start stopped before the renderer. On macOS a box with no window blocks the main process, and
 * with it the download, so there it shows on the empty window.
 */
async function showUpdating(
  options: NewerDatabaseRecoveryOptions,
  signal: AbortSignal,
  quit: { chosen: boolean },
): Promise<void> {
  const { window, translate } = options;
  const box = {
    type: "info" as const,
    message: translate("startup.newerDataUpdatingTitle"),
    detail: translate("startup.newerDataUpdatingBody"),
    buttons: [translate("startup.newerDataQuit")],
    signal,
  };
  if (process.platform === "darwin") {
    if (!window || window.isDestroyed()) return;
    window.show();
    await dialog.showMessageBox(window, box);
  } else {
    await dialog.showMessageBox(box);
  }
  // The user chose Quit. The abort at the end of the update also closes the box.
  if (signal.aborted) return;
  quit.chosen = true;
  app.quit();
}

async function showUpdateRequired(translate: AppTranslate): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: translate("startup.newerDataTitle"),
    detail: translate("startup.newerDataBody", { version: app.getVersion() }),
    buttons: [
      translate("startup.newerDataDownload"),
      translate("startup.newerDataGuide"),
      translate("startup.newerDataQuit"),
    ],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) await shell.openExternal(DOWNLOAD_URL);
  if (response === 1) await shell.openExternal(GUIDE_URL);
}
