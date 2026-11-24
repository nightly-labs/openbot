import { EventEmitter } from "node:events";
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
import { Effect, Exit, Schema, Scope } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import type { PreferenceFileFailure } from "./preference-file";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { blockersAfterMaximumWait, type RestartReadiness } from "./update-readiness";
import type { UpdateOperationFailure } from "./update-service";

export type RequestedUpdateRefusalReason = "disabled" | "managed" | "unsupported" | "restarting";

export class RequestedUpdateRefusal extends Schema.TaggedError<RequestedUpdateRefusal>()("RequestedUpdateRefusal", {
  reason: Schema.Literals(["disabled", "managed", "unsupported", "restarting"]),
  message: Schema.String,
}) {
  constructor(reason: RequestedUpdateRefusalReason) {
    super({ reason, message: refusalMessage(reason) });
  }
}

export interface RequestedUpdateMember {
  id: string;
  name: string;
}

interface RequestedUpdateUpdater {
  getStatus(): UpdateStatus;
  checkForUpdates(): Effect.Effect<UpdateStatus, UpdateOperationFailure>;
  downloadUpdate(): Effect.Effect<UpdateStatus, UpdateOperationFailure>;
  installUpdate(): Effect.Effect<void, UpdateOperationFailure>;
  setScheduledRestart(restart: ScheduledUpdateRestart | null): void;
  getAutoDownload(): boolean;
  setAutoDownload(enabled: boolean): Effect.Effect<void>;
  on(event: "status", listener: (status: UpdateStatus) => void): unknown;
  off(event: "status", listener: (status: UpdateStatus) => void): unknown;
}

export interface RequestedUpdateOptions {
  updater: RequestedUpdateUpdater;
  describeReadiness: () => RestartReadiness;
  preference: UpdatePreference;
  savePreference: (change: UpdatePreferenceChange) => Effect.Effect<UpdatePreference, PreferenceFileFailure>;
  log: (message: string) => void;
  announce?: (state: HostRestartState, version: string | null) => void;
  pollMs?: number;
  graceMs?: number;
  automaticSpreadMs?: number;
  random?: () => number;
  clientInUse?: (() => boolean) | undefined;
  maximumIdleWait?: RequestedUpdateMaximumIdleWait | undefined;
}

export interface RequestedUpdateMaximumIdleWait {
  afterMs: number;
  providerOperationPending: () => boolean;
}

export const HOSTED_UPDATE_MAXIMUM_IDLE_WAIT_MS = 24 * 60 * 60 * 1000;

interface Schedule {
  memberId: string | null;
  requestedBy: string | null;
  mode: UpdateRestartMode;
  waitingFor: string[];
  waitingSince: number | null;
  pastMaximumWait: boolean;
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_GRACE_MS = 1_000;
// Hosts check for updates every few minutes, so a rollout step reaches all of them at once. Each
// restart registers the host again and reconnects its clients; a random delay spreads that load.
const AUTOMATIC_RESTART_SPREAD_MS = 30 * 60 * 1000;

export class RequestedUpdate extends EventEmitter<{ preference: [UpdatePreference] }> {
  readonly #updater: RequestedUpdateUpdater;
  readonly #describeReadiness: () => RestartReadiness;
  readonly #savePreference: (change: UpdatePreferenceChange) => Effect.Effect<UpdatePreference, PreferenceFileFailure>;
  readonly #log: (message: string) => void;
  readonly #announce: (state: HostRestartState, version: string | null) => void;
  #announced: { state: HostRestartState; version: string | null } = { state: "none", version: null };
  readonly #pollMs: number;
  readonly #graceMs: number;
  readonly #automaticSpreadMs: number;
  readonly #random: () => number;
  #allowed: boolean;
  #autoInstall: boolean;
  readonly #clientInUse: (() => boolean) | null;
  readonly #maximumIdleWait: RequestedUpdateMaximumIdleWait | null;
  #required = false;
  #declinedVersion: string | null = null;
  #schedule: Schedule | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  // The random wait before an automatic restart. It makes no schedule, so members see no notice yet.
  #spreadTimer: ReturnType<typeof setTimeout> | null = null;
  #spreadVersion: string | null = null;
  #installError: UpdateFailureCode | null = null;
  #installing = false;
  #publishing = false;
  readonly #workScope = Scope.makeUnsafe();
  readonly #onStatus = (status: UpdateStatus) => {
    Effect.runFork(Effect.forkIn(this.#advance(status), this.#workScope, { startImmediately: true }));
  };

  constructor(options: RequestedUpdateOptions) {
    super();
    this.#updater = options.updater;
    this.#describeReadiness = options.describeReadiness;
    this.#log = options.log;
    this.#announce = options.announce ?? (() => undefined);
    this.#savePreference = options.savePreference;
    this.#allowed = options.preference.allowRemoteUpdates;
    this.#autoInstall = options.preference.autoInstall;
    this.#clientInUse = options.clientInUse ?? null;
    this.#maximumIdleWait = options.maximumIdleWait ?? null;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.#automaticSpreadMs = options.automaticSpreadMs ?? AUTOMATIC_RESTART_SPREAD_MS;
    this.#random = options.random ?? Math.random;
    this.#updater.on("status", this.#onStatus);
    this.#onStatus(this.#updater.getStatus());
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
      autoInstall: this.#installsAutomatically(),
      restart: schedule
        ? { requestedBy: schedule.requestedBy, mode: schedule.mode, waitingFor: [...schedule.waitingFor] }
        : null,
    };
  }

  readonly check = Effect.fn("RequestedUpdate.check")(function* (this: RequestedUpdate) {
    yield* remoteDecode(() => this.#assertAllowed());
    yield* Effect.forkIn(this.#updater.checkForUpdates(), this.#workScope, { startImmediately: true });
    return this.snapshot();
  }).bind(this);

  readonly start = Effect.fn("RequestedUpdate.start")(function* (
    this: RequestedUpdate,
    member: RequestedUpdateMember,
    mode: UpdateRestartMode,
  ) {
    yield* remoteDecode(() => this.#assertAllowed());
    const status = this.#updater.getStatus();
    if (this.#restarting()) return yield* new RemoteWorkflowError({ cause: new RequestedUpdateRefusal("restarting") });
    if (status.phase === "error" && status.errorCode === "install_failed") return this.snapshot();
    this.#installError = null;
    this.#declinedVersion = null;
    this.#schedule = newSchedule(member.id, member.name, mode);
    this.#log(`Member ${member.id} asked for an update restart (${mode}).`);
    this.#publish();
    if (status.phase === "ready") this.#scheduleAttempt(this.#graceMs);
    else if (canDownload(status))
      yield* Effect.forkIn(this.#updater.downloadUpdate(), this.#workScope, { startImmediately: true });
    else if (status.phase !== "checking" && status.phase !== "downloading")
      yield* Effect.forkIn(this.#updater.checkForUpdates(), this.#workScope, { startImmediately: true });
    return this.snapshot();
  }).bind(this);

  readonly requestWhenIdle = Effect.fn("RequestedUpdate.requestWhenIdle")(function* (
    this: RequestedUpdate,
    member: RequestedUpdateMember,
  ) {
    yield* remoteDecode(() => this.#assertAllowed());
    if (this.#schedule && this.#schedule.memberId !== null) return this.snapshot();
    return yield* this.start(member, "when-idle");
  }).bind(this);

  readonly changeSettings = Effect.fn("RequestedUpdate.changeSettings")(function* (
    this: RequestedUpdate,
    change: HostUpdateSettingsChange,
  ) {
    yield* remoteDecode(() => this.#assertAllowed());
    this.emit("preference", yield* this.setPreference(change));
    return this.snapshot();
  }).bind(this);

  readonly setPreference = Effect.fn("RequestedUpdate.setPreference")(function* (
    this: RequestedUpdate,
    change: UpdatePreferenceChange,
  ) {
    const preference = yield* this.#savePreference(change).pipe(
      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
    );
    yield* this.#updater.setAutoDownload(preference.autoDownload);
    this.#allowed = preference.allowRemoteUpdates;
    this.#autoInstall = preference.autoInstall;
    if (this.#schedule && !this.#restarting()) {
      const automatic = this.#schedule.memberId === null;
      if (automatic ? !this.#installsByItself() : !this.#allowed) this.#clear();
    }
    yield* this.#advance(this.#updater.getStatus());
    return preference;
  }).bind(this);

  setRequired(required: boolean): void {
    if (this.#required === required) return;
    this.#required = required;
    Effect.runFork(Effect.forkIn(this.#applyRequired(), this.#workScope, { startImmediately: true }));
  }

  readonly #applyRequired = Effect.fn("RequestedUpdate.applyRequired")(function* (this: RequestedUpdate) {
    const status = this.#updater.getStatus();
    if (!this.#required) {
      if (this.#schedule?.memberId === null && !this.#installsByItself() && !this.#restarting()) this.#clear();
      return;
    }
    if (status.managedByHost || status.phase === "unsupported") return;
    if (status.phase === "idle" || status.phase === "up-to-date" || status.errorCode === "check_failed")
      yield* Effect.forkIn(this.#updater.checkForUpdates(), this.#workScope, { startImmediately: true });
    else yield* this.#advance(status);
  });

  cancel(): HostUpdateStatus {
    const status = this.#updater.getStatus();
    if (this.#restarting()) throw new RequestedUpdateRefusal("restarting");
    if (this.#schedule) {
      this.#log(`The update restart that ${describe(this.#schedule)} asked for was cancelled.`);
      this.#declinedVersion = status.availableVersion;
      this.#clear();
    }
    return this.snapshot();
  }

  readonly dispose = Effect.fn("RequestedUpdate.dispose")(function* (this: RequestedUpdate) {
    this.#updater.off("status", this.#onStatus);
    this.#clearTimer();
    this.#clearSpreadTimer();
    yield* Scope.close(this.#workScope, Exit.void);
  }).bind(this);

  #assertAllowed(): void {
    const status = this.#updater.getStatus();
    if (status.managedByHost) throw new RequestedUpdateRefusal("managed");
    if (!this.#allowed) throw new RequestedUpdateRefusal("disabled");
    if (status.phase === "unsupported") throw new RequestedUpdateRefusal("unsupported");
  }

  readonly #advance = Effect.fn("RequestedUpdate.advance")(function* (this: RequestedUpdate, status: UpdateStatus) {
    if (this.#publishing) return;
    if (!this.#schedule) {
      yield* this.#installAutomatically(status);
      return;
    }
    if (status.phase === "available")
      yield* Effect.forkIn(this.#updater.downloadUpdate(), this.#workScope, { startImmediately: true });
    else if (status.phase === "ready") {
      if (!this.#timer) this.#scheduleAttempt(this.#graceMs);
    } else if (status.phase === "up-to-date" || status.phase === "error" || status.phase === "unsupported") {
      this.#clear();
    }
  });

  readonly #installAutomatically = Effect.fn("RequestedUpdate.installAutomatically")(function* (
    this: RequestedUpdate,
    status: UpdateStatus,
  ) {
    if (!this.#installsByItself() || status.managedByHost || !status.availableVersion) return;
    if (status.availableVersion === this.#declinedVersion) return;
    if (status.phase === "available")
      yield* Effect.forkIn(this.#updater.downloadUpdate(), this.#workScope, { startImmediately: true });
    else if (status.phase === "ready") {
      if (this.#required) this.#clearSpreadTimer();
      else if (this.#spreadTimer) return;
      else if (this.#spreadVersion !== status.availableVersion) {
        this.#spreadVersion = status.availableVersion;
        const spreadMs = Math.floor(this.#random() * this.#automaticSpreadMs);
        if (spreadMs > 0) {
          this.#log(`The automatic restart into ${status.availableVersion} waits ${Math.round(spreadMs / 1000)} s.`);
          this.#spreadTimer = setTimeout(() => {
            this.#spreadTimer = null;
            this.#onStatus(this.#updater.getStatus());
          }, spreadMs);
          this.#spreadTimer.unref?.();
          return;
        }
      }
      this.#schedule = newSchedule(null, null, "when-idle");
      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);
      this.#publish();
      this.#scheduleAttempt(this.#graceMs);
    }
  });

  #scheduleAttempt(delayMs: number): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void runCauseEffect(this.#attemptEffect());
    }, delayMs);
    this.#timer.unref?.();
  }

  readonly #attemptEffect = Effect.fn("RequestedUpdate.attempt")(function* (this: RequestedUpdate) {
    const schedule = this.#schedule;
    if (!schedule || this.#updater.getStatus().phase !== "ready") return;
    const waitingFor = schedule.mode === "when-idle" ? this.#waitingFor(schedule) : [];
    const blockers = waitingFor.length > 0 ? this.#blockers(schedule, waitingFor) : [];
    if (blockers.length > 0) {
      if (blockers.join() !== schedule.waitingFor.join()) {
        schedule.waitingFor = blockers;
        this.#log(`The update restart that ${describe(schedule)} asked for waits for: ${blockers.join(", ")}.`);
        this.#publish();
      }
      this.#scheduleAttempt(this.#pollMs);
      return;
    }
    if (schedule.waitingSince !== null) {
      const ignored = waitingFor.length > 0 ? ` It ignored: ${waitingFor.join(", ")}.` : "";
      this.#log(
        `The update restart that ${describe(schedule)} asked for stopped waiting after ${secondsSince(schedule.waitingSince)} s.${ignored}`,
      );
    }
    if (schedule.waitingFor.length > 0) {
      schedule.waitingFor = [];
      this.#publish();
    }
    this.#log(`Restarting to install the update that ${describe(schedule)} asked for.`);
    this.#announceState("restarting");
    this.#installing = true;
    yield* this.#updater
      .installUpdate()
      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })))
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            const error = failure.cause;
            this.#log(`The requested update restart failed: ${error instanceof Error ? error.message : String(error)}`);
            if (this.#schedule === schedule) {
              this.#installError = "install_failed";
              if (schedule.memberId === null) this.#declinedVersion = this.#updater.getStatus().availableVersion;
              this.#clear();
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#installing = false;
          }),
        ),
      );
  });

  #waitingFor(schedule: Schedule): string[] {
    const { safeToRestart, reasons } = this.#describeReadiness();
    const clientUse = schedule.memberId === null && this.#clientInUse?.() === true;
    if (safeToRestart && !clientUse) return [];
    return [...new Set(clientUse ? [...reasons, "client-use"] : reasons)];
  }

  #blockers(schedule: Schedule, waitingFor: string[]): string[] {
    schedule.waitingSince ??= Date.now();
    const maximumWait = this.#maximumIdleWait;
    if (!maximumWait || Date.now() - schedule.waitingSince < maximumWait.afterMs) return waitingFor;
    if (!schedule.pastMaximumWait) {
      schedule.pastMaximumWait = true;
      this.#log(
        `The update restart that ${describe(schedule)} asked for waited ${secondsSince(schedule.waitingSince)} s. It now waits only for agent work, file transfers, provider operations, the updater and agent setup.`,
      );
    }
    return blockersAfterMaximumWait(waitingFor, maximumWait.providerOperationPending());
  }

  #installsAutomatically(): boolean {
    return this.#autoInstall || this.#clientInUse !== null;
  }

  #installsByItself(): boolean {
    return this.#installsAutomatically() || this.#required;
  }

  #restarting(): boolean {
    return this.#installing || this.#updater.getStatus().phase === "installing";
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

  #clearSpreadTimer(): void {
    if (this.#spreadTimer) clearTimeout(this.#spreadTimer);
    this.#spreadTimer = null;
  }

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

function newSchedule(memberId: string | null, requestedBy: string | null, mode: UpdateRestartMode): Schedule {
  return { memberId, requestedBy, mode, waitingFor: [], waitingSince: null, pastMaximumWait: false };
}

function secondsSince(time: number): number {
  return Math.round((Date.now() - time) / 1000);
}

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
