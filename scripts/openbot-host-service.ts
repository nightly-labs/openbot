import type { HostManagerConfig, HostTenantStatus, HostUpdateState } from "../packages/contracts/src/host-manager";
import { HOST_HEARTBEAT_TIMEOUT_MS, HOST_IDLE_GRACE_MS } from "../src/main/host-update-files";

export interface HostTenant {
  name: string;
  uid: number;
}
export interface HostCredential extends HostTenant {
  password: string;
}
export interface HostSetupRequest {
  createUsers: string[];
  tenants: string[];
  dryRun: boolean;
}
export interface HostAdminOperations {
  verifyInstallation: () => Promise<void>;
  verifyApplication: () => Promise<void>;
  prepareApplication: () => Promise<void>;
  readConfig: () => Promise<HostManagerConfig | null>;
  checkNewUsers: (names: string[]) => Promise<void>;
  inspectTenant: (name: string) => Promise<HostTenant>;
  createUsers: (names: string[]) => Promise<HostCredential[]>;
  register: (uids: number[]) => Promise<void>;
  startJobs: (tenants: HostTenant[]) => Promise<void>;
  presentCredentials: (credentials: HostCredential[]) => Promise<void>;
  tenantForUid: (uid: number) => Promise<HostTenant>;
  /** Read-only status reads. A missing, stale or malformed tenant report gives null, never an error. */
  readState: () => Promise<HostUpdateState | null>;
  readTenantStatus: (uid: number) => Promise<HostTenantStatus | null>;
  verifyState: () => Promise<void>;
  verifyDaemon: () => Promise<void>;
  verifyIsolation: (tenants: HostTenant[]) => Promise<void>;
}

export function validateHostNames(names: string[]): void {
  if (
    !names.length ||
    names.length > 100 ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-z][a-z0-9_-]{0,30}$/.test(name) || name.includes("\n"))
  ) {
    throw new Error(
      "Use distinct lowercase tenant names of 1–31 letters, digits, hyphens or underscores, starting with a letter.",
    );
  }
}

export function parseHostSetup(args: string[]): HostSetupRequest {
  const result: HostSetupRequest = { createUsers: [], tenants: [], dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--dry-run" && !result.dryRun) {
      result.dryRun = true;
      continue;
    }
    const name = args[++index];
    if (!name || (flag !== "--create-user" && flag !== "--tenant")) throw new Error("Invalid setup arguments.");
    (flag === "--create-user" ? result.createUsers : result.tenants).push(name);
  }
  validateHostNames([...result.createUsers, ...result.tenants]);
  return result;
}

export async function setupHost(request: HostSetupRequest, ops: HostAdminOperations): Promise<void> {
  validateHostNames([...request.createUsers, ...request.tenants]);
  await ops.verifyInstallation();
  if (await ops.readConfig())
    throw new Error("Host is already registered. Setup never overwrites existing registration.");
  await ops.checkNewUsers(request.createUsers);
  const existing = await Promise.all(request.tenants.map((name) => ops.inspectTenant(name)));
  if (new Set(existing.map((tenant) => tenant.uid)).size !== existing.length) throw new Error("Duplicate tenant UID.");
  if (request.dryRun) {
    await ops.verifyApplication();
    return;
  }
  await ops.prepareApplication();
  const credentials = request.createUsers.length ? await ops.createUsers(request.createUsers) : [];
  const tenants = [...existing, ...(await Promise.all(credentials.map((item) => ops.inspectTenant(item.name))))];
  if (new Set(tenants.map((tenant) => tenant.uid)).size !== tenants.length) throw new Error("Duplicate tenant UID.");
  await ops.register(tenants.map((tenant) => tenant.uid));
  await ops.startJobs(tenants);
  // The only password presentation occurs after registration and launchd setup succeed.
  await ops.presentCredentials(credentials);
}

export interface HostVerification {
  label: string;
  ok: boolean;
}
export async function verifyHost(ops: HostAdminOperations): Promise<HostVerification[]> {
  const results: HostVerification[] = [];
  const check = async (label: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      results.push({ label, ok: true });
      return true;
    } catch {
      results.push({ label, ok: false });
      return false;
    }
  };
  await check("OpenBot.app signature, ownership and permissions", ops.verifyApplication);
  await check("Host executables, signatures and launchd definitions", ops.verifyInstallation);
  await check("LaunchDaemon loaded and running", ops.verifyDaemon);
  const registered: number[] = [];
  const configOk = await check("Host config secure and enabled", async () => {
    const config = await ops.readConfig();
    if (!config?.managed) throw new Error("Host not enabled.");
    registered.push(...config.tenants);
  });
  await check("Host state secure", ops.verifyState);
  const tenants: HostTenant[] = [];
  if (configOk) {
    for (const uid of registered) {
      await check(`Tenant UID ${uid}: Standard account and private home`, async () => {
        const tenant = await ops.tenantForUid(uid);
        tenants.push(await ops.inspectTenant(tenant.name));
      });
    }
    if (tenants.length === registered.length) {
      await check("Cross-tenant read/write isolation in both directions", () => ops.verifyIsolation(tenants));
    }
  }
  return results;
}

export interface HostTenantReport {
  uid: number;
  name: string | null;
  /** A fresh status report. A logged-out, quit or stale tenant is not running for the host. */
  running: boolean;
  pid: number | null;
  version: string | null;
  healthy: boolean;
  heartbeatAgeMs: number | null;
  idleForMs: number | null;
  /** Earliest remaining idle grace. The host measures its own observation, so the real wait is longer. */
  readyInMs: number | null;
  blocker: string | null;
}

export interface HostStatusReport {
  managed: boolean;
  daemonRunning: boolean;
  phase: HostUpdateState["phase"] | null;
  cycle: string;
  pendingVersion: string | null;
  error: string | null;
  stateAgeMs: number | null;
  /** Only `waiting` and `stopping` rewrite state on every poll, so only they prove daemon progress. */
  stateStale: boolean;
  summary: string;
  tenants: HostTenantReport[];
}

export interface HostStatusInput {
  config: HostManagerConfig | null;
  state: HostUpdateState | null;
  daemonRunning: boolean;
  tenants: Array<{ uid: number; name: string | null; status: HostTenantStatus | null }>;
  now: number;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function describeTenant(
  entry: HostStatusInput["tenants"][number],
  state: HostUpdateState | null,
  now: number,
): HostTenantReport {
  const { status } = entry;
  const base = { uid: entry.uid, name: entry.name, running: false, pid: null, version: null, healthy: false };
  if (!status) {
    return { ...base, heartbeatAgeMs: null, idleForMs: null, readyInMs: null, blocker: "no status report" };
  }
  const heartbeatAgeMs = now - status.heartbeatAt;
  const idleForMs = status.idleSince === null ? null : Math.max(0, now - status.idleSince);
  const fresh = heartbeatAgeMs >= 0 && heartbeatAgeMs <= HOST_HEARTBEAT_TIMEOUT_MS;
  const report = {
    uid: entry.uid,
    name: entry.name,
    running: fresh,
    pid: status.pid,
    version: status.currentVersion,
    healthy: status.healthy,
    heartbeatAgeMs,
    idleForMs,
  };
  const waiting = state?.phase === "waiting";
  const blocker = !fresh
    ? "stale status report"
    : !status.safeToRestart
      ? "not safe to restart"
      : idleForMs === null
        ? "working"
        : // A cycle mismatch only blocks maintenance while the host waits for this cycle.
          waiting && status.cycle !== state.cycle
          ? "has not acknowledged this update cycle"
          : null;
  const readyInMs =
    waiting && idleForMs !== null && blocker === null ? Math.max(0, HOST_IDLE_GRACE_MS - idleForMs) : null;
  // A tenant inside the idle grace is not a blocker. Its remaining countdown carries that meaning.
  return { ...report, readyInMs, blocker };
}

function summarize(report: Omit<HostStatusReport, "summary">): string {
  const blocked = report.tenants.filter((tenant) => tenant.blocker !== null);
  const names = blocked.map((tenant) => `${tenant.name ?? tenant.uid} (${tenant.blocker})`).join(", ");
  if (!report.managed) return "Host management is off. Tenants keep their own desktop update controls.";
  if (!report.daemonRunning) return "Host management is on, but the LaunchDaemon is not running. No update can run.";
  switch (report.phase) {
    case null:
      return "No host state yet. The daemon writes state at its first poll.";
    case "idle":
      return "No update is staged. The host checks the release source at most every four minutes.";
    case "downloading":
      return "Checking the release source, or downloading and staging a new release.";
    case "waiting": {
      const soonest = report.tenants.reduce<number | null>(
        (longest, tenant) => (tenant.readyInMs === null ? longest : Math.max(longest ?? 0, tenant.readyInMs)),
        null,
      );
      const version = report.pendingVersion ?? "a staged release";
      if (blocked.length) return `Update ${version} is staged and waits for ${blocked.length} tenant: ${names}.`;
      return soonest === null
        ? `Update ${version} is staged. All tenants are idle; shutdown starts at the next poll.`
        : `Update ${version} is staged. Shutdown starts in ${formatDuration(soonest)} at the earliest.`;
    }
    case "stopping":
      return "Every tenant was idle. OpenBot is quitting; installation starts when all processes have exited.";
    case "installing":
      return `Replacing OpenBot.app with ${report.pendingVersion ?? "the staged release"}. Do not interrupt.`;
    case "released":
      return `Version ${report.pendingVersion ?? "unknown"} is installed. Waiting for tenant health reports${
        blocked.length ? `: ${names}` : "."
      }`;
    case "aborted":
      return `Maintenance stopped before replacement. The installed application is unchanged. ${report.error ?? ""}`.trim();
    case "failed":
      return `Maintenance failed and needs an administrator. ${report.error ?? ""}`.trim();
  }
}

export function describeHostStatus(input: HostStatusInput): HostStatusReport {
  const { config, state, now } = input;
  const tenants = input.tenants.map((entry) => describeTenant(entry, state, now));
  const stateAgeMs = state ? now - state.updatedAt : null;
  const partial = {
    managed: config?.managed === true,
    daemonRunning: input.daemonRunning,
    phase: state?.phase ?? null,
    cycle: state?.cycle ?? "",
    pendingVersion: state?.version ?? null,
    error: state?.error ?? null,
    stateAgeMs,
    stateStale:
      (state?.phase === "waiting" || state?.phase === "stopping") &&
      stateAgeMs !== null &&
      stateAgeMs > HOST_HEARTBEAT_TIMEOUT_MS,
    tenants,
  };
  return { ...partial, summary: summarize(partial) };
}

export function formatHostStatus(report: HostStatusReport): string {
  const lines = [
    `Management  ${report.managed ? "on" : "off"}    Daemon ${report.daemonRunning ? "running" : "not running"}`,
    `Phase       ${report.phase ?? "unknown"}${report.stateStale ? "  (state is stale; the daemon is not polling)" : ""}`,
    `Update      ${report.pendingVersion ?? "none staged"}${report.cycle ? `    cycle ${report.cycle.slice(0, 8)}` : ""}`,
  ];
  if (report.stateAgeMs !== null) lines.push(`State age   ${formatDuration(report.stateAgeMs)}`);
  if (report.error) lines.push(`Error       ${report.error}`);
  lines.push("", report.summary, "", "Tenants");
  for (const tenant of report.tenants) {
    const label = `${tenant.name ?? "unknown"} (${tenant.uid})`.padEnd(24);
    const activity = !tenant.running
      ? "not running"
      : `${(tenant.healthy ? "healthy" : "unhealthy").padEnd(10)} ${
          tenant.idleForMs === null ? "working" : `idle ${formatDuration(tenant.idleForMs)}`
        }`;
    const ready = tenant.readyInMs === null ? "" : `  ready in ~${formatDuration(tenant.readyInMs)}`;
    // "working" and a missing report already appear in the activity column.
    const blocker =
      tenant.running && tenant.blocker && tenant.blocker !== "working" ? `  blocks: ${tenant.blocker}` : "";
    lines.push(`  ${label} ${(tenant.version ?? "-").padEnd(9)} ${activity}${ready}${blocker}`);
  }
  if (report.phase === "waiting") lines.push("", "Countdowns are the earliest possible time, not a promise.");
  return `${lines.join("\n")}\n`;
}

export async function collectHostStatus(ops: HostAdminOperations, now = Date.now()): Promise<HostStatusReport> {
  const config = await ops.readConfig();
  const [state, daemonRunning, tenants] = await Promise.all([
    ops.readState(),
    ops.verifyDaemon().then(
      () => true,
      () => false,
    ),
    Promise.all(
      (config?.tenants ?? []).map(async (uid) => ({
        uid,
        name: await ops.tenantForUid(uid).then(
          (tenant) => tenant.name,
          () => null,
        ),
        status: await ops.readTenantStatus(uid),
      })),
    ),
  ]);
  return describeHostStatus({ config, state, daemonRunning, tenants, now });
}

export function parseHostWatch(args: string[]): number {
  if (!args.length) return 5_000;
  const seconds = args.length === 2 && args[0] === "--interval" ? Number(args[1]) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error("Use --interval 1–60 seconds.");
  return seconds * 1_000;
}
