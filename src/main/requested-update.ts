// An app update that an owner or admin of a joined server asked this host for (`host-update-v1`),
// or that this host installs by itself when the automatic install is on.
//
// The update itself is the one `UpdateService` runs for the local user: the same check, download and
// install. This module adds the schedule: who asked, whether the restart waits for idle, and what it
// still waits for. It also owns the update preference, because the host user and a remote admin both
// change it. The schedule lives in memory, so a host that restarts for another reason forgets it; the
// admin asks again, and the automatic install schedules the next update again.

import type {
  HostUpdateSettingsChange,
  HostUpdateStatus,
  ScheduledUpdateRestart,
  UpdateFailureCode,
  UpdatePreference,
  UpdatePreferenceChange,
  UpdateRestartMode,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import type { RestartReadiness } from "./update-readiness";

export type RequestedUpdateRefusalReason = "disabled" | "managed" | "unsupported" | "restarting";

/** A request this host does not carry out. The route turns the reason into a status code. */
export class RequestedUpdateRefusal extends Error {
  readonly reason: RequestedUpdateRefusalReason;

  constructor(reason: RequestedUpdateRefusalReason) {
    super(refusalMessage(reason));
    this.reason = reason;
  }
}

export interface RequestedUpdateMember {
  id: string;
  name: string;
}

interface RequestedUpdateUpdater {
  getStatus(): UpdateStatus;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  setScheduledRestart(restart: ScheduledUpdateRestart | null): void;
  getAutoDownload(): boolean;
  setAutoDownload(enabled: boolean): void;
  on(event: "status", listener: (status: UpdateStatus) => void): unknown;
  off(event: "status", listener: (status: UpdateStatus) => void): unknown;
}

export interface RequestedUpdateOptions {
  updater: RequestedUpdateUpdater;
  describeReadiness: () => RestartReadiness;
  preference: UpdatePreference;
  /** Stores a change and answers the whole stored preference. */
  savePreference: (change: UpdatePreferenceChange) => Promise<UpdatePreference>;
  /** A line for the main log. It names the member by id only. */
  log: (message: string) => void;
  /** Tells every connected member that this host restarts into an update, so a dropped connection has a reason. */
  announce?: (state: HostRestartState, version: string | null) => void;
  /** How long a restart that waits for idle waits between two readiness checks. */
  pollMs?: number;
  /**
   * The wait before the first restart attempt. The restart tears down the Team API, so the answer
   * to the request that asked for it must have left first.
   */
  graceMs?: number;
}

interface Schedule {
  /** Null when this host scheduled the restart itself. */
  memberId: string | null;
  requestedBy: string | null;
  mode: UpdateRestartMode;
  waitingFor: string[];
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_GRACE_MS = 1_000;

export class RequestedUpdate {
  readonly #updater: RequestedUpdateUpdater;
  readonly #describeReadiness: () => RestartReadiness;
  readonly #savePreference: (change: UpdatePreferenceChange) => Promise<UpdatePreference>;
  readonly #log: (message: string) => void;
  readonly #announce: (state: HostRestartState, version: string | null) => void;
  #announced: { state: HostRestartState; version: string | null } = { state: "none", version: null };
  readonly #pollMs: number;
  readonly #graceMs: number;
  #allowed: boolean;
  #autoInstall: boolean;
  /** The version whose restart was cancelled, or whose automatic restart failed. The next version schedules again. */
  #declinedVersion: string | null = null;
  #schedule: Schedule | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #installError: UpdateFailureCode | null = null;
  #publishing = false;
  readonly #onStatus = (status: UpdateStatus) => this.#advance(status);

  constructor(options: RequestedUpdateOptions) {
    this.#updater = options.updater;
    this.#describeReadiness = options.describeReadiness;
    this.#log = options.log;
    this.#announce = options.announce ?? (() => undefined);
    this.#savePreference = options.savePreference;
    this.#allowed = options.preference.allowRemoteUpdates;
    this.#autoInstall = options.preference.autoInstall;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.#updater.on("status", this.#onStatus);
    this.#advance(this.#updater.getStatus());
  }

  snapshot(): HostUpdateStatus {
    const status = this.#updater.getStatus();
    const schedule = this.#schedule;
    return {
      phase: status.phase,
      currentVersion: status.currentVersion,
      availableVersion: status.availableVersion,
      progress: status.progress === null ? null : Math.min(100, Math.max(0, Math.round(status.progress))),
      errorCode: status.errorCode ?? this.#installError,
      remoteUpdates: status.managedByHost ? "managed" : this.#allowed ? "allowed" : "disabled",
      autoDownload: this.#updater.getAutoDownload(),
      autoInstall: this.#autoInstall,
      restart: schedule
        ? { requestedBy: schedule.requestedBy, mode: schedule.mode, waitingFor: [...schedule.waitingFor] }
        : null,
    };
  }

  /** Asks the updater for a check. The answer shows the check under way; the client reads it again. */
  check(): HostUpdateStatus {
    this.#assertAllowed();
    void this.#updater.checkForUpdates();
    return this.snapshot();
  }

  /**
   * Checks, downloads, and restarts into the update. A second request replaces the mode of the first,
   * which is how an admin skips the wait. Nothing is scheduled when there is no update to install.
   */
  start(member: RequestedUpdateMember, mode: UpdateRestartMode): HostUpdateStatus {
    this.#assertAllowed();
    const status = this.#updater.getStatus();
    if (status.phase === "installing") throw new RequestedUpdateRefusal("restarting");
    // A failed install has run shutdown preparation already, so only a relaunch can recover.
    if (status.phase === "error" && status.errorCode === "install_failed") return this.snapshot();
    this.#installError = null;
    this.#declinedVersion = null;
    this.#schedule = { memberId: member.id, requestedBy: member.name, mode, waitingFor: [] };
    this.#log(`Member ${member.id} asked for an update restart (${mode}).`);
    this.#publish();
    if (status.phase === "ready") this.#scheduleAttempt(this.#graceMs);
    else if (canDownload(status)) void this.#updater.downloadUpdate();
    else if (status.phase !== "checking" && status.phase !== "downloading") void this.#updater.checkForUpdates();
    return this.snapshot();
  }

  /** An admin of a joined server sets the host's switches. Only the host user sets `allowRemoteUpdates`. */
  async changeSettings(change: HostUpdateSettingsChange): Promise<HostUpdateStatus> {
    this.#assertAllowed();
    await this.setPreference(change);
    return this.snapshot();
  }

  /** Stores a preference change and applies it. The host user's Settings and `changeSettings` call this. */
  async setPreference(change: UpdatePreferenceChange): Promise<UpdatePreference> {
    const preference = await this.#savePreference(change);
    this.#updater.setAutoDownload(preference.autoDownload);
    this.#allowed = preference.allowRemoteUpdates;
    this.#autoInstall = preference.autoInstall;
    const phase = this.#updater.getStatus().phase;
    if (this.#schedule && phase !== "installing") {
      // Each switch removes only the restart it allowed: remote access a member's, auto-install its own.
      const automatic = this.#schedule.memberId === null;
      if (automatic ? !this.#autoInstall : !this.#allowed) this.#clear();
    }
    this.#advance(this.#updater.getStatus());
    return preference;
  }

  /**
   * Removes the schedule. A download under way continues; it is the same one auto-download runs. A
   * cancelled restart stays cancelled for that version, so the automatic install does not schedule
   * it again.
   */
  cancel(): HostUpdateStatus {
    const status = this.#updater.getStatus();
    if (status.phase === "installing") throw new RequestedUpdateRefusal("restarting");
    if (this.#schedule) {
      this.#log(`The update restart that ${describe(this.#schedule)} asked for was cancelled.`);
      this.#declinedVersion = status.availableVersion;
      this.#clear();
    }
    return this.snapshot();
  }

  dispose(): void {
    this.#updater.off("status", this.#onStatus);
    this.#clearTimer();
  }

  #assertAllowed(): void {
    const status = this.#updater.getStatus();
    if (status.managedByHost) throw new RequestedUpdateRefusal("managed");
    if (!this.#allowed) throw new RequestedUpdateRefusal("disabled");
    if (status.phase === "unsupported") throw new RequestedUpdateRefusal("unsupported");
  }

  #advance(status: UpdateStatus): void {
    // Publishing the schedule emits a status too. That one is not a step of the update.
    if (this.#publishing) return;
    if (!this.#schedule) {
      this.#installAutomatically(status);
      return;
    }
    if (status.phase === "available") void this.#updater.downloadUpdate();
    else if (status.phase === "ready") {
      if (!this.#timer) this.#scheduleAttempt(this.#graceMs);
    } else if (status.phase === "up-to-date" || status.phase === "error" || status.phase === "unsupported") {
      // Nothing to install, or the step failed: the admin reads the outcome and asks again.
      this.#clear();
    }
  }

  /** Downloads a new version and schedules the restart when the host user or an admin turned it on. */
  #installAutomatically(status: UpdateStatus): void {
    if (!this.#autoInstall || status.managedByHost || !status.availableVersion) return;
    if (status.availableVersion === this.#declinedVersion) return;
    if (status.phase === "available") void this.#updater.downloadUpdate();
    else if (status.phase === "ready") {
      this.#schedule = { memberId: null, requestedBy: null, mode: "when-idle", waitingFor: [] };
      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);
      this.#publish();
      this.#scheduleAttempt(this.#graceMs);
    }
  }

  #scheduleAttempt(delayMs: number): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#attempt();
    }, delayMs);
    this.#timer.unref?.();
  }

  async #attempt(): Promise<void> {
    const schedule = this.#schedule;
    if (!schedule || this.#updater.getStatus().phase !== "ready") return;
    if (schedule.mode === "when-idle") {
      const { safeToRestart, reasons } = this.#describeReadiness();
      if (!safeToRestart) {
        const waitingFor = [...new Set(reasons)];
        if (waitingFor.join() !== schedule.waitingFor.join()) {
          schedule.waitingFor = waitingFor;
          this.#publish();
        }
        this.#scheduleAttempt(this.#pollMs);
        return;
      }
    }
    if (schedule.waitingFor.length > 0) {
      schedule.waitingFor = [];
      this.#publish();
    }
    this.#log(`Restarting to install the update that ${describe(schedule)} asked for.`);
    this.#announceState("restarting");
    try {
      await this.#updater.installUpdate();
    } catch (error) {
      // A refusal before teardown (another macOS session runs OpenBot) leaves the update ready.
      this.#log(`The requested update restart failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.#schedule === schedule) {
        this.#installError = "install_failed";
        // Without this, the next status would schedule the same failing install again.
        if (schedule.memberId === null) this.#declinedVersion = this.#updater.getStatus().availableVersion;
        this.#clear();
      }
    }
  }

  #clear(): void {
    this.#clearTimer();
    this.#schedule = null;
    this.#publish();
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Members hear each change once. A schedule made before the check names its version later. */
  #announceState(state: HostRestartState): void {
    const version = state === "none" ? null : this.#updater.getStatus().availableVersion;
    if (state === this.#announced.state && version === this.#announced.version) return;
    this.#announced = { state, version };
    this.#announce(state, version);
  }

  #publish(): void {
    const schedule = this.#schedule;
    this.#announceState(schedule ? "waiting" : "none");
    this.#publishing = true;
    try {
      this.#updater.setScheduledRestart(
        schedule
          ? { requestedBy: schedule.requestedBy, mode: schedule.mode, waitingFor: [...schedule.waitingFor] }
          : null,
      );
    } finally {
      this.#publishing = false;
    }
  }
}

/** The log names a member by id only. */
function describe(schedule: Schedule): string {
  return schedule.memberId === null ? "the automatic install" : `member ${schedule.memberId}`;
}

function canDownload(status: UpdateStatus): boolean {
  if (status.phase === "available") return true;
  return status.phase === "error" && status.errorCode === "download_failed" && status.availableVersion !== null;
}

function refusalMessage(reason: RequestedUpdateRefusalReason): string {
  if (reason === "disabled") return sourceText("error.update.remoteDisabled");
  if (reason === "managed") return sourceText("error.update.managedByHost");
  if (reason === "unsupported") return sourceText("error.update.unsupported");
  return sourceText("error.update.restartStarted");
}
