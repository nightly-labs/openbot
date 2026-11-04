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
import { electronUpdaterCacheRoot } from "./application-services";
import {
  isNixStoreInstall,
  isValidSemver,
  supportsInstalledUpdates,
  type UpdateAdapter,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";

const logger = createOpenBotLogger("update");
const DOWNLOAD_URL = "https://openbot.run/download";
const GUIDE_URL =
  "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md#openbot-says-a-newer-version-saved-your-data";

interface NewerDatabaseRecoveryOptions {
  window: BrowserWindow | null;
  translate: AppTranslate;
  /** Shutdown preparation of the app, as for an in-app update. */
  beforeInstall: () => Promise<void>;
}

/**
 * Installs the latest release and restarts into it. Shows a download dialog and quits when the
 * update is not possible or fails. The install quits the app, so this returns only after a failure.
 */
export async function recoverFromNewerDatabase(options: NewerDatabaseRecoveryOptions): Promise<void> {
  const updater = await createRecoveryUpdater(options.beforeInstall);
  if (updater) {
    const progress = new AbortController();
    void showUpdating(options, progress.signal);
    const installed = await installLatest(updater);
    progress.abort();
    if (installed) return;
    await Effect.runPromise(updater.stop());
  }
  await showUpdateRequired(options.translate);
  app.quit();
}

/** The updater of an installed desktop copy, as `createApplicationServices` builds it. */
async function createRecoveryUpdater(beforeInstall: () => Promise<void>): Promise<UpdateService | null> {
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
  let adapter: UpdateAdapter | undefined;
  try {
    const updaterModule = await import("electron-updater");
    adapter = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater ?? updaterModule.default;
  } catch (error) {
    logger.warn("electron-updater failed to load:", toLogValue(error));
  }
  if (!adapter) return null;
  return new UpdateService(adapter, {
    currentVersion,
    enabled: true,
    autoDownload: true,
    beforeInstall,
    checkSiblingInstances: () =>
      listSiblingOpenBotInstances({
        executablePath: app.getPath("exe"),
        currentPid: process.pid,
        platform: process.platform,
      }),
    ...(typeof process.getuid === "function" ? { currentUid: process.getuid() } : {}),
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    updaterCacheDirectory: join(electronUpdaterCacheRoot(), "openbot-updater"),
  });
}

/** Checks, downloads and installs. `false` when no newer release is ready or the install failed. */
async function installLatest(updater: UpdateService): Promise<boolean> {
  updater.start(false);
  const ready = new Promise<boolean>((resolve) => {
    const settle = (status: UpdateStatus) => {
      if (status.phase === "ready") resolve(true);
      else if (status.phase === "up-to-date" || status.phase === "unsupported" || status.phase === "error") {
        resolve(false);
      } else return;
      updater.off("status", settle);
    };
    updater.on("status", settle);
  });
  // With automatic download on, the check starts the download of an available release.
  const checked = await Effect.runPromise(updater.checkForUpdates());
  logger.info(`An older OpenBot started over newer data. Update check: ${checked.phase}.`);
  if (checked.phase !== "available" && checked.phase !== "downloading" && checked.phase !== "ready") return false;
  if (!(await ready)) return false;
  try {
    await Effect.runPromise(updater.installUpdate());
    return true;
  } catch (error) {
    logger.error("The update over newer data did not install:", toLogValue(error));
    return false;
  }
}

/**
 * A box that says what happens while the update downloads. It waits for the window, so it does not
 * open behind it. On macOS a box with no visible window blocks the main process, and with it the
 * download, so there it shows only on the window.
 */
async function showUpdating(options: NewerDatabaseRecoveryOptions, signal: AbortSignal): Promise<void> {
  const { window, translate } = options;
  const parent = window && !window.isDestroyed() ? window : null;
  if (!parent && process.platform === "darwin") return;
  if (parent && !parent.isVisible()) await new Promise<void>((resolve) => parent.once("show", () => resolve()));
  if (signal.aborted || parent?.isDestroyed()) return;
  const box = {
    type: "info" as const,
    message: translate("startup.newerDataUpdatingTitle"),
    detail: translate("startup.newerDataUpdatingBody"),
    buttons: [translate("startup.newerDataQuit")],
    signal,
  };
  await (parent ? dialog.showMessageBox(parent, box) : dialog.showMessageBox(box));
  // The user chose Quit. The abort at the end of the update also closes the box.
  if (!signal.aborted) app.quit();
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
