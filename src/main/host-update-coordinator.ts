import { mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RestartReadiness } from "./update-readiness";

/**
 * Host-wide update coordination for one Mac shared by several macOS users.
 *
 * One tenant's OpenBot leads: it waits until every tenant reports safe to restart,
 * holds that state for the idle grace period, tells everyone to stop, replaces the shared
 * application bundle once through its own updater, and publishes the release marker the
 * per-user relaunch agents watch. Tenants never signal each other's processes — a Standard
 * user cannot — so stopping is always self-inflicted on the leader's published intent, and
 * starting is always the per-user agent relaunching inside its own GUI session.
 *
 * All coordination is files in one shared directory, polled on a timer. Nothing here is
 * secret and nothing is executed, so a tenant can at worst stall an update by lying about
 * its own state; ownership of each status file is verified before it is trusted.
 */
export const COORDINATION_DEFAULT_DIRECTORY = "/Users/Shared/OpenBot/updates";
/**
 * Dropped by the Mac administrator to put every tenant into host-managed update mode:
 * tenants report status but never install on their own. Presence enables; delete to leave.
 */
export const HOST_MANAGED_MARKER_PATH = "/Library/Application Support/OpenBot/host-managed.json";
export const DEFAULT_IDLE_GRACE_MS = 5 * 60 * 1_000;
export const DEFAULT_POLL_MS = 15_000;
export const DEFAULT_HEARTBEAT_MS = 20_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 10 * 60 * 1_000;

const leaderSchema = z.object({ uid: z.number().int(), pid: z.number().int(), heartbeatAt: z.number() });
const intentStateSchema = z.enum(["waiting", "stopping", "installing", "done", "aborted"]);
export type UpdateIntentState = z.infer<typeof intentStateSchema>;
const intentSchema = z.object({
  state: intentStateSchema,
  version: z.string().min(1),
  /** Reserved for staged update waves; a single Mac always uses wave 1. */
  wave: z.number().int(),
  leaderUid: z.number().int(),
  updatedAt: z.number(),
  reason: z.string().nullable(),
});
export type UpdateIntent = z.infer<typeof intentSchema>;
const statusSchema = z.object({
  uid: z.number().int(),
  safeToRestart: z.boolean(),
  reasons: z.string().array(),
  currentVersion: z.string().min(1),
  updateVersion: z.string().nullable(),
  heartbeatAt: z.number(),
});
export type TenantStatus = z.infer<typeof statusSchema>;
const stoppedSchema = z.object({ uid: z.number().int(), at: z.number(), version: z.string().min(1) });
const releaseSchema = z.object({ version: z.string().min(1), releasedAt: z.number(), wave: z.number().int() });
const healthSchema = z.object({
  uid: z.number().int(),
  version: z.string().min(1),
  ok: z.boolean(),
  checks: z.string().array(),
  at: z.number(),
});
export type TenantHealth = z.infer<typeof healthSchema>;

interface TrackedTenant {
  uid: number;
  idle: boolean;
  stopped: boolean;
}

export interface HostUpdateCoordinatorOptions {
  directory?: string;
  uid: number;
  pid: number;
  currentVersion: string;
  now?: () => number;
  idleGraceMs?: number;
  pollIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  waitTimeoutMs?: number;
  healthTimeoutMs?: number;
  describeReadiness: () => RestartReadiness;
  /** Post-restart probe. Runs once per released version; kept small and infallible. */
  checkHealth?: () => Promise<{ ok: boolean; checks: string[] }>;
  /** This instance's downloaded, ready-to-install version, or null when it has none. */
  getReadyVersion: () => string | null;
  /** File owner lookup, separated for tests: production stats the shared directory. */
  statUid?: (name: string) => Promise<number | null>;
  /** Called once when this instance must quit itself for the update. */
  onShouldStop?: (version: string) => void;
  /** Leader only: replace the shared bundle (own updater) and relaunch this instance. */
  install?: () => Promise<void>;
  /** Flips the tenant UI between self-serve and host-managed updates. */
  setManagedByHost?: (managed: boolean) => void;
  /** Path of the administrator's host-managed marker; defaults to the shared Mac location. */
  hostManagedMarkerPath?: string;
  onDiagnostic?: (message: string) => void;
}

export class HostUpdateCoordinator {
  readonly #options: Required<
    Pick<
      HostUpdateCoordinatorOptions,
      | "directory"
      | "uid"
      | "pid"
      | "currentVersion"
      | "idleGraceMs"
      | "pollIntervalMs"
      | "heartbeatTimeoutMs"
      | "waitTimeoutMs"
      | "healthTimeoutMs"
      | "describeReadiness"
      | "getReadyVersion"
    >
  > &
    Pick<
      HostUpdateCoordinatorOptions,
      | "onShouldStop"
      | "install"
      | "checkHealth"
      | "setManagedByHost"
      | "hostManagedMarkerPath"
      | "onDiagnostic"
      | "statUid"
    > & {
      now: () => number;
    };
  #timer: ReturnType<typeof setInterval> | null = null;
  #directoryUsable: boolean | null = null;
  #idleSince = new Map<number, number>();
  #cycleStartedAt: number | null = null;
  #stopRequested = false;
  #installing = false;
  #managedByHost: boolean | null = null;
  #stopHandler: ((version: string) => void) | null;
  #healthReportedFor: string | null = null;
  #alertedFor: string | null = null;
  #installedVersion: string | null = null;
  #cycleVersion: string | null = null;
  #now: () => number;

  constructor(options: HostUpdateCoordinatorOptions) {
    this.#now = options.now ?? Date.now;
    this.#stopHandler = options.onShouldStop ?? null;
    this.#options = {
      ...options,
      directory: options.directory ?? COORDINATION_DEFAULT_DIRECTORY,
      idleGraceMs: options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_MS,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      waitTimeoutMs: options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      healthTimeoutMs: options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      now: this.#now,
    };
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.tick().catch((error: unknown) =>
        this.#options.onDiagnostic?.(
          `Host update coordination tick failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, this.#options.pollIntervalMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#relinquishLeadership();
    await this.#removeOwnStatus();
  }

  /** Wired after construction by the entry point, which owns the quit sequence. */
  setStopHandler(handler: (version: string) => void): void {
    this.#stopHandler = handler;
  }

  /**
   * One coordination round. Timers only schedule this; tests drive it directly with a fake
   * clock, which is why every timestamp flows through `now`.
   */
  async tick(): Promise<void> {
    await this.#syncManagedFlag();
    if (!(await this.#directoryReady())) return;
    await this.#publishStatus();
    const leader = await this.#readLeader();
    const leading = leader !== null && leader.uid === this.#options.uid && leader.pid === this.#options.pid;
    if (leading) await this.#lead();
    else await this.#follow(leader);
    await this.#reportHealth();
    await this.#verifyReleaseHealth();
  }

  /** Graceful update quit (Step 3 quit path): leave the stopped marker, remove the status. */
  async markStopped(version: string): Promise<void> {
    if (!(await this.#directoryReady())) return;
    const now = this.#now();
    await this.#writeJson(`stopped-${this.#options.uid}.json`, { uid: this.#options.uid, at: now, version });
    await this.#removeOwnStatus();
  }

  /**
   * Post-restart health, once per released version. A relaunched tenant proves it loaded its
   * data again; without this the leader cannot tell a healthy restart from a crash loop.
   */
  async #reportHealth(): Promise<void> {
    const release = await this.#readJson("release.json", releaseSchema);
    if (!release || release.version !== this.#options.currentVersion) return;
    if (this.#healthReportedFor === release.version) return;
    const existing = await this.#readJson(`health-${this.#options.uid}.json`, healthSchema);
    if (existing && existing.version === release.version) {
      this.#healthReportedFor = release.version;
      return;
    }
    let report = { ok: false, checks: ["probe-missing"] };
    try {
      report = (await this.#options.checkHealth?.()) ?? { ok: true, checks: [] };
    } catch {
      report = { ok: false, checks: ["probe-threw"] };
    }
    await this.#writeJson(`health-${this.#options.uid}.json`, {
      uid: this.#options.uid,
      version: release.version,
      ok: report.ok,
      checks: report.checks,
      at: this.#now(),
    });
    this.#healthReportedFor = release.version;
  }

  /**
   * Any instance: once the host completed a cycle for the released version, check every
   * tenant that stopped for it reported healthy, and write the alert record the administrator
   * checks. Runs on followers too, because the relaunched leader may hold no download and
   * therefore never contend. Content is a pure function of the health files, so concurrent
   * writers agree; an incomplete or failed set stays on disk instead of being rolled back,
   * because downgrading under migrated databases is not safe.
   */
  async #verifyReleaseHealth(): Promise<void> {
    const release = await this.#readJson("release.json", releaseSchema);
    if (!release) return;
    if (this.#alertedFor === release.version) return;
    const intent = await this.#readJson("intent.json", intentSchema);
    if (intent?.state !== "done" || intent.version !== release.version) return;
    const tenants = await this.#releaseTenants(release.version);
    if (tenants.length === 0) return;
    const results: Array<{ uid: number; ok: boolean; checks: string[] }> = [];
    let complete = true;
    for (const uid of tenants) {
      const health = await this.#readJson(`health-${uid}.json`, healthSchema);
      const owner = await this.#fileOwner(`health-${uid}.json`);
      if (!health || health.version !== release.version || health.uid !== uid || owner !== uid) {
        complete = false;
        results.push({ uid, ok: false, checks: ["missing"] });
        continue;
      }
      results.push({ uid, ok: health.ok, checks: health.checks });
      if (!health.ok) complete = false;
    }
    const releasedAgo = this.#now() - release.releasedAt;
    if (!complete && releasedAgo < this.#options.healthTimeoutMs) return;
    await this.#writeJson(`alert-${release.version}.json`, {
      version: release.version,
      at: this.#now(),
      complete,
      tenants: results,
    });
    this.#alertedFor = release.version;
  }

  /** Tenants that stopped for this version, tenants already running it, and stragglers still on the old one. */
  async #releaseTenants(version: string): Promise<number[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#options.directory);
    } catch {
      return [];
    }
    const now = this.#now();
    const uids = new Set<number>();
    for (const entry of entries) {
      if (/^stopped-\d+\.json$/.test(entry)) {
        const stopped = await this.#readJson(entry, stoppedSchema);
        if (stopped && stopped.version === version) uids.add(stopped.uid);
      }
      if (/^status-\d+\.json$/.test(entry)) {
        const status = await this.#readJson(entry, statusSchema);
        if (status && now - status.heartbeatAt <= this.#options.heartbeatTimeoutMs) uids.add(status.uid);
      }
    }
    return [...uids].sort((left, right) => left - right);
  }

  async #directoryReady(): Promise<boolean> {
    if (this.#directoryUsable !== null) return this.#directoryUsable;
    try {
      await mkdir(this.#options.directory, { recursive: true });
      this.#directoryUsable = true;
    } catch {
      this.#directoryUsable = false;
    }
    return this.#directoryUsable;
  }

  async #publishStatus(): Promise<void> {
    const readiness = this.#options.describeReadiness();
    const readyVersion = this.#options.getReadyVersion();
    await this.#writeJson(`status-${this.#options.uid}.json`, {
      uid: this.#options.uid,
      safeToRestart: readiness.safeToRestart,
      reasons: readiness.reasons,
      currentVersion: this.#options.currentVersion,
      updateVersion: readyVersion,
      heartbeatAt: this.#now(),
    });
  }

  async #removeOwnStatus(): Promise<void> {
    try {
      await unlink(join(this.#options.directory, `status-${this.#options.uid}.json`));
    } catch {
      // A missing status is the goal; a stale one expires by heartbeat.
    }
  }

  /** A quitter must not keep the lock: whoever comes next reclaims it by heartbeat anyway. */
  async #relinquishLeadership(): Promise<void> {
    const leader = await this.#readJson("leader.json", leaderSchema);
    if (leader && leader.uid === this.#options.uid && leader.pid === this.#options.pid) {
      try {
        await unlink(join(this.#options.directory, "leader.json"));
      } catch {
        // The next contender clears it on takeover.
      }
    }
  }

  async #syncManagedFlag(): Promise<void> {
    const marker = this.#options.hostManagedMarkerPath ?? HOST_MANAGED_MARKER_PATH;
    let managed = false;
    try {
      await stat(marker);
      managed = true;
    } catch {
      managed = false;
    }
    if (managed !== this.#managedByHost) {
      this.#managedByHost = managed;
      this.#options.setManagedByHost?.(managed);
    }
  }

  async #readLeader(): Promise<{ uid: number; pid: number; heartbeatAt: number } | null> {
    const raw = await this.#readJson("leader.json", leaderSchema);
    if (!raw) return null;
    if (this.#now() - raw.heartbeatAt > this.#options.heartbeatTimeoutMs) return null;
    const ownership = await this.#fileOwner("leader.json");
    if (ownership === null || ownership !== raw.uid) return null;
    return raw;
  }

  async #claimLeadership(): Promise<boolean> {
    const path = join(this.#options.directory, "leader.json");
    const body = `${JSON.stringify({ uid: this.#options.uid, pid: this.#options.pid, heartbeatAt: this.#now() })}\n`;
    try {
      const handle = await open(path, "wx", 0o644);
      await handle.writeFile(body, "utf8");
      await handle.close();
      return true;
    } catch {
      return false;
    }
  }

  async #refreshLeadership(): Promise<void> {
    await this.#writeJson("leader.json", {
      uid: this.#options.uid,
      pid: this.#options.pid,
      heartbeatAt: this.#now(),
    });
  }

  async #follow(leader: { uid: number; pid: number; heartbeatAt: number } | null): Promise<void> {
    // Only instances with a downloaded update contend. Leadership without the bits on disk
    // coordinates nothing and only churns the lock.
    if (!leader && this.#options.getReadyVersion() !== null) {
      // A stale or garbage lock blocks every contender: remove it best-effort, then let the
      // atomic claim decide exactly one winner. Deleting another tenant's live lock fails on
      // the directory's sticky bit, so this cannot dethrone a healthy leader.
      try {
        await unlink(join(this.#options.directory, "leader.json"));
      } catch {
        // Still locked by someone else; follow the fresh read below.
      }
      if (await this.#claimLeadership()) return;
    }
    const intent = await this.#readJson("intent.json", intentSchema);
    if (intent?.state !== "stopping") {
      this.#stopRequested = false;
      return;
    }
    const liveLeader = await this.#readLeader();
    if (!liveLeader || liveLeader.uid !== intent.leaderUid) return;
    const readiness = this.#options.describeReadiness();
    if (!readiness.safeToRestart || this.#stopRequested) return;
    this.#stopRequested = true;
    try {
      await this.#stopHandler?.(intent.version);
    } catch (error) {
      // The quit did not happen: clear the latch so the next tick retries instead of
      // leaving this tenant parked on a stopping intent it never obeyed.
      this.#stopRequested = false;
      this.#options.onDiagnostic?.(
        `Host-managed update stop failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #lead(): Promise<void> {
    const version = this.#options.getReadyVersion();
    if (version === null || this.#installing) {
      await this.#refreshLeadership();
      return;
    }
    // Terminal state: this process already installed this version. Without it the done
    // intent below reads as "not stopping" on the next tick and the bundle is replaced
    // again. A relaunched process starts with no memory and nothing downloaded, so it
    // cannot mistake itself for the installer.
    if (this.#installedVersion === version) {
      await this.#refreshLeadership();
      return;
    }
    if (this.#cycleVersion !== version) {
      this.#cycleVersion = version;
      this.#cycleStartedAt = null;
      this.#idleSince.clear();
    }
    if (this.#cycleStartedAt === null) this.#cycleStartedAt = this.#now();
    if (this.#now() - this.#cycleStartedAt > this.#options.waitTimeoutMs) {
      await this.#abortCycle(version, "Tenants did not go idle in time.");
      return;
    }
    const tenants = await this.#readTenants(version);
    this.#trackIdle(tenants);
    const blocking = tenants.filter((tenant) => !this.#idleLongEnough(tenant.uid));
    if (blocking.length > 0) {
      await this.#writeIntent({
        state: "waiting",
        version,
        wave: 1,
        leaderUid: this.#options.uid,
        updatedAt: this.#now(),
        reason: `Waiting for ${blocking.length} tenant session(s).`,
      });
      await this.#refreshLeadership();
      return;
    }
    const intent = await this.#readJson("intent.json", intentSchema);
    if (intent?.state !== "stopping" || intent.version !== version) {
      await this.#writeIntent({
        state: "stopping",
        version,
        wave: 1,
        leaderUid: this.#options.uid,
        updatedAt: this.#now(),
        reason: null,
      });
      await this.#refreshLeadership();
      return;
    }
    // Every tenant but the leader stopped. The leader stops through the install below, not
    // through the intent; its own idleness was already enforced by the grace check above.
    const othersStopped = tenants.every((tenant) => tenant.uid === this.#options.uid || tenant.stopped);
    if (!othersStopped) {
      await this.#refreshLeadership();
      return;
    }
    this.#installing = true;
    try {
      await this.#writeIntent({
        state: "installing",
        version,
        wave: 1,
        leaderUid: this.#options.uid,
        updatedAt: this.#now(),
        reason: null,
      });
      await this.#options.install?.();
      await this.#writeJson("release.json", { version, releasedAt: this.#now(), wave: 1 });
      await this.#writeIntent({
        state: "done",
        version,
        wave: 1,
        leaderUid: this.#options.uid,
        updatedAt: this.#now(),
        reason: null,
      });
      this.#installedVersion = version;
    } finally {
      this.#installing = false;
    }
    await this.#refreshLeadership();
  }

  /**
   * Every tenant this cycle must wait for: a fresh, owned status file, or a stopped marker
   * for this version. Unknown, stale, unowned and version-mismatched tenants count as busy —
   * failing closed is what keeps one confused instance from letting the bundle be replaced
   * under the others. A tenant already running the new version needs nothing.
   */
  async #readTenants(version: string): Promise<TrackedTenant[]> {
    const now = this.#now();
    let entries: string[];
    try {
      entries = await readdir(this.#options.directory);
    } catch {
      return [];
    }
    const tenants = new Map<number, TrackedTenant>();
    for (const entry of entries) {
      if (!/^status-\d+\.json$/.test(entry)) continue;
      const status = await this.#readJson(entry, statusSchema);
      if (!status) continue;
      const owner = await this.#fileOwner(entry);
      if (owner === null || owner !== status.uid) continue;
      if (status.currentVersion === version) {
        tenants.set(status.uid, { uid: status.uid, idle: true, stopped: true });
        continue;
      }
      const fresh = now - status.heartbeatAt <= this.#options.heartbeatTimeoutMs;
      const versionOk = status.updateVersion !== null && status.updateVersion === version;
      tenants.set(status.uid, { uid: status.uid, idle: fresh && versionOk && status.safeToRestart, stopped: false });
    }
    for (const entry of entries) {
      if (!/^stopped-\d+\.json$/.test(entry)) continue;
      const stopped = await this.#readJson(entry, stoppedSchema);
      if (!stopped || stopped.version !== version) continue;
      const owner = await this.#fileOwner(entry);
      if (owner === null || owner !== stopped.uid) continue;
      tenants.set(stopped.uid, { uid: stopped.uid, idle: true, stopped: true });
    }
    return [...tenants.values()];
  }

  /** Continuity is the point: any busy sighting restarts that tenant's grace clock. */
  #trackIdle(tenants: TrackedTenant[]): void {
    const now = this.#now();
    const seen = new Set<number>();
    for (const tenant of tenants) {
      seen.add(tenant.uid);
      if (tenant.idle) {
        if (!this.#idleSince.has(tenant.uid)) this.#idleSince.set(tenant.uid, now);
      } else {
        this.#idleSince.delete(tenant.uid);
      }
    }
    for (const uid of [...this.#idleSince.keys()]) {
      if (!seen.has(uid)) this.#idleSince.delete(uid);
    }
  }

  #idleLongEnough(uid: number): boolean {
    const since = this.#idleSince.get(uid);
    if (since === undefined) return false;
    return this.#now() - since >= this.#options.idleGraceMs;
  }

  async #abortCycle(version: string, reason: string): Promise<void> {
    await this.#writeIntent({
      state: "aborted",
      version,
      wave: 1,
      leaderUid: this.#options.uid,
      updatedAt: this.#now(),
      reason,
    });
    this.#cycleStartedAt = null;
    this.#cycleVersion = null;
    this.#idleSince.clear();
    await this.#refreshLeadership();
  }

  async #readJson<T>(name: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      return schema.parse(JSON.parse(await readFile(join(this.#options.directory, name), "utf8")));
    } catch {
      return null;
    }
  }

  async #writeJson(name: string, value: unknown): Promise<void> {
    try {
      await writeFile(join(this.#options.directory, name), `${JSON.stringify(value)}\n`, { mode: 0o644 });
    } catch {
      // Best effort: a lost heartbeat or intent is repaired on the next tick.
    }
  }

  async #writeIntent(intent: UpdateIntent): Promise<void> {
    await this.#writeJson("intent.json", intent);
  }

  async #fileOwner(name: string): Promise<number | null> {
    if (this.#options.statUid) return this.#options.statUid(name);
    try {
      return (await stat(join(this.#options.directory, name))).uid;
    } catch {
      return null;
    }
  }
}
