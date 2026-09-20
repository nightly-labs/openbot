import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HostManagerConfig, HostTenantStatus, HostUpdateState } from "../../packages/contracts/src/host-manager";
import {
  HOST_HEARTBEAT_TIMEOUT_MS,
  HOST_IDLE_GRACE_MS,
  hostStateSchema,
  isMissingFile,
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

/** Owned by one launchd system job. No tenant election and no tenant-supplied control input. */
export class HostManager {
  readonly #directory: string;
  readonly #operations: HostManagerOperations;
  readonly #hostUid: number;
  readonly #now: () => number;
  #pending: Promise<void> | null = null;
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
    this.#operations = operations;
    this.#hostUid = options.hostUid ?? 0;
    this.#now = options.now ?? Date.now;
  }

  tick(): Promise<void> {
    if (this.#pending) return this.#pending;
    this.#pending = this.#tick().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #publish(phase: HostUpdateState["phase"], error: string | null = null): Promise<void> {
    if (phase !== this.#state.phase) this.#phaseStartedAt = this.#now();
    this.#state = { ...this.#state, phase, error, updatedAt: this.#now() };
    await writeProtocolJson(join(this.#directory, "state.json"), this.#state);
  }

  async #tick(): Promise<void> {
    const config = await readHostConfig(this.#directory, this.#hostUid);
    if (!config?.managed) {
      this.#idle.clear();
      this.#lastTick = null;
      this.#initialized = false;
      return;
    }
    if (!this.#initialized) {
      try {
        this.#state = await readOwnedJson(join(this.#directory, "state.json"), this.#hostUid, hostStateSchema);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      this.#initialized = true;
      // No replay of an interrupted install. An administrator must verify and recover it.
      if (["stopping", "installing", "failed"].includes(this.#state.phase)) {
        await this.#publish(
          "failed",
          "Interrupted host maintenance. Verify the application and reset host state before retrying.",
        );
        return;
      }
      if (this.#state.phase !== "released") await this.#publish("idle");
      this.#phaseStartedAt = this.#now();
    }
    if (this.#state.phase === "failed") return;
    try {
      if (this.#state.phase === "released") {
        await this.#checkHealth(config);
        return;
      }
      if (this.#state.phase === "idle") {
        if (this.#now() < this.#nextCheck) return;
        this.#nextCheck = this.#now() + 240_000;
        await this.#publish("downloading");
        const version = await this.#operations.stageLatest();
        if (!version) {
          await this.#publish("idle");
          return;
        }
        this.#state = { ...this.#state, cycle: randomUUID(), version };
        this.#idle.clear();
        await this.#publish("waiting");
      }
      if (this.#state.phase === "waiting") await this.#waitForIdle(config);
      else if (this.#state.phase === "stopping") await this.#waitForExit(config);
    } catch {
      // Deliberately omit exception text: OS command output and tenant input are not diagnostics.
      await this.#publish(
        "failed",
        `Host update failed during ${this.#state.phase}. Verify bundle ownership, signing, tenant status and free disk space before resetting state.`,
      );
    }
  }

  async #status(uid: number): Promise<HostTenantStatus | null> {
    try {
      const directory = await verifyTenantDirectory(this.#directory, uid, this.#hostUid);
      const status = await readOwnedJson(join(directory, "status.json"), uid, tenantStatusSchema);
      const age = this.#now() - status.heartbeatAt;
      return status.uid === uid && age >= 0 && age <= HOST_HEARTBEAT_TIMEOUT_MS ? status : null;
    } catch {
      return null;
    }
  }

  async #waitForIdle(config: HostManagerConfig): Promise<void> {
    const now = this.#now();
    if (this.#lastTick === null || now < this.#lastTick || now - this.#lastTick > HOST_HEARTBEAT_TIMEOUT_MS)
      this.#idle.clear();
    this.#lastTick = now;
    if (now - this.#phaseStartedAt > 7_200_000) {
      await this.#publish("failed", "Tenants did not remain idle for five minutes within two hours.");
      return;
    }
    const running = await this.#operations.runningTenants();
    if (running.some((process) => !config.tenants.includes(process.uid))) {
      this.#idle.clear();
      return;
    }
    // Every registered tenant must participate. Missing, logged-out or malformed status blocks.
    for (const uid of config.tenants) {
      const status = await this.#status(uid);
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
    await this.#publish(ready ? "stopping" : "waiting");
  }

  async #waitForExit(config: HostManagerConfig): Promise<void> {
    if (this.#now() - this.#phaseStartedAt > 120_000) {
      await this.#publish("failed", "Tenant shutdown timed out. No application replacement was started.");
      return;
    }
    // A stopped marker is not proof. Wait for the real OS process list, including unregistered users.
    if (await this.#operations.applicationInUse()) {
      await this.#publish("stopping");
      return;
    }
    const currentConfig = await readHostConfig(this.#directory, this.#hostUid);
    if (!currentConfig?.managed || JSON.stringify(currentConfig.tenants) !== JSON.stringify(config.tenants)) {
      throw new Error("Host configuration changed during maintenance.");
    }
    const version = this.#state.version;
    if (!version) throw new Error("Missing staged release.");
    await this.#publish("installing");
    await this.#operations.install(version);
    if ((await this.#operations.installedVersion()) !== version) throw new Error("Installed version mismatch.");
    await this.#publish("released");
  }

  async #checkHealth(config: HostManagerConfig): Promise<void> {
    const results = await Promise.all(
      config.tenants.map(async (uid) => {
        const status = await this.#status(uid);
        return status?.healthy && status.currentVersion === this.#state.version && status.cycle === this.#state.cycle;
      }),
    );
    if (results.every(Boolean)) {
      await this.#publish("idle");
      this.#nextCheck = this.#now() + 240_000;
    } else if (this.#now() - this.#phaseStartedAt > 600_000) {
      await this.#publish(
        "failed",
        "Tenant health reports are missing or unhealthy after restart. Inspect tenant sessions before another update.",
      );
    }
  }
}
