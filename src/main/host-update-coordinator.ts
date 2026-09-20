import { join } from "node:path";
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
  checkHealth: () => Promise<{ ok: boolean; checks: string[] }>;
  setManagedByHost: (managed: boolean) => void;
  setHostState?: (state: HostUpdateState) => void;
  onDiagnostic?: (message: string) => void;
}

/** Tenant client only. It can report its own status and quit its own process. */
export class HostUpdateCoordinator {
  readonly #options: HostUpdateCoordinatorOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Promise<void> | null = null;
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
      void this.tick().catch(() =>
        this.#options.onDiagnostic?.("Host status exchange failed. Contact the host administrator."),
      );
    }, HOST_POLL_MS);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    // Do not wait on #pending: the stop handler itself enters application teardown.
  }

  setStopHandler(handler: () => Promise<void>): void {
    this.#stopHandler = handler;
  }

  tick(): Promise<void> {
    if (this.#pending) return this.#pending;
    this.#pending = this.#tick().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #tick(): Promise<void> {
    if ((this.#options.platform ?? process.platform) !== "darwin") {
      this.#options.setManagedByHost(false);
      return;
    }
    const directory = this.#options.directory ?? HOST_MANAGER_DIRECTORY;
    const hostUid = this.#options.hostUid ?? 0;
    const config = await readHostConfig(directory, hostUid);
    const managed = config?.managed === true;
    this.#options.setManagedByHost(managed);
    if (!managed) {
      this.#idleSince = null;
      return;
    }
    if (!config.tenants.includes(this.#options.uid)) return;
    const tenantDirectory = await verifyTenantDirectory(directory, this.#options.uid, hostUid);
    const state = await readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema);
    this.#options.setHostState?.(state);
    const now = (this.#options.now ?? Date.now)();
    const activityGeneration = restartActivityGeneration();
    if (activityGeneration !== this.#activityGeneration) this.#idleSince = null;
    this.#activityGeneration = activityGeneration;
    const readiness = this.#options.describeReadiness();
    if (!readiness.safeToRestart) this.#idleSince = null;
    else this.#idleSince ??= now;
    const health = await this.#options.checkHealth();
    await writeProtocolJson(join(tenantDirectory, "status.json"), {
      uid: this.#options.uid,
      pid: this.#options.pid,
      currentVersion: this.#options.currentVersion,
      heartbeatAt: now,
      safeToRestart: readiness.safeToRestart,
      idleSince: this.#idleSince,
      cycle: state.cycle,
      healthy: health.ok,
    });
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
    this.#stopRequested = true;
    try {
      await this.#stopHandler();
    } catch (error) {
      this.#stopRequested = false;
      throw error;
    }
  }
}

/** Called before tenant services start, so login items cannot start work during replacement. */
export async function hostAllowsTenantLaunch(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  const config = await readHostConfig();
  if (!config?.managed) return true;
  const state = await readOwnedJson(join(HOST_MANAGER_DIRECTORY, "state.json"), 0, hostStateSchema);
  return !["stopping", "installing", "failed"].includes(state.phase);
}
