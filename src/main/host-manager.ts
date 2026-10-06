import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Result, Schema } from "effect";
import type { HostManagerConfig, HostTenantStatus, HostUpdateState } from "../../packages/contracts/src/host-manager";
import { isMissingFileError } from "../backend/file-errors";
import {
  HOST_HEARTBEAT_TIMEOUT_MS,
  HOST_IDLE_GRACE_MS,
  hostStateSchema,
  readHostConfig,
  readOwnedJson,
  tenantStatusSchema,
  verifyTenantDirectory,
  writeProtocolJson,
} from "./host-update-files";

export interface HostManagerOperations {
  /** Fixed release source; never accepts a tenant URL, path, command or version. */
  stageLatest: () => Promise<string | null>;
  install: (version: string) => Promise<void>;
  installedVersion: () => Promise<string>;
  /** Enumerates executable paths and UIDs, never process arguments or tenant files. */
  runningTenants: () => Promise<Array<{ uid: number; pid: number }>>;
  applicationInUse: () => Promise<boolean>;
}

class HostMaintenanceError extends Schema.TaggedError<HostMaintenanceError>()("HostMaintenanceError", {
  cause: Schema.Defect(),
}) {}
const maintenanceCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new HostMaintenanceError({ cause }),
  });
class HostInstallation extends Context.Service<
  HostInstallation,
  {
    stageLatest(): Effect.Effect<string | null, HostMaintenanceError>;
    install(version: string): Effect.Effect<void, HostMaintenanceError>;
    installedVersion(): Effect.Effect<string, HostMaintenanceError>;
    runningTenants(): Effect.Effect<Array<{ uid: number; pid: number }>, HostMaintenanceError>;
    applicationInUse(): Effect.Effect<boolean, HostMaintenanceError>;
  }
>()("openbot/main/HostInstallation") {
  static make(operations: HostManagerOperations) {
    return HostInstallation.of({
      stageLatest: () => maintenanceCall(() => operations.stageLatest()),
      install: (version) => maintenanceCall(() => operations.install(version)),
      installedVersion: () => maintenanceCall(() => operations.installedVersion()),
      runningTenants: () => maintenanceCall(() => operations.runningTenants()),
      applicationInUse: () => maintenanceCall(() => operations.applicationInUse()),
    });
  }
}

/** Owned by one launchd system job. No tenant election and no tenant-supplied control input. */
export class HostManager {
  readonly #directory: string;
  readonly #installation: typeof HostInstallation.Service;
  readonly #hostUid: number;
  readonly #now: () => number;
  #pending: Deferred.Deferred<void, HostMaintenanceError> | null = null;
  #initialized = false;
  #state: HostUpdateState = { phase: "idle", cycle: "", version: null, updatedAt: 0, error: null };
  #idle = new Map<number, { since: number; reportedSince: number; pid: number }>();
  #lastTick: number | null = null;
  #phaseStartedAt = 0;
  #nextCheck = 0;

  constructor(
    directory: string,
    operations: HostManagerOperations,
    options: { hostUid?: number; now?: () => number } = {},
  ) {
    this.#directory = directory;
    this.#installation = HostInstallation.make(operations);
    this.#hostUid = options.hostUid ?? 0;
    this.#now = options.now ?? Date.now;
  }

  readonly tick = Effect.fn("HostManager.tick")(function* (this: HostManager) {
    if (this.#pending) return yield* Deferred.await(this.#pending);
    const pending = Deferred.makeUnsafe<void, HostMaintenanceError>();
    this.#pending = pending;
    yield* this.#cycle().pipe(
      Effect.provideService(HostInstallation, this.#installation),
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          yield* Deferred.done(pending, exit);
          this.#pending = null;
        }),
      ),
      Effect.uninterruptible,
    );
  });

  readonly #publishEffect = Effect.fn("HostManager.publish")(function* (
    this: HostManager,
    phase: HostUpdateState["phase"],
    error: string | null = null,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    if (phase !== this.#state.phase) this.#phaseStartedAt = this.#now();
    this.#state = { ...this.#state, phase, error, updatedAt: this.#now() };
    yield* writeProtocolJson(join(this.#directory, "state.json"), this.#state).pipe(
      Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
    );
  });

  readonly #abortEffect = Effect.fn("HostManager.abort")(function* (
    this: HostManager,
    error: string,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    // A shutdown can be partial. Only a verified, untouched installation may restart those tenants.
    const version =
      this.#state.phase === "stopping"
        ? yield* HostInstallation.use((service) => service.installedVersion()).pipe(
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;
    this.#state = { ...this.#state, version };
    yield* this.#publishEffect("aborted", error);
  });

  readonly #cycle = Effect.fn("HostManager.cycle")(function* (
    this: HostManager,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    const config = yield* readHostConfig(this.#directory, this.#hostUid).pipe(
      Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
    );
    if (!config?.managed) {
      this.#idle.clear();
      this.#lastTick = null;
      this.#initialized = false;
      return;
    }
    if (!this.#initialized) {
      const attempt1 = yield* Effect.gen({ self: this }, function* () {
        this.#state = yield* readOwnedJson(join(this.#directory, "state.json"), this.#hostUid, hostStateSchema).pipe(
          Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
        );
      }).pipe(Effect.result);
      if (Result.isFailure(attempt1)) {
        const error = attempt1.failure.cause;
        if (!isMissingFileError(error)) return yield* new HostMaintenanceError({ cause: error });
      }
      this.#initialized = true;
      // No replay of an interrupted install. An administrator must verify and recover it.
      if (["stopping", "installing", "failed"].includes(this.#state.phase)) {
        yield* this.#publishEffect("failed", sourceText("error.host.maintenanceInterrupted"));
        return;
      }
      if (this.#state.phase !== "released") yield* this.#publishEffect("idle");
      this.#phaseStartedAt = this.#now();
    }
    if (this.#state.phase === "failed" || this.#state.phase === "aborted") return;
    return yield* Effect.gen({ self: this }, function* () {
      if (this.#state.phase === "released") {
        yield* this.#checkHealthEffect(config);
        return;
      }
      if (this.#state.phase === "idle") {
        if (this.#now() < this.#nextCheck) return;
        this.#nextCheck = this.#now() + 240_000;
        yield* this.#publishEffect("downloading");
        const version = yield* HostInstallation.use((service) => service.stageLatest());
        if (!version) {
          yield* this.#publishEffect("idle");
          return;
        }
        this.#state = { ...this.#state, cycle: randomUUID(), version };
        this.#idle.clear();
        yield* this.#publishEffect("waiting");
      }
      if (this.#state.phase === "waiting") yield* this.#waitForIdleEffect(config);
      else if (this.#state.phase === "stopping") yield* this.#waitForExitEffect(config);
    }).pipe(
      Effect.catch(() =>
        Effect.gen({ self: this }, function* () {
          // Deliberately omit exception text: OS command output and tenant input are not diagnostics.
          const message = sourceText("error.host.updateFailed", { phase: this.#state.phase });
          if (this.#state.phase === "installing") yield* this.#publishEffect("failed", message);
          else yield* this.#abortEffect(message);
        }),
      ),
    );
  });

  readonly #statusEffect = Effect.fn("HostManager.status")(function* (
    this: HostManager,
    uid: number,
  ): Effect.fn.Return<HostTenantStatus | null, HostMaintenanceError, HostInstallation> {
    return yield* Effect.gen({ self: this }, function* () {
      const directory = yield* verifyTenantDirectory(this.#directory, uid, this.#hostUid).pipe(
        Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
      );
      const status = yield* readOwnedJson(join(directory, "status.json"), uid, tenantStatusSchema).pipe(
        Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
      );
      const age = this.#now() - status.heartbeatAt;
      return status.uid === uid && age >= 0 && age <= HOST_HEARTBEAT_TIMEOUT_MS ? status : null;
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  });

  readonly #waitForIdleEffect = Effect.fn("HostManager.waitForIdle")(function* (
    this: HostManager,
    config: HostManagerConfig,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    const now = this.#now();
    if (this.#lastTick === null || now < this.#lastTick || now - this.#lastTick > HOST_HEARTBEAT_TIMEOUT_MS)
      this.#idle.clear();
    this.#lastTick = now;
    if (now - this.#phaseStartedAt > 7_200_000) {
      yield* this.#abortEffect(sourceText("error.host.tenantsNotIdle"));
      return;
    }
    const running = yield* HostInstallation.use((service) => service.runningTenants());
    if (running.some((process) => !config.tenants.includes(process.uid))) {
      this.#idle.clear();
      return;
    }
    // Every registered tenant must participate. Missing, logged-out or malformed status blocks.
    for (const uid of config.tenants) {
      const status = yield* this.#statusEffect(uid);
      const matching = running.filter((process) => process.uid === uid);
      if (
        !status?.safeToRestart ||
        status.idleSince === null ||
        status.idleSince > now ||
        matching.length !== 1 ||
        matching[0]?.pid !== status.pid ||
        status.cycle !== this.#state.cycle
      ) {
        this.#idle.delete(uid);
        continue;
      }
      const previous = this.#idle.get(uid);
      if (!previous || previous.pid !== status.pid || previous.reportedSince !== status.idleSince) {
        this.#idle.set(uid, { since: now, reportedSince: status.idleSince, pid: status.pid });
      }
    }
    const ready = config.tenants.every((uid) => {
      const idle = this.#idle.get(uid);
      return idle !== undefined && now - idle.since >= HOST_IDLE_GRACE_MS;
    });
    yield* this.#publishEffect(ready ? "stopping" : "waiting");
  });

  readonly #waitForExitEffect = Effect.fn("HostManager.waitForExit")(function* (
    this: HostManager,
    config: HostManagerConfig,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    if (this.#now() - this.#phaseStartedAt > 120_000) {
      yield* this.#abortEffect(sourceText("error.host.tenantShutdownTimeout"));
      return;
    }
    // A stopped marker is not proof. Wait for the real OS process list, including unregistered users.
    if (yield* HostInstallation.use((service) => service.applicationInUse())) {
      yield* this.#publishEffect("stopping");
      return;
    }
    const currentConfig = yield* readHostConfig(this.#directory, this.#hostUid).pipe(
      Effect.mapError(({ cause }) => new HostMaintenanceError({ cause })),
    );
    if (!currentConfig?.managed || JSON.stringify(currentConfig.tenants) !== JSON.stringify(config.tenants)) {
      return yield* new HostMaintenanceError({ cause: new Error("Host configuration changed during maintenance.") });
    }
    const version = this.#state.version;
    if (!version) return yield* new HostMaintenanceError({ cause: new Error("Missing staged release.") });
    yield* this.#publishEffect("installing");
    yield* HostInstallation.use((service) => service.install(version));
    if ((yield* HostInstallation.use((service) => service.installedVersion())) !== version)
      return yield* new HostMaintenanceError({ cause: new Error("Installed version mismatch.") });
    yield* this.#publishEffect("released");
  });

  readonly #checkHealthEffect = Effect.fn("HostManager.checkHealth")(function* (
    this: HostManager,
    config: HostManagerConfig,
  ): Effect.fn.Return<void, HostMaintenanceError, HostInstallation> {
    const results = yield* Effect.forEach(
      config.tenants,
      (uid) =>
        Effect.gen({ self: this }, function* () {
          const status = yield* this.#statusEffect(uid);
          return status?.healthy && status.currentVersion === this.#state.version && status.cycle === this.#state.cycle;
        }),
      { concurrency: "unbounded" },
    );
    if (results.every(Boolean)) {
      yield* this.#publishEffect("idle");
      this.#nextCheck = this.#now() + 240_000;
    } else if (this.#now() - this.#phaseStartedAt > 600_000) {
      yield* this.#publishEffect("failed", sourceText("error.host.tenantHealthMissing"));
    }
  });
}
