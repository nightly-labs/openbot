import { EventEmitter } from "node:events";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  IdleRestart,
  ScheduledUpdateRestart,
  UpdateBusyPhase,
  UpdateFailureCode,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { isUpdateBusyPhase } from "@openbot/contracts/ipc";
import { isNewerRelease } from "@openbot/contracts/release-version";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Deferred, Effect, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { HostUpdateState } from "../../packages/contracts/src/host-manager";
import { causeHelpers } from "../backend/effect-boundary";
import { writeUpdateHandover, writeUpdateInstallRecord } from "./update-install-guard";
import type { OpenBotSiblingInstance, SiblingScanFailed } from "./update-sibling-instances";
import { verifyWindowsUpdateSignature } from "./windows-update-signature";

const logger = createOpenBotLogger("update");

export type UpdateCancellationToken = {
  readonly cancelled: boolean;
  cancel: () => void;
};

export type UpdateCheckOutcome = {
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: { readonly version: string };
  readonly cancellationToken?: UpdateCancellationToken;
};

export type UpdateAdapter = {
  allowPrerelease: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<UpdateCheckOutcome | null>;
  downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<unknown>;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (progress: ProgressInfo) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  isUserWithinRollout?: (info: UpdateInfo) => boolean | Promise<boolean>;
};

export function createDisabledUpdateAdapter(): UpdateAdapter {
  return {
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: async () => null,
    downloadUpdate: async () => [],
    on: () => undefined,
    quitAndInstall: () => undefined,
  };
}

export async function loadElectronUpdater(): Promise<UpdateAdapter | null> {
  try {
    const updaterModule = await import("electron-updater");
    const adapter = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater ?? updaterModule.default;
    const NsisUpdater = updaterModule.NsisUpdater ?? updaterModule.default?.NsisUpdater;
    if (NsisUpdater && adapter instanceof NsisUpdater) {
      adapter.verifyUpdateCodeSignature = (publisherNames, file) =>
        Effect.runPromise(verifyWindowsUpdateSignature(publisherNames, file));
    }
    if (adapter) return adapter;
    logger.warn("OpenBot updates are disabled: electron-updater did not export autoUpdater");
  } catch {
    logger.warn("OpenBot updates are disabled: electron-updater failed to load");
  }
  return null;
}

export function electronUpdaterCacheDirectory(): string {
  const root =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(root, "openbot-updater");
}

type UpdateOperation = "check" | "download" | "install";

interface UpdateServiceEvents {
  status: [status: UpdateStatus];
  diagnostic: [event: UpdateDiagnosticEvent];
}

interface UpdateServiceOptions {
  currentVersion: string;
  enabled: boolean;
  autoDownload: boolean;
  beforeInstall: () => Promise<void>;
  checkSiblingInstances?: (() => Effect.Effect<readonly OpenBotSiblingInstance[], SiblingScanFailed>) | undefined;
  currentUid?: number | undefined;
  platform?: NodeJS.Platform;
  appBundlePath?: string | undefined;
  appImagePath?: string | undefined;
  logDirectory?: string;
  shipItDirectory?: string | undefined;
  handoverPath?: string | undefined;
  installRecordPath?: string | undefined;
  notInstalledVersion?: string | null | undefined;
  updaterCacheDirectory?: string | undefined;
  initialCheckDelayMs?: number;
  checkIntervalMs?: number;
  checkTimeoutMs?: number;
  downloadStallTimeoutMs?: number;
  installTimeoutMs?: number;
}

export interface UpdateDiagnosticEvent {
  at: string;
  phase: UpdateStatus["phase"];
  errorCode: UpdateFailureCode | null;
}

const DEFAULT_CHECK_INTERVAL = 4 * 60 * 1_000;
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_EVENTS = 20;

export const UPDATE_INSTALL_TIMEOUT_MS = 300_000;

const DEFAULT_PHASE_TIMEOUTS: Record<UpdateBusyPhase, number> = {
  checking: 90_000,
  downloading: 120_000,
  installing: UPDATE_INSTALL_TIMEOUT_MS,
};

export function supportsInstalledUpdates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform === "linux") return Boolean(environment.APPIMAGE?.trim());
  return platform === "darwin" || platform === "win32";
}

export function isNixStoreInstall(executablePath: string = process.execPath): boolean {
  return executablePath.startsWith("/nix/store/");
}

function unsupportedMessage(): string {
  return sourceText(isNixStoreInstall() ? "error.update.managedByNix" : "error.update.unsupported");
}

export class UpdateService extends EventEmitter<UpdateServiceEvents> {
  readonly #updater: UpdateAdapter;
  readonly #options: Required<
    Pick<UpdateServiceOptions, "currentVersion" | "enabled" | "platform" | "initialCheckDelayMs" | "checkIntervalMs">
  > &
    Pick<
      UpdateServiceOptions,
      | "appBundlePath"
      | "appImagePath"
      | "beforeInstall"
      | "checkSiblingInstances"
      | "currentUid"
      | "handoverPath"
      | "installRecordPath"
      | "logDirectory"
      | "notInstalledVersion"
      | "shipItDirectory"
      | "updaterCacheDirectory"
    > & {
      phaseTimeoutsMs: Record<UpdateBusyPhase, number>;
    };
  #status: UpdateStatus;
  #checkTimer: ReturnType<typeof setTimeout> | null = null;
  #phaseTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #checksScheduled = false;
  #installStarted = false;
  #pendingInstallRequests = 0;
  #installHandedOver = false;
  #operation: UpdateOperation = "check";
  #history: UpdateDiagnosticEvent[] = [];
  readonly #logLock = Semaphore.makeUnsafe(1);
  readonly #logWrites = new Set<Fiber.Fiber<void, UpdateOperationFailure>>();
  readonly #workScope = Scope.makeUnsafe();
  #autoDownload: boolean;
  #downloadedVersion: string | null = null;
  #managedByHost = false;
  #scheduledRestart: ScheduledUpdateRestart | null = null;
  #idleRestart: IdleRestart | null = null;
  #cancellationToken: UpdateCancellationToken | null = null;
  #checkGeneration = 0;
  #downloadGeneration = 0;
  #installGeneration = 0;
  #activeDownload: number | null = null;
  #activeInstall: number | null = null;
  #checkRequest: Deferred.Deferred<UpdateCheckOutcome | null, UpdateOperationFailure> | null = null;
  #downloadInFlight = false;
  #teardownCommitted = false;
  #requestedVersion: string | null = null;
  #rolloutMiss: string | null = null;
  #stagedVersion: string | null = null;
  #requiredVersion: string | null = null;

  constructor(updater: UpdateAdapter, options: UpdateServiceOptions) {
    super();
    this.#updater = updater;
    this.#autoDownload = options.autoDownload;
    this.#options = {
      ...options,
      platform: options.platform ?? process.platform,
      initialCheckDelayMs: options.initialCheckDelayMs ?? 12_000,
      checkIntervalMs: options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL,
      phaseTimeoutsMs: {
        checking: options.checkTimeoutMs ?? DEFAULT_PHASE_TIMEOUTS.checking,
        downloading: options.downloadStallTimeoutMs ?? DEFAULT_PHASE_TIMEOUTS.downloading,
        installing: options.installTimeoutMs ?? DEFAULT_PHASE_TIMEOUTS.installing,
      },
    };
    if (options.notInstalledVersion)
      logger.warn(`The last update restart did not install OpenBot ${options.notInstalledVersion}.`);
    this.#status = {
      phase: options.enabled ? "idle" : "unsupported",
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      checkedAt: null,
      message: options.enabled ? null : unsupportedMessage(),
      errorCode: null,
    };
    this.on("diagnostic", (event) => {
      const directory = this.#options.logDirectory;
      if (!directory) return;
      const write = Effect.runFork(this.#logLock.withPermit(appendUpdateLog(directory, event)));
      this.#logWrites.add(write);
      write.addObserver(() => this.#logWrites.delete(write));
    });
    this.#recordStatus();
  }

  flushLog(): Effect.Effect<void> {
    return Effect.suspend(() => Fiber.awaitAll([...this.#logWrites])).pipe(Effect.asVoid);
  }

  start(scheduleChecks = true): void {
    if (this.#started) return;
    this.#started = true;
    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = false;
    this.#updater.allowPrerelease = false;
    const stagedRollout = this.#updater.isUserWithinRollout;
    if (stagedRollout) {
      this.#updater.isUserWithinRollout = async (info) => {
        const percentage = stagingPercentage(info.stagingPercentage);
        if (percentage !== 0 && info.version === this.#requestedVersion) return true;
        const within = await stagedRollout(info);
        if (!within && percentage !== null && percentage > 0) this.#rolloutMiss = info.version;
        return within;
      };
    }

    this.#updater.on("download-progress", (progress: ProgressInfo) => {
      if (!this.#isDownloadLive()) return;
      this.#setStatus({ phase: "downloading", progress: clampProgress(progress.percent), errorCode: null });
    });
    this.#updater.on("update-downloaded", (info: UpdateInfo) => {
      if (!this.#isDownloadLive()) return;
      this.#activeDownload = null;
      this.#markReady(info.version);
    });
    this.#updater.on("error", (error: Error) => {
      if (this.#operation === "install" && this.#installHandedOver && this.#isInstallLive()) {
        this.#installGeneration += 1;
        this.#activeInstall = null;
        logUpdateFailure("OpenBot update install failed.", error);
        this.#setError("install_failed", INSTALL_FAILED_MESSAGE);
        return;
      }
      if (this.#operation === "download" && this.#isDownloadLive()) {
        this.#activeDownload = null;
        this.#setError("download_failed", downloadFailureMessage(error));
      }
    });
    if (this.#options.platform === "darwin" && this.#options.shipItDirectory) {
      this.#fork(pruneShipItLogs(this.#options.shipItDirectory));
    }
    if (this.#options.updaterCacheDirectory) {
      this.#fork(pruneInstalledUpdate(this.#options.updaterCacheDirectory, this.#options.currentVersion));
    }

    this.#checksScheduled = scheduleChecks;
    if (scheduleChecks && this.#options.enabled) {
      this.#scheduleCheck(this.#options.initialCheckDelayMs);
    }
  }

  resume(): void {
    if (!this.#started) return;
    if (!this.#phaseTimer) this.#armPhaseTimer();
    if (!this.#checksScheduled || !this.#options.enabled || this.#checkTimer) return;
    this.#scheduleCheck(this.#options.initialCheckDelayMs);
  }

  getStatus(): UpdateStatus {
    const status = { ...this.#status };
    if (this.#managedByHost) status.managedByHost = true;
    if (this.#scheduledRestart)
      status.scheduledRestart = { ...this.#scheduledRestart, waitingFor: [...this.#scheduledRestart.waitingFor] };
    if (this.#idleRestart) status.idleRestart = { ...this.#idleRestart, waitingFor: [...this.#idleRestart.waitingFor] };
    if (this.#stagedVersion && status.phase === "up-to-date") status.stagedVersion = this.#stagedVersion;
    if (this.#requiredVersion) status.requiredVersion = this.#requiredVersion;
    return status;
  }

  setRequiredVersion(version: string | null): void {
    if (this.#requiredVersion === version) return;
    this.#requiredVersion = version;
    this.emit("status", this.getStatus());
  }

  setScheduledRestart(restart: ScheduledUpdateRestart | null): void {
    this.#scheduledRestart = restart ? { ...restart, waitingFor: [...restart.waitingFor] } : null;
    this.emit("status", this.getStatus());
  }

  setIdleRestart(restart: IdleRestart | null): void {
    this.#idleRestart = restart ? { ...restart, waitingFor: [...restart.waitingFor] } : null;
    this.emit("status", this.getStatus());
  }

  getDiagnostics(): UpdateDiagnosticEvent[] {
    return this.#history.map((event) => ({ ...event }));
  }

  getAutoDownload(): boolean {
    return this.#autoDownload;
  }

  readonly setAutoDownload = Effect.fn("UpdateService.setAutoDownload")(function* (
    this: UpdateService,
    enabled: boolean,
  ) {
    this.#autoDownload = enabled;
    if (enabled && this.#options.enabled && this.#status.phase === "available") {
      yield* Effect.forkIn(this.downloadUpdate(), this.#workScope, { startImmediately: true });
    }
  });

  setManagedByHost(managed: boolean): void {
    if (this.#managedByHost === managed) return;
    this.#managedByHost = managed;
    if (managed) {
      this.#checkGeneration += 1;
      this.#downloadGeneration += 1;
      this.#activeDownload = null;
      this.#cancellationToken?.cancel();
      this.#cancellationToken = null;
      if (this.#installStarted) {
        this.#setStatus({});
        return;
      }
    }
    this.#downloadedVersion = null;
    this.#setStatus({
      phase: this.#options.enabled ? "idle" : "unsupported",
      availableVersion: null,
      progress: null,
      message: null,
      errorCode: null,
    });
    if (!managed && this.#options.enabled) this.#scheduleCheck(this.#options.initialCheckDelayMs);
  }

  setHostState(state: HostUpdateState): void {
    if (!this.#managedByHost) return;
    const phases = {
      idle: "up-to-date",
      downloading: "downloading",
      waiting: "ready",
      stopping: "ready",
      installing: "installing",
      released: "up-to-date",
      failed: "error",
      aborted: "error",
    } as const;
    if (
      this.#status.phase === phases[state.phase] &&
      this.#status.availableVersion === state.version &&
      this.#status.message === state.error
    )
      return;
    this.#setStatus({
      phase: phases[state.phase],
      availableVersion: state.version,
      message: state.error,
      errorCode: state.phase === "failed" || state.phase === "aborted" ? "install_failed" : null,
      progress: null,
    });
  }

  checkForUpdates(): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return this.#check(true);
  }

  #check(joinOutstandingRequest: boolean): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#managedByHost || !this.#options.enabled || this.#teardownCommitted) return this.getStatus();
      if (this.#status.phase === "ready") return yield* this.#checkSupersedingRelease();
      if (["checking", "downloading", "installing"].includes(this.#status.phase)) {
        if (this.#status.phase === "downloading" && !joinOutstandingRequest) {
          this.#scheduleCheck(this.#options.checkIntervalMs);
        }
        return this.getStatus();
      }
      if (this.#checkRequest && !joinOutstandingRequest) {
        this.#scheduleCheck(this.#options.checkIntervalMs);
        return this.getStatus();
      }
      const generation = ++this.#checkGeneration;
      this.#operation = "check";
      this.#setStatus({ phase: "checking", progress: null, message: null, errorCode: null });
      const checked = yield* this.#issueRequestedCheck(joinOutstandingRequest, generation).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#checkGeneration === generation) this.#scheduleCheck(this.#options.checkIntervalMs);
          }),
        ),
      );
      if (this.#checkGeneration !== generation) return this.getStatus();
      this.#stagedVersion = null;
      if (Result.isFailure(checked)) this.#setError("check_failed", describeCheckFailure(checked.failure.cause));
      else {
        const result = checked.success;
        this.#cancellationToken = result?.cancellationToken ?? null;
        if (result?.isUpdateAvailable) {
          if (result.updateInfo.version !== this.#downloadedVersion) this.#downloadedVersion = null;
          this.#markAvailable(result.updateInfo.version);
        } else {
          this.#downloadedVersion = null;
          if (this.#rolloutMiss && isNewerRelease(this.#rolloutMiss, this.#status.currentVersion))
            this.#stagedVersion = this.#rolloutMiss;
          this.#setStatus({
            phase: "up-to-date",
            availableVersion: null,
            progress: null,
            message: null,
            errorCode: null,
            checkedAt: new Date().toISOString(),
          });
        }
      }
      if (this.#autoDownload && this.#status.phase === "available")
        yield* Effect.forkIn(this.downloadUpdate(), this.#workScope, { startImmediately: true });
      return this.getStatus();
    });
  }

  #checkSupersedingRelease(): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#scheduleCheck(this.#options.checkIntervalMs);
      if (!this.#autoDownload || this.#checkRequest) return this.getStatus();
      const downloaded = this.#downloadedVersion;
      const checked = yield* Effect.result(this.#issueCheck());
      if (Result.isFailure(checked)) return this.getStatus();
      const result = checked.success;
      if (
        this.#status.phase !== "ready" ||
        this.#downloadedVersion !== downloaded ||
        this.#installStarted ||
        this.#pendingInstallRequests > 0 ||
        this.#managedByHost ||
        this.#teardownCommitted ||
        !this.#autoDownload ||
        !result?.isUpdateAvailable ||
        downloaded === null ||
        !isNewerRelease(result.updateInfo.version, downloaded)
      ) {
        return this.getStatus();
      }
      this.#cancellationToken = result.cancellationToken ?? null;
      this.#downloadedVersion = null;
      this.#markAvailable(result.updateInfo.version);
      yield* Effect.forkIn(this.downloadUpdate(), this.#workScope, { startImmediately: true });
      return this.getStatus();
    });
  }

  downloadUpdate(): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#managedByHost) return this.getStatus();
      if (!this.#options.enabled || this.#teardownCommitted || !this.#canDownload()) return this.getStatus();
      if (this.#downloadInFlight) return this.getStatus();
      this.#downloadInFlight = true;
      const generation = ++this.#downloadGeneration;
      this.#activeDownload = generation;
      this.#operation = "download";
      this.#setStatus({ phase: "downloading", progress: null, message: null, errorCode: null });
      yield* Effect.gen({ self: this }, function* () {
        const token = yield* this.#ensureCancellationToken();
        if (this.#downloadGeneration !== generation) return;
        if (!token) {
          this.#activeDownload = null;
          this.#setError("download_failed");
          return;
        }
        const result = yield* Effect.result(
          updateIO(() => this.#updater.downloadUpdate(token)).pipe(
            Effect.onInterrupt(() => Effect.sync(() => token.cancel())),
          ),
        );
        if (Result.isFailure(result) && this.#downloadGeneration === generation) {
          logUpdateFailure("OpenBot update download failed.", result.failure.cause);
          this.#activeDownload = null;
          this.#setError("download_failed", downloadFailureMessage(result.failure.cause));
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#downloadInFlight = false;
          }),
        ),
      );
      return this.getStatus();
    });
  }

  installUpdate(): Effect.Effect<void, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#canInstall() || this.#installStarted)
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.notReady")) });
      if (this.#managedByHost) return yield* new UpdateOperationFailure({ cause: new Error(MANAGED_HOST_MESSAGE) });
      yield* this.#install();
    });
  }

  #install(): Effect.Effect<void, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#pendingInstallRequests += 1;
      const siblings = yield* Effect.suspend(
        () => this.#options.checkSiblingInstances?.() ?? Effect.succeed<readonly OpenBotSiblingInstance[]>([]),
      ).pipe(
        Effect.mapError(({ cause }) => new UpdateOperationFailure({ cause })),
        Effect.ensuring(
          Effect.sync(() => {
            this.#pendingInstallRequests -= 1;
          }),
        ),
      );
      if (siblings.length > 0)
        return yield* new UpdateOperationFailure({ cause: new Error(this.#siblingSessionMessage(siblings)) });
      const bundle = this.#options.platform === "darwin" ? this.#options.appBundlePath : undefined;
      if (bundle && (yield* isOnReadOnlyVolume(bundle))) {
        logger.warn("OpenBot update install refused: the application runs from a read-only volume.");
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.readOnlyLocation")) });
      }
      const appImage = this.#options.platform === "linux" ? this.#options.appImagePath : undefined;
      const appImageProblem = appImage ? yield* findAppImageInstallProblem(appImage) : null;
      if (appImageProblem === "missing") {
        logger.warn("OpenBot update install refused: the AppImage file is missing.");
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.appImageMissing")) });
      }
      if (appImageProblem === "readOnly") {
        logger.warn("OpenBot update install refused: the AppImage folder is not writable.");
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.appImageReadOnly")) });
      }
      if (this.#managedByHost) return yield* new UpdateOperationFailure({ cause: new Error(MANAGED_HOST_MESSAGE) });
      if (!this.#canInstall() || this.#installStarted)
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.notReady")) });
      const generation = ++this.#installGeneration;
      this.#activeInstall = generation;
      this.#installStarted = true;
      this.#operation = "install";
      this.#setStatus({ phase: "installing", progress: 100, message: null, errorCode: null });
      const installed = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          this.#teardownCommitted = true;
          yield* updateIO(() => this.#options.beforeInstall());
          if (this.#installGeneration !== generation) return;
          if (this.#checkRequest) yield* Deferred.await(this.#checkRequest).pipe(Effect.catch(() => Effect.void));
          if (this.#installGeneration !== generation) return;
          this.#installHandedOver = true;
          if (this.#options.platform === "darwin" && this.#options.handoverPath) {
            yield* writeUpdateHandover(this.#options.handoverPath, this.#options.currentVersion, Date.now()).pipe(
              Effect.catch((error) =>
                Effect.sync(() => logger.warn("The update handover record was not saved.", toLogValue(error))),
              ),
            );
          }
          const { installRecordPath } = this.#options;
          if (this.#options.platform === "darwin" && installRecordPath && this.#downloadedVersion) {
            yield* writeUpdateInstallRecord(
              installRecordPath,
              this.#options.currentVersion,
              this.#downloadedVersion,
            ).pipe(
              Effect.catch((error) =>
                Effect.sync(() => logger.warn("The update install record was not saved.", toLogValue(error))),
              ),
            );
          }
          yield* updateSync(() => this.#updater.quitAndInstall(false, true));
          this.#armPhaseTimer();
        }),
      );
      if (Result.isFailure(installed) && this.#installGeneration === generation) {
        logUpdateFailure("OpenBot update install failed.", installed.failure.cause);
        this.#setError("install_failed", INSTALL_FAILED_MESSAGE);
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.restartFailed")) });
      }
    }).pipe(Effect.uninterruptible);
  }

  #siblingSessionMessage(siblings: readonly OpenBotSiblingInstance[]): string {
    const currentUid = this.#options.currentUid;
    if (currentUid !== undefined && siblings.every((sibling) => sibling.uid === currentUid)) {
      return sourceText("error.update.siblingSessionSameAccount");
    }
    return SIBLING_SESSION_MESSAGE;
  }

  stop(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#checkTimer) clearTimeout(this.#checkTimer);
      this.#checkTimer = null;
      if (this.#status.phase !== "installing") this.#clearPhaseTimer();
    });
  }

  #issueCheck(): Effect.Effect<UpdateCheckOutcome | null, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#checkRequest) return yield* Deferred.await(this.#checkRequest);
      const request = Deferred.makeUnsafe<UpdateCheckOutcome | null, UpdateOperationFailure>();
      this.#checkRequest = request;
      this.#rolloutMiss = null;
      return yield* updateIO(() => this.#updater.checkForUpdates()).pipe(
        Effect.tapError(({ cause }) => Effect.sync(() => logUpdateFailure("OpenBot update check failed.", cause))),
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            yield* Deferred.done(request, exit);
            if (this.#checkRequest === request) this.#checkRequest = null;
          }),
        ),
        Effect.uninterruptible,
      );
    });
  }

  #issueRequestedCheck(
    requested: boolean,
    generation: number,
  ): Effect.Effect<Result.Result<UpdateCheckOutcome | null, UpdateOperationFailure>> {
    return Effect.gen({ self: this }, function* () {
      const checked = yield* Effect.result(this.#issueCheck());
      const missed = this.#rolloutMiss;
      if (!requested || !missed || Result.isFailure(checked) || this.#checkGeneration !== generation) return checked;
      if (checked.success?.isUpdateAvailable) return checked;
      this.#requestedVersion = missed;
      return yield* Effect.result(this.#issueCheck());
    });
  }

  #isDownloadLive(): boolean {
    return this.#activeDownload !== null && this.#activeDownload === this.#downloadGeneration;
  }

  #isInstallLive(): boolean {
    return this.#activeInstall !== null && this.#activeInstall === this.#installGeneration;
  }

  #canDownload(): boolean {
    if (this.#status.phase === "available") return true;
    return (
      this.#status.phase === "error" &&
      this.#status.errorCode === "download_failed" &&
      this.#status.availableVersion !== null
    );
  }

  #canInstall(): boolean {
    return this.#downloadedVersion !== null && this.#status.phase === "ready";
  }

  #ensureCancellationToken(): Effect.Effect<UpdateCancellationToken | null, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#cancellationToken && !this.#cancellationToken.cancelled) return this.#cancellationToken;
      const checked = yield* Effect.result(updateIO(() => this.#updater.checkForUpdates()));
      if (Result.isFailure(checked)) logUpdateFailure("OpenBot update check failed.", checked.failure.cause);
      this.#cancellationToken = Result.isSuccess(checked) ? (checked.success?.cancellationToken ?? null) : null;
      return this.#cancellationToken;
    });
  }

  #markAvailable(version: string): void {
    this.#setStatus({
      phase: "available",
      availableVersion: version,
      progress: null,
      message: null,
      errorCode: null,
      checkedAt: new Date().toISOString(),
    });
  }

  #markReady(version: string | null): void {
    this.#downloadedVersion = version;
    this.#setStatus({
      phase: "ready",
      availableVersion: version,
      progress: 100,
      message: version !== null && version === this.#options.notInstalledVersion ? NOT_INSTALLED_MESSAGE : null,
      errorCode: null,
    });
  }

  #scheduleCheck(delayMs: number): void {
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => this.#fork(this.#check(false)), delayMs);
    this.#checkTimer.unref?.();
  }

  #fork(work: Effect.Effect<unknown, UpdateOperationFailure>): void {
    Effect.runFork(
      Effect.forkIn(
        work.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.sync(() => {
                  const error = Cause.squash(cause);
                  logger.error(
                    "Background update work failed.",
                    toLogValue(error instanceof UpdateOperationFailure ? error.cause : error),
                  );
                }),
          ),
        ),
        this.#workScope,
        { startImmediately: true },
      ),
    );
  }

  #clearPhaseTimer(): void {
    if (this.#phaseTimer) clearTimeout(this.#phaseTimer);
    this.#phaseTimer = null;
  }

  #armPhaseTimer(): void {
    this.#clearPhaseTimer();
    const timeoutMs = this.#phaseTimeoutMs();
    if (this.#managedByHost || timeoutMs === null) return;
    this.#phaseTimer = setTimeout(() => {
      this.#phaseTimer = null;
      this.#failStalledPhase();
    }, timeoutMs);
    this.#phaseTimer.unref?.();
  }

  #phaseTimeoutMs(): number | null {
    const phase = this.#status.phase;
    return isUpdateBusyPhase(phase) ? this.#options.phaseTimeoutsMs[phase] : null;
  }

  #failStalledPhase(): void {
    if (this.#status.phase === "checking") {
      this.#checkGeneration += 1;
      this.#setError("check_failed", CHECK_STALLED_MESSAGE);
      this.#scheduleCheck(this.#options.checkIntervalMs);
      return;
    }
    if (this.#status.phase === "downloading") {
      this.#downloadGeneration += 1;
      this.#activeDownload = null;
      this.#cancellationToken?.cancel();
      this.#cancellationToken = null;
      this.#setError("download_failed", sourceText("error.update.downloadStalled"));
      return;
    }
    if (this.#status.phase === "installing") {
      this.#installGeneration += 1;
      this.#activeInstall = null;
      this.#setError("install_failed", INSTALL_FAILED_MESSAGE);
    }
  }

  #setError(errorCode: UpdateFailureCode, message?: string): void {
    this.#setStatus({
      phase: "error",
      progress: null,
      checkedAt: new Date().toISOString(),
      message: message ?? errorMessage(errorCode),
      errorCode,
    });
  }

  #setStatus(patch: Partial<UpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#recordStatus();
    this.#armPhaseTimer();
    this.emit("status", this.getStatus());
  }

  #recordStatus(): void {
    const event = { at: new Date().toISOString(), phase: this.#status.phase, errorCode: this.#status.errorCode };
    this.#history = [...this.#history.slice(-(MAX_DIAGNOSTIC_EVENTS - 1)), event];
    this.emit("diagnostic", event);
  }
}

const INSTALL_FAILED_MESSAGE = sourceText("error.update.installFailed");
const MANAGED_HOST_MESSAGE = sourceText("error.update.managedByHost");
const NOT_INSTALLED_MESSAGE = sourceText("error.update.notInstalled");
const SIBLING_SESSION_MESSAGE = sourceText("error.update.siblingSession");
const CHECK_STALLED_MESSAGE = sourceText("error.update.checkStalled");
const CHECK_OFFLINE_MESSAGE = sourceText("error.update.checkOffline");
const CHECK_SERVICE_MESSAGE = sourceText("error.update.checkUnavailable");
const CHECK_NO_RELEASE_MESSAGE = sourceText("error.update.checkNoRelease");

const OFFLINE_ERROR_CODES = [
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NAME_NOT_RESOLVED",
];

const NO_RELEASE_ERROR_CODES = [
  "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_INVALID_RELEASE_FEED",
];

function describeCheckFailure(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const text = `${code} ${error instanceof Error ? error.message : String(error ?? "")}`;
  if (OFFLINE_ERROR_CODES.some((candidate) => text.includes(candidate))) return CHECK_OFFLINE_MESSAGE;
  if (NO_RELEASE_ERROR_CODES.includes(code)) return CHECK_NO_RELEASE_MESSAGE;
  const status =
    typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : Number.NaN;
  if (status === 429 || status >= 500) return CHECK_SERVICE_MESSAGE;
  if (code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND") return CHECK_SERVICE_MESSAGE;
  return errorMessage("check_failed");
}

function logUpdateFailure(text: string, error: unknown): void {
  const fields = typeof error === "object" && error !== null ? error : {};
  logger.warn(
    text,
    toLogValue({
      code: "code" in fields ? fields.code : undefined,
      statusCode: "statusCode" in fields ? fields.statusCode : undefined,
      message: error instanceof Error ? error.message : error,
    }),
  );
}

function isOnReadOnlyVolume(bundlePath: string): Effect.Effect<boolean> {
  if (bundlePath.includes("/AppTranslocation/")) return Effect.succeed(true);
  return updateIO(() => access(bundlePath, constants.W_OK)).pipe(
    Effect.as(false),
    Effect.catch(({ cause }) =>
      Effect.succeed(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EROFS"),
    ),
  );
}

function findAppImageInstallProblem(appImagePath: string): Effect.Effect<"missing" | "readOnly" | null> {
  return Effect.gen(function* () {
    const missing = yield* updateIO(() => stat(appImagePath)).pipe(
      Effect.as(false),
      Effect.catch(({ cause }) => Effect.succeed(isMissingPathError(cause))),
    );
    if (missing) return "missing";
    const writable = yield* updateIO(() => access(dirname(appImagePath), constants.W_OK)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    return writable ? null : "readOnly";
  });
}

function isMissingPathError(cause: unknown): boolean {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The download finished, but the Windows signature check did not accept the installer (`NsisUpdater`). */
function downloadFailureMessage(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "ERR_UPDATER_INVALID_SIGNATURE" ? sourceText("error.update.signatureNotConfirmed") : undefined;
}

function errorMessage(code: UpdateFailureCode) {
  if (code === "download_failed") return sourceText("error.update.downloadFailed");
  if (code === "install_failed") return INSTALL_FAILED_MESSAGE;
  return sourceText("error.update.checkFailed");
}

function appendUpdateLog(directory: string, event: UpdateDiagnosticEvent): Effect.Effect<void, UpdateOperationFailure> {
  return Effect.gen(function* () {
    yield* updateIO(() => mkdir(directory, { recursive: true, mode: 0o700 }));
    const path = join(directory, "update.log");
    const rotatedPath = `${path}.1`;
    const size = yield* updateIO(() => stat(path)).pipe(
      Effect.map((value) => value.size),
      Effect.catch(() => Effect.succeed(0)),
    );
    if (size >= MAX_LOG_BYTES) {
      yield* updateIO(() => rm(rotatedPath, { force: true }));
      yield* updateIO(() => rename(path, rotatedPath));
    }
    yield* updateIO(() => appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 }));
  }).pipe(Effect.catch(() => Effect.void));
}

function pruneShipItLogs(directory: string): Effect.Effect<void, UpdateOperationFailure> {
  return Effect.gen(function* () {
    const entries = (yield* updateIO(() => readdir(directory, { withFileTypes: true })))
      .filter((entry) => entry.isFile() && /^ShipIt_(?:stdout|stderr)\.log\.\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.split(".").at(-1)) - Number(left.split(".").at(-1)));
    yield* Effect.forEach(entries.slice(10), (entry) => updateIO(() => rm(join(directory, entry), { force: true })), {
      concurrency: "unbounded",
      discard: true,
    });
  }).pipe(Effect.catch(() => Effect.void));
}

const decodePendingUpdateInfo = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ fileName: Schema.String })),
);

function pruneInstalledUpdate(directory: string, currentVersion: string): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const pending = join(directory, "pending");
    const text = yield* updateIO(() => readFile(join(pending, "update-info.json"), "utf8"));
    const { fileName } = yield* decodePendingUpdateInfo(text);
    const version = /-(\d+\.\d+\.\d+)-/u.exec(fileName)?.[1];
    if (version === undefined || isNewerRelease(version, currentVersion)) return;
    yield* updateIO(() => rm(join(pending, basename(fileName)), { force: true }));
    yield* updateIO(() => rm(join(pending, "update-info.json"), { force: true }));
  }).pipe(Effect.catch(() => Effect.void));
}

function stagingPercentage(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const percentage = Number.parseInt(String(value), 10);
  return Number.isNaN(percentage) ? null : percentage;
}

function clampProgress(value: number): number | null {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

export class UpdateOperationFailure extends Schema.TaggedError<UpdateOperationFailure>()("UpdateOperationFailure", {
  cause: Schema.Defect(),
}) {}

const { io: updateIO, sync: updateSync } = causeHelpers(UpdateOperationFailure);
