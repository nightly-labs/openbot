import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { isNewerRelease, isValidSemver } from "@openbot/contracts/release-version";
import type { AppTranslate } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { app, type BrowserWindow, dialog, shell } from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { DOWNLOAD_URL, RELEASES_URL } from "./download-url";
import { UPDATE_HANDOVER_FILE } from "./update-install-guard";
import { readUpdatePreference, UPDATE_PREFERENCE_FILE } from "./update-preference-store";
import {
  electronUpdaterCacheDirectory,
  isNixStoreInstall,
  loadElectronUpdater,
  supportsInstalledUpdates,
  UPDATE_INSTALL_TIMEOUT_MS,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";

const logger = createOpenBotLogger("update");
const STALLED_INSTALL_DIALOG_MS = 10 * 60_000;
const GUIDE_URL =
  "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md#openbot-says-a-newer-version-saved-your-data";

interface NewerDatabaseRecoveryOptions {
  window: BrowserWindow | null;
  translate: AppTranslate;
  beforeInstall: (deadlineMs: number) => Promise<void>;
  loopVersion: string | null;
}

export async function recoverFromNewerDatabase(options: NewerDatabaseRecoveryOptions): Promise<void> {
  const loopVersion =
    options.loopVersion && isNewerRelease(options.loopVersion, app.getVersion()) ? options.loopVersion : null;
  const updater = await createRecoveryUpdater(options.beforeInstall);
  if (updater) {
    const progress = new AbortController();
    const quit = { chosen: false };
    void showUpdating(options, progress.signal, quit);
    await installLatest(updater, quit, loopVersion);
    progress.abort();
    if (quit.chosen) return;
    await Effect.runPromise(updater.stop());
  }
  if (loopVersion) {
    logger.warn(
      `An older OpenBot started over newer data, and OpenBot ${loopVersion} did not start. Not installing it.`,
    );
    await showLatestDidNotStart(options.translate, loopVersion);
  } else {
    await showUpdateRequired(options.translate);
  }
  app.quit();
}

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
    appImagePath: process.env.APPIMAGE?.trim() || undefined,
    ...(process.platform === "darwin" ? { handoverPath: join(app.getPath("userData"), UPDATE_HANDOVER_FILE) } : {}),
    updaterCacheDirectory: electronUpdaterCacheDirectory(),
  });
}

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

async function installLatest(
  updater: UpdateService,
  quit: { readonly chosen: boolean },
  loopVersion: string | null,
): Promise<void> {
  updater.start(false);
  const downloaded = nextPhase(updater, ["ready", "up-to-date", "unsupported", "error"]);
  const checked = await Effect.runPromise(updater.checkForUpdates());
  logger.info(`An older OpenBot started over newer data. Update check: ${checked.phase}.`);
  if (checked.phase !== "available" && checked.phase !== "downloading" && checked.phase !== "ready") {
    downloaded.cancel();
    return;
  }
  const startsAgain = (version: string | null) =>
    !loopVersion || (version !== null && isNewerRelease(version, loopVersion));
  if (checked.availableVersion !== null && !startsAgain(checked.availableVersion)) {
    downloaded.cancel();
    return;
  }
  const outcome = checked.phase === "ready" ? checked : await downloaded.status;
  downloaded.cancel();
  if (outcome.phase !== "ready" || quit.chosen) return;
  if (!startsAgain(outcome.availableVersion ?? checked.availableVersion)) return;
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

async function showLatestDidNotStart(translate: AppTranslate, loopVersion: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: translate("startup.newerDataLoopTitle"),
    detail: translate("startup.newerDataLoopBody", { version: app.getVersion(), loopVersion }),
    buttons: [
      translate("startup.newerDataReleases"),
      translate("startup.newerDataGuide"),
      translate("startup.newerDataQuit"),
    ],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) await shell.openExternal(RELEASES_URL);
  if (response === 1) await shell.openExternal(GUIDE_URL);
}
