import { EventEmitter } from "node:events";
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  IdleRestart,
  ScheduledUpdateRestart,
  UpdateBusyPhase,
  UpdateFailureCode,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { isUpdateBusyPhase } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Schema, Scope, Semaphore } from "effect";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { HostUpdateState } from "../../packages/contracts/src/host-manager";
import type { OpenBotSiblingInstance } from "./update-sibling-instances";

/** Only the part of electron-updater's cancellation token this service depends on. */
export type UpdateCancellationToken = {
  readonly cancelled: boolean;
  cancel: () => void;
};

/** Only the part of a check result this service depends on. */
export type UpdateCheckOutcome = {
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: { readonly version: string };
  readonly cancellationToken?: UpdateCancellationToken;
};

/**
 * The subset of electron-updater this service drives. Four behaviours of the installed version are
 * load bearing here, none of them public API, all verified against 6.8.9 and pinned by
 * electron-updater-assumptions.test.ts:
 *
 * 1. `MacUpdater.updateDownloaded` only calls `nativeUpdater.checkForUpdates()` - the call that makes
 *    Squirrel stage the ZIP and eventually emit the native `update-downloaded` - while
 *    `autoInstallOnAppQuit` is true. We keep that off, so nothing here may wait on that event; doing
 *    so is what left macOS stuck on "Preparing update..." in issue #152.
 * 2. `MacUpdater.quitAndInstall` stages on demand when Squirrel has not already done so, which is why
 *    `ready` is a valid state the moment the download completes.
 * 3. `AppUpdater.doCheckForUpdates` mints a `CancellationToken` for every available update and returns
 *    it on the result, so cancellation needs no direct dependency on builder-util-runtime.
 * 4. `BaseUpdater.quitAndInstall` can return without quitting when `install()` fails, so an install
 *    failure has to release the latch or the restart action never becomes available again.
 */
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

export function isValidSemver(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
    version,
  );
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
  checkSiblingInstances?: () => Promise<readonly OpenBotSiblingInstance[]>;
  /** The uid of this process. It tells a refusal in this account apart from another account. */
  currentUid?: number;
  platform?: NodeJS.Platform;
  logDirectory?: string;
  shipItDirectory?: string;
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

// One manifest request every four minutes: a small GET while the app sits idle, and a user who
// leaves OpenBot open picks up a release within minutes instead of hours. The loop skips the request
// while a download or an install runs, and keeps checking while a downloaded update waits for its
// restart, because releases ship often enough to supersede it before the user restarts.
const DEFAULT_CHECK_INTERVAL = 4 * 60 * 1_000;
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_EVENTS = 20;

/**
 * Every busy phase needs a deadline, and typing this as a total record over `UpdateBusyPhase` is what
 * enforces it: adding a phase to `UPDATE_BUSY_PHASES` without a timeout here fails to compile. A busy
 * phase with no bound is exactly how "Preparing update..." became a state the UI could never leave.
 */
const DEFAULT_PHASE_TIMEOUTS: Record<UpdateBusyPhase, number> = {
  /**
   * A backstop above builder-util-runtime's own 60s socket timeout, which aborts the request and
   * rejects the call. Letting that fire first means the library reports the real failure and clears
   * its outstanding promise, so the next scheduled check issues a fresh request; this only covers a
   * stall outside the request itself, such as provider resolution.
   */
  checking: 90_000,
  /**
   * Time without a single progress event, not a cap on the whole transfer: release artifacts run to
   * hundreds of megabytes, so a slow link must stay supported while a dead socket must not.
   */
  downloading: 120_000,
  /**
   * Shutdown preparation plus the handover to the installer. Generous because on macOS
   * quitAndInstall asks Squirrel to stage the ZIP and only quits when that finishes, which is disk
   * bound on an artifact of a few hundred megabytes. Firing early here would report a failure over a
   * working install.
   */
  installing: 300_000,
};

/**
 * Whether the installed app can replace itself in place.
 *
 * Linux is conditional: electron-updater can only self-update an AppImage, and the AppImage runtime
 * is the thing that says so, through `APPIMAGE`. An unpacked or repackaged Linux build has nothing
 * to write back to, so it reports no updates rather than failing at install time.
 */
export function supportsInstalledUpdates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform === "linux") return Boolean(environment.APPIMAGE?.trim());
  return platform === "darwin" || platform === "win32";
}

export class UpdateService extends EventEmitter<UpdateServiceEvents> {
  readonly #updater: UpdateAdapter;
  readonly #options: Required<
    Pick<UpdateServiceOptions, "currentVersion" | "enabled" | "platform" | "initialCheckDelayMs" | "checkIntervalMs">
  > &
    Pick<
      UpdateServiceOptions,
      "beforeInstall" | "checkSiblingInstances" | "currentUid" | "logDirectory" | "shipItDirectory"
    > & {
      phaseTimeoutsMs: Record<UpdateBusyPhase, number>;
    };
  #status: UpdateStatus;
  #checkTimer: ReturnType<typeof setTimeout> | null = null;
  #phaseTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #installStarted = false;
  #pendingInstallRequests = 0;
  #installHandedOver = false;
  #operation: UpdateOperation = "check";
  #history: UpdateDiagnosticEvent[] = [];
  readonly #logLock = Semaphore.makeUnsafe(1);
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
    this.#status = {
      phase: options.enabled ? "idle" : "unsupported",
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      checkedAt: null,
      message: options.enabled ? null : sourceText("error.update.unsupported"),
      errorCode: null,
    };
    this.on("diagnostic", (event) => {
      const directory = this.#options.logDirectory;
      if (directory) void runUpdate(this.#logLock.withPermit(appendUpdateLog(directory, event)));
    });
    this.#recordStatus();
  }

  start(scheduleChecks = true): void {
    if (this.#started) return;
    this.#started = true;
    // The automatic download is driven from this service so that both flows share one download path
    // and one cancellation token. autoInstallOnAppQuit stays off so nothing installs without the
    // explicit restart action, which is the only path that runs shutdown preparation.
    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = false;
    this.#updater.allowPrerelease = false;

    // The check lifecycle is driven entirely by checkForUpdates(), whose result is generation
    // guarded, so there are deliberately no checking-for-update / update-available /
    // update-not-available listeners: a second, unguarded writer is how a late event from an
    // abandoned check could overwrite a newer download or ready state.
    this.#updater.on("download-progress", (progress: ProgressInfo) => {
      if (!this.#isDownloadLive()) return;
      this.#setStatus({ phase: "downloading", progress: clampProgress(progress.percent), errorCode: null });
    });
    this.#updater.on("update-downloaded", (info: UpdateInfo) => {
      if (!this.#isDownloadLive()) return;
      this.#activeDownload = null;
      // electron-updater has staged everything it needs by now. On macOS quitAndInstall asks the
      // native updater for the ZIP on demand, so the restart action is available immediately.
      this.#markReady(info.version);
    });
    this.#updater.on("error", () => {
      // Both awaited calls reject on failure, so this only has to cover errors raised outside them,
      // and only for an operation still in flight. An abandoned operation reporting late must not
      // replace the state the user is now looking at.
      // Before the handover only a check can raise an error, such as the quiet check that runs while
      // an update is ready. Reading that as an install failure would abandon an install whose
      // shutdown preparation is already under way.
      if (this.#operation === "install" && this.#installHandedOver && this.#isInstallLive()) {
        // quitAndInstall can return without quitting. Shutdown preparation has already run by then,
        // so the app cannot install again; it reports the failure and asks to be relaunched.
        this.#installGeneration += 1;
        this.#activeInstall = null;
        this.#setError("install_failed", INSTALL_FAILED_MESSAGE);
        return;
      }
      if (this.#operation === "download" && this.#isDownloadLive()) {
        this.#activeDownload = null;
        this.#setError("download_failed");
      }
    });
    if (this.#options.platform === "darwin" && this.#options.shipItDirectory) {
      void runUpdate(pruneShipItLogs(this.#options.shipItDirectory));
    }

    if (scheduleChecks && this.#options.enabled) {
      this.#scheduleCheck(this.#options.initialCheckDelayMs);
    }
  }

  getStatus(): UpdateStatus {
    const status = { ...this.#status };
    if (this.#managedByHost) status.managedByHost = true;
    if (this.#scheduledRestart)
      status.scheduledRestart = { ...this.#scheduledRestart, waitingFor: [...this.#scheduledRestart.waitingFor] };
    if (this.#idleRestart) status.idleRestart = { ...this.#idleRestart, waitingFor: [...this.#idleRestart.waitingFor] };
    return status;
  }

  /**
   * Shows the restart a joined server's admin asked for. `RequestedUpdate` owns the schedule; this
   * only carries it to the renderer. It is not a phase change, so the phase deadline stays as it is.
   */
  setScheduledRestart(restart: ScheduledUpdateRestart | null): void {
    this.#scheduledRestart = restart ? { ...restart, waitingFor: [...restart.waitingFor] } : null;
    this.emit("status", this.getStatus());
  }

  /** Shows the restart that the user of this computer asked for. `IdleRestart` owns it, as above. */
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

  /** Host-managed sessions display host state and never invoke the tenant updater. */
  setManagedByHost(managed: boolean): void {
    if (this.#managedByHost === managed) return;
    this.#managedByHost = managed;
    if (!managed) {
      this.#downloadedVersion = null;
      this.#setStatus({
        phase: this.#options.enabled ? "idle" : "unsupported",
        availableVersion: null,
        progress: null,
        message: null,
        errorCode: null,
      });
      if (this.#options.enabled) this.#scheduleCheck(this.#options.initialCheckDelayMs);
    }
    this.#setStatus({});
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

  /**
   * The user-facing check. Unlike the periodic loop this one always reports: it moves into
   * "checking" and settles on a real outcome even when an earlier call is still unsettled, because
   * an action that answers a press by leaving the same error on screen reads as a dead button.
   */
  checkForUpdates(): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return this.#check(true);
  }

  #check(joinOutstandingRequest: boolean): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#managedByHost || !this.#options.enabled || this.#teardownCommitted) return this.getStatus();
      if (this.#status.phase === "ready") return yield* this.#checkSupersedingRelease();
      if (["checking", "downloading", "installing"].includes(this.#status.phase)) {
        // A download ends in "ready" or in a failure, and neither schedules a check, so the periodic
        // loop has to outlive it here.
        if (this.#status.phase === "downloading" && !joinOutstandingRequest) {
          this.#scheduleCheck(this.#options.checkIntervalMs);
        }
        return this.getStatus();
      }
      // electron-updater returns the outstanding promise when a check is already running, so issuing
      // another one here would only re-await the call this service has already given up on. The
      // periodic loop waits quietly for it rather than spinning the UI once every interval; a user
      // who asked for an answer joins that call instead, and gets progress and its real outcome.
      if (this.#checkRequest && !joinOutstandingRequest) {
        // Keep the periodic loop alive, or refusing here would be the last check of the session.
        this.#scheduleCheck(this.#options.checkIntervalMs);
        return this.getStatus();
      }
      const generation = ++this.#checkGeneration;
      this.#operation = "check";
      this.#setStatus({ phase: "checking", progress: null, message: null, errorCode: null });
      const checked = yield* Effect.result(this.#issueCheck()).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#checkGeneration === generation) this.#scheduleCheck(this.#options.checkIntervalMs);
          }),
        ),
      );
      if (this.#checkGeneration !== generation) return this.getStatus();
      if (Result.isFailure(checked)) this.#setError("check_failed", describeCheckFailure(checked.failure.cause));
      else {
        const result = checked.success;
        this.#cancellationToken = result?.cancellationToken ?? null;
        if (result?.isUpdateAvailable) {
          if (result.updateInfo.version !== this.#downloadedVersion) this.#downloadedVersion = null;
          this.#markAvailable(result.updateInfo.version);
        } else {
          this.#downloadedVersion = null;
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
      // downloadUpdate() moves into "downloading" before its first await, so the caller and the
      // renderer see the download start rather than a stale "available".
      if (this.#autoDownload && this.#status.phase === "available")
        yield* Effect.forkIn(this.downloadUpdate(), this.#workScope, { startImmediately: true });
      return this.getStatus();
    });
  }

  /**
   * Installing a downloaded update that a newer release has superseded restarts into a version that
   * is already out of date, and the next launch offers another update: one restart per release
   * (issue #1192). This check runs without leaving "ready", so the restart action stays available,
   * and replaces the download only with a newer release. A failed check keeps the download, which is
   * still a valid update. With automatic downloads off the download stays as well: replacing it
   * would take away the restart and start a transfer the user did not ask for.
   */
  #checkSupersedingRelease(): Effect.Effect<UpdateStatus, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      // Scheduled before the request, because a request that never settles must not end the loop.
      this.#scheduleCheck(this.#options.checkIntervalMs);
      if (!this.#autoDownload || this.#checkRequest) return this.getStatus();
      const downloaded = this.#downloadedVersion;
      const checked = yield* Effect.result(this.#issueCheck());
      if (Result.isFailure(checked)) return this.getStatus();
      const result = checked.success;
      // An install can start, a host can take over, or the preference can change while the request
      // is out. An install still in its sibling scan counts: it expects the download it was asked for.
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
      // Same deduplication applies to downloads, and starting a second attempt while the abandoned one
      // is still unsettled is also what would let its buffered events be read as the new attempt's.
      if (this.#downloadInFlight) return this.getStatus();
      this.#downloadInFlight = true;
      const generation = ++this.#downloadGeneration;
      this.#activeDownload = generation;
      this.#operation = "download";
      this.#setStatus({ phase: "downloading", progress: 0, message: null, errorCode: null });
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
          this.#activeDownload = null;
          this.#setError("download_failed");
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
      const siblings = yield* updateIO(async () => (await this.#options.checkSiblingInstances?.()) ?? []).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#pendingInstallRequests -= 1;
          }),
        ),
      );
      if (siblings.length > 0)
        return yield* new UpdateOperationFailure({ cause: new Error(this.#siblingSessionMessage(siblings)) });
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
          // Shutdown is irreversible. Keep the latch after failure and never restart a stale attempt.
          this.#teardownCommitted = true;
          yield* updateIO(() => this.#options.beforeInstall());
          if (this.#installGeneration !== generation) return;
          if (this.#checkRequest) yield* Deferred.await(this.#checkRequest).pipe(Effect.catch(() => Effect.void));
          if (this.#installGeneration !== generation) return;
          this.#installHandedOver = true;
          yield* updateSync(() => this.#updater.quitAndInstall(false, true));
          this.#armPhaseTimer();
        }),
      );
      if (Result.isFailure(installed) && this.#installGeneration === generation) {
        this.#setError("install_failed", INSTALL_FAILED_MESSAGE);
        return yield* new UpdateOperationFailure({ cause: new Error(sourceText("error.update.restartFailed")) });
      }
    }).pipe(Effect.uninterruptible);
  }

  /**
   * A refusal that says where the blocking session runs. Siblings in this account are usually a second
   * window of this user, so the message points at it. Anything else is another macOS user, and
   * the generic message keeps applying. An unknown uid cannot tell them apart, so it also keeps
   * the generic message.
   */
  #siblingSessionMessage(siblings: readonly OpenBotSiblingInstance[]): string {
    const currentUid = this.#options.currentUid;
    if (currentUid !== undefined && siblings.every((sibling) => sibling.uid === currentUid)) {
      return sourceText("error.update.siblingSessionSameAccount");
    }
    return SIBLING_SESSION_MESSAGE;
  }

  // A download in progress keeps running: a cancelled Windows logoff stops background work and
  // leaves the app open, and a download or install after that must still work.
  stop(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#checkTimer) clearTimeout(this.#checkTimer);
      this.#checkTimer = null;
      // An install runs shutdown preparation, which stops background work through this method. The
      // install deadline has to survive that: it is the only thing that can release a restart which
      // never happens, and clearing it here would leave the app latched in "installing" forever.
      if (this.#status.phase !== "installing") this.#clearPhaseTimer();
    });
  }

  /**
   * Issues the one outstanding request every caller shares. The handle is cleared when the call
   * settles, so `#checkRequest` answers exactly the question the join above asks: is electron-updater
   * still holding a promise that a fresh call would be answered by?
   */
  #issueCheck(): Effect.Effect<UpdateCheckOutcome | null, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#checkRequest) return yield* Deferred.await(this.#checkRequest);
      const request = Deferred.makeUnsafe<UpdateCheckOutcome | null, UpdateOperationFailure>();
      this.#checkRequest = request;
      return yield* updateIO(() => this.#updater.checkForUpdates()).pipe(
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

  /** True while the download the service still believes in is the one events are reporting on. */
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

  /**
   * Installing is one shot per session. beforeInstall is shutdown preparation - it flushes browser
   * storage, destroys the browser and stops services - and it is not transactional, so once it has
   * begun there is no state to safely retry from. A failed or timed-out install therefore keeps the
   * latch and asks the user to relaunch rather than offering an action that would run teardown a
   * second time, concurrently with the first.
   */
  #canInstall(): boolean {
    return this.#downloadedVersion !== null && this.#status.phase === "ready";
  }

  /**
   * A cancellation token is single use, and electron-updater only mints one alongside update
   * metadata. Re-check quietly when the stored token is missing or spent so that a retry after the
   * stall watchdog cancelled the last attempt still downloads under a live token.
   */
  #ensureCancellationToken(): Effect.Effect<UpdateCancellationToken | null, UpdateOperationFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#cancellationToken && !this.#cancellationToken.cancelled) return this.#cancellationToken;
      const checked = yield* Effect.result(updateIO(() => this.#updater.checkForUpdates()));
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
      message: null,
      errorCode: null,
    });
  }

  #scheduleCheck(delayMs: number): void {
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => void runUpdate(this.#check(false)), delayMs);
    this.#checkTimer.unref?.();
  }

  #clearPhaseTimer(): void {
    if (this.#phaseTimer) clearTimeout(this.#phaseTimer);
    this.#phaseTimer = null;
  }

  /**
   * Every phase that renders as busy is bounded here, so no status the user waits on can outlive its
   * timeout. Re-armed on each status write, which makes download progress events refresh the stall
   * deadline for free.
   */
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
      // The pending call never settles, so its finally block will not run. Without rescheduling
      // here the app would silently stop checking for updates until it restarts.
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
      // The latch deliberately stays set: shutdown preparation may already have torn services down,
      // so a second attempt would run teardown concurrently with the first.
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
const SIBLING_SESSION_MESSAGE = sourceText("error.update.siblingSession");
const CHECK_STALLED_MESSAGE = sourceText("error.update.checkStalled");
const CHECK_OFFLINE_MESSAGE = sourceText("error.update.checkOffline");
const CHECK_SERVICE_MESSAGE = sourceText("error.update.checkUnavailable");
const CHECK_NO_RELEASE_MESSAGE = sourceText("error.update.checkNoRelease");

/**
 * Node reports a link that never carried the request through `error.code`. electron-updater wraps
 * its own failures with a code of its own and keeps the original stack in the message, so the raw
 * text is searched as well: a wrapped `ENOTFOUND` is still a connectivity problem to the user, and
 * telling them to check the network is the one instruction that helps.
 */
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

/** electron-updater codes that mean the feed answered but carried no release this build can use. */
const NO_RELEASE_ERROR_CODES = [
  "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_INVALID_RELEASE_FEED",
];

/**
 * What the user is told after a failed check. The three recoverable causes need different
 * instructions - a dropped link is theirs to fix, a refusing or unpublished feed is not - and
 * "Try again." on its own tells someone with no network to repeat the action that cannot work.
 */
function describeCheckFailure(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const text = `${code} ${error instanceof Error ? error.message : String(error ?? "")}`;
  if (OFFLINE_ERROR_CODES.some((candidate) => text.includes(candidate))) return CHECK_OFFLINE_MESSAGE;
  if (NO_RELEASE_ERROR_CODES.includes(code)) return CHECK_NO_RELEASE_MESSAGE;
  const status =
    typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : Number.NaN;
  if (status === 429 || status >= 500) return CHECK_SERVICE_MESSAGE;
  // ERR_UPDATER_LATEST_VERSION_NOT_FOUND wraps whatever the release lookup threw, so it only lands
  // here once the causes above have been ruled out of its message.
  if (code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND") return CHECK_SERVICE_MESSAGE;
  return errorMessage("check_failed");
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

export function pruneShipItLogs(directory: string): Effect.Effect<void, UpdateOperationFailure> {
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

/**
 * Compares the release numbers only. The feed offers no prereleases (`allowPrerelease` is off), so
 * a candidate with the same numbers is not newer. A stale feed answer that names an older release
 * must not replace a newer download.
 */
function isNewerRelease(candidate: string, current: string): boolean {
  const parse = (version: string) => version.split(/[-+]/u, 1)[0]?.split(".").map(Number) ?? [];
  const [left, right] = [parse(candidate), parse(current)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

export class UpdateOperationFailure extends Schema.TaggedError<UpdateOperationFailure>()("UpdateOperationFailure", {
  cause: Schema.Defect(),
}) {}
function updateIO<A>(operation: () => Promise<A>): Effect.Effect<A, UpdateOperationFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new UpdateOperationFailure({ cause }) });
}
function updateSync<A>(operation: () => A): Effect.Effect<A, UpdateOperationFailure> {
  return Effect.try({ try: operation, catch: (cause) => new UpdateOperationFailure({ cause }) });
}
async function runUpdate<A>(operation: Effect.Effect<A, UpdateOperationFailure>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
