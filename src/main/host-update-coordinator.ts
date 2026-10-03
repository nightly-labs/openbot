import { join } from "node:path";
import { Deferred, Effect } from "effect";
import type { HostUpdateState } from "../../packages/contracts/src/host-manager";
import { restartActivityGeneration } from "../backend/restart-activity";
import {
  HOST_HEARTBEAT_TIMEOUT_MS,
  HOST_IDLE_GRACE_MS,
  HOST_MANAGER_DIRECTORY,
  HOST_POLL_MS,
  hostStateSchema,
  readHostConfig,
  readOwnedJson,
  verifyTenantDirectory,
  writeProtocolJson,
} from "./host-update-files";
import { RemoteWorkflowError, remoteCall, runRemoteWorkflow } from "./remote-service-effects";
import type { RestartReadiness } from "./update-readiness";

interface HostUpdateCoordinatorOptions {
  platform?: NodeJS.Platform;
  directory?: string;
  hostUid?: number;
  uid: number;
  pid: number;
  currentVersion: string;
  now?: () => number;
  describeReadiness: () => RestartReadiness;
  checkHealth: () => Effect.Effect<{ ok: boolean; checks: string[] }, RemoteWorkflowError>;
  setManagedByHost: (managed: boolean) => void;
  setHostState?: (state: HostUpdateState) => void;
  onDiagnostic?: (message: string) => void;
}

/** Tenant client only. It can report its own status and quit its own process. */
export class HostUpdateCoordinator {
  readonly #options: HostUpdateCoordinatorOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #stopHandler: (() => Promise<void>) | null = null;
  #stopRequested = false;
  #idleSince: number | null = null;
  #activityGeneration = restartActivityGeneration();

  constructor(options: HostUpdateCoordinatorOptions) {
    this.#options = options;
  }

  start(): void {
    if ((this.#options.platform ?? process.platform) !== "darwin") return;
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void runRemoteWorkflow(this.tick()).catch(() =>
        this.#options.onDiagnostic?.("Host status exchange failed. Contact the host administrator."),
      );
    }, HOST_POLL_MS);
    this.#timer.unref();
  }

  stop(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      // The stop handler enters teardown, so waiting on its own tick would deadlock.
    });
  }

  setStopHandler(handler: () => Promise<void>): void {
    this.#stopHandler = handler;
  }

  readonly tick = Effect.fn("HostCoordinator.tick")(function* (this: HostUpdateCoordinator) {
    if (this.#pending) return yield* Deferred.await(this.#pending);
    const pending = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#pending = pending;
    yield* this.#exchange().pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          yield* Deferred.done(pending, exit);
          this.#pending = null;
        }),
      ),
    );
  });

  readonly #exchange = Effect.fn("HostCoordinator.exchange")(function* (
    this: HostUpdateCoordinator,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if ((this.#options.platform ?? process.platform) !== "darwin") {
      this.#options.setManagedByHost(false);
      return;
    }
    const directory = this.#options.directory ?? HOST_MANAGER_DIRECTORY;
    const hostUid = this.#options.hostUid ?? 0;
    const config = yield* readHostConfig(directory, hostUid).pipe(
      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
    );
    const managed = config?.managed === true;
    this.#options.setManagedByHost(managed);
    if (!managed) {
      this.#idleSince = null;
      return;
    }
    if (!config.tenants.includes(this.#options.uid)) return;
    const tenantDirectory = yield* verifyTenantDirectory(directory, this.#options.uid, hostUid).pipe(
      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
    );
    const state = yield* readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema).pipe(
      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
    );
    this.#options.setHostState?.(state);
    const now = (this.#options.now ?? Date.now)();
    const activityGeneration = restartActivityGeneration();
    if (activityGeneration !== this.#activityGeneration) this.#idleSince = null;
    this.#activityGeneration = activityGeneration;
    const readiness = this.#options.describeReadiness();
    if (!readiness.safeToRestart) this.#idleSince = null;
    else this.#idleSince ??= now;
    const health = yield* this.#options.checkHealth();
    yield* writeProtocolJson(join(tenantDirectory, "status.json"), {
      uid: this.#options.uid,
      pid: this.#options.pid,
      currentVersion: this.#options.currentVersion,
      heartbeatAt: now,
      safeToRestart: readiness.safeToRestart,
      idleSince: this.#idleSince,
      cycle: state.cycle,
      healthy: health.ok,
    }).pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
    if (state.phase !== "stopping") {
      this.#stopRequested = false;
      return;
    }
    if (now < state.updatedAt || now - state.updatedAt > HOST_HEARTBEAT_TIMEOUT_MS) return;
    // A short operation after the host's last observation must also veto an already-issued stop.
    if (this.#idleSince === null || now - this.#idleSince < HOST_IDLE_GRACE_MS) return;
    if (
      restartActivityGeneration() !== activityGeneration ||
      !this.#options.describeReadiness().safeToRestart ||
      this.#stopRequested ||
      !this.#stopHandler
    )
      return;
    const stopHandler = this.#stopHandler;
    this.#stopRequested = true;
    return yield* Effect.gen({ self: this }, function* () {
      yield* remoteCall(() => stopHandler());
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          this.#stopRequested = false;
          return yield* new RemoteWorkflowError({ cause: error });
        }),
      ),
    );
  });
}

/** Called before tenant services start, so login items cannot start work during replacement. */
export const hostAllowsTenantLaunch = Effect.fn("HostCoordinator.allowsLaunch")(function* () {
  if (process.platform !== "darwin") return true;
  const config = yield* readHostConfig().pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
  if (!config?.managed) return true;
  const state = yield* readOwnedJson(join(HOST_MANAGER_DIRECTORY, "state.json"), 0, hostStateSchema).pipe(
    Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
  );
  return !["stopping", "installing", "failed"].includes(state.phase);
});
