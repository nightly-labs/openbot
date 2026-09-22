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
  /** Every process inside the shared bundle, as the daemon reads it: main processes and helpers. */
  bundleProcesses: () => Promise<Array<{ uid: number; pid: number; main: boolean }>>;
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
  /** A fresh status report. Kept apart from the process list, which is a separate observation. */
  reporting: boolean;
  /** Any process inside the shared bundle under this UID, main process or helper. */
  processRunning: boolean;
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
  /** Registered version field of the host state. Its meaning depends on the phase. */
  stateVersion: string | null;
  /** Every UID outside the registered set with a bundle process. A helper alone still blocks `stopping`. */
  unregisteredProcesses: number[];
  /** Unregistered main processes. Only these clear the host's idle map while it waits. */
  unregisteredMain: number[];
  /** Bundle processes that still keep the host from replacing the application. */
  remainingProcesses: number;
  summary: string;
  tenants: HostTenantReport[];
}

export interface HostStatusInput {
  config: HostManagerConfig | null;
  state: HostUpdateState | null;
  daemonRunning: boolean;
  tenants: Array<{ uid: number; name: string | null; status: HostTenantStatus | null }>;
  processes: Array<{ uid: number; pid: number; main: boolean }>;
  now: number;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function waitingBlocker(
  status: HostTenantStatus,
  state: HostUpdateState,
  processMatch: boolean,
  now: number,
): string | null {
  // Mirrors HostManager.#waitForIdle, including its rejection of an idle time in the future.
  if (!status.safeToRestart) return "not safe to restart";
  if (status.idleSince === null) return "working";
  if (status.idleSince > now) return "idle time is in the future";
  if (status.cycle !== state.cycle) return "has not acknowledged this update cycle";
  return processMatch ? null : "reported PID is not in the process list";
}

function releasedBlocker(status: HostTenantStatus, state: HostUpdateState): string | null {
  // Mirrors HostManager.#checkHealth: a fresh report with health, the installed version and the cycle.
  if (!status.healthy) return "not healthy after restart";
  if (status.currentVersion !== state.version) return `still runs ${status.currentVersion}`;
  return status.cycle === state.cycle ? null : "has not acknowledged this update cycle";
}

function describeTenant(
  entry: HostStatusInput["tenants"][number],
  state: HostUpdateState | null,
  processes: HostStatusInput["processes"],
  now: number,
  suppressCountdown: boolean,
): HostTenantReport {
  const { status } = entry;
  // Waiting mirrors the host's main-process check; stopping waits for every bundle process to exit.
  const matching = processes.filter((process) => process.uid === entry.uid && process.main);
  const anyProcess = processes.some((process) => process.uid === entry.uid);
  // HostManager.#waitForExit reads the process list only, so tenant status cannot block this phase.
  const stopping = state?.phase === "stopping";
  const base = {
    uid: entry.uid,
    name: entry.name,
    reporting: false,
    processRunning: anyProcess,
    pid: null,
    version: null,
    healthy: false,
  };
  const empty = { ...base, heartbeatAgeMs: null, idleForMs: null, readyInMs: null };
  // Only these phases read tenant status. In any other phase a missing or stale report blocks nothing,
  // so the activity columns still show it, but it is never named as a blocker.
  const usesStatus = state?.phase === "waiting" || state?.phase === "released";
  if (stopping && !status) return { ...empty, blocker: anyProcess ? "still running" : null };
  if (!status) {
    if (!usesStatus) return { ...empty, blocker: null };
    return { ...empty, blocker: anyProcess ? "runs without a status report" : "no status report" };
  }
  const heartbeatAgeMs = now - status.heartbeatAt;
  const fresh = heartbeatAgeMs >= 0 && heartbeatAgeMs <= HOST_HEARTBEAT_TIMEOUT_MS;
  const idleForMs = status.idleSince === null ? null : Math.max(0, now - status.idleSince);
  // The host accepts exactly one registered process whose PID matches the reported one.
  const processMatch = matching.length === 1 && matching[0]?.pid === status.pid;
  const report = {
    uid: entry.uid,
    name: entry.name,
    reporting: fresh,
    processRunning: anyProcess,
    pid: status.pid,
    version: status.currentVersion,
    healthy: status.healthy,
    heartbeatAgeMs,
    idleForMs,
  };
  if (stopping) return { ...report, readyInMs: null, blocker: anyProcess ? "still running" : null };
  const blocker = !usesStatus
    ? null
    : !fresh
      ? "stale status report"
      : state?.phase === "released"
        ? releasedBlocker(status, state)
        : waitingBlocker(status, state, processMatch, now);
  // A stalled daemon honours no countdown, and an unregistered process empties the host's idle map.
  const readyInMs =
    !suppressCountdown && state?.phase === "waiting" && idleForMs !== null && blocker === null
      ? Math.max(0, HOST_IDLE_GRACE_MS - idleForMs)
      : null;
  return { ...report, readyInMs, blocker };
}

function summarize(report: Omit<HostStatusReport, "summary">): string {
  const blocked = report.tenants.filter((tenant) => tenant.blocker !== null);
  const names = blocked.map((tenant) => `${tenant.name ?? tenant.uid} (${tenant.blocker})`).join(", ");
  if (!report.managed) return "Host management is off. Tenants keep their own desktop update controls.";
  if (!report.daemonRunning) return "Host management is on, but the LaunchDaemon is not running. No update can run.";
  if (report.stateStale) {
    return `The host state has not advanced for ${formatDuration(report.stateAgeMs ?? 0)} while ${report.phase}. The daemon is not polling, so neither shutdown nor installation can continue.`;
  }
  // HostManager.#waitForIdle clears the idle map for an unregistered main process. No other phase
  // reads it that way, and this text must not hide an installation warning or a failure reason.
  if (report.unregisteredMain.length && report.phase === "waiting") {
    return `OpenBot runs under unregistered UID ${report.unregisteredMain.join(", ")}. The host cannot start maintenance until it quits.`;
  }
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
      return `Every tenant was idle. OpenBot is quitting; installation starts when all ${report.remainingProcesses} remaining bundle processes have exited.`;
    case "installing":
      return `Replacing OpenBot.app with ${report.pendingVersion ?? "the staged release"}. Do not interrupt.`;
    case "released":
      return `Version ${report.stateVersion ?? "unknown"} is installed. Waiting for tenant health reports${
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
  const registered = config?.tenants ?? [];
  const stateAgeMs = state ? now - state.updatedAt : null;
  const unregisteredMain = [
    ...new Set(
      input.processes.filter((process) => process.main && !registered.includes(process.uid)).map((p) => p.uid),
    ),
  ];
  // HostManager.#waitForIdle clears its idle map and returns without publishing while an unregistered
  // main process runs. A state that stops advancing then is not proof of a stopped daemon, but the
  // host counts no grace either, so the countdowns still go.
  const waitingOnUnregistered = state?.phase === "waiting" && unregisteredMain.length > 0;
  const stateStale =
    (state?.phase === "waiting" || state?.phase === "stopping") &&
    stateAgeMs !== null &&
    stateAgeMs > HOST_HEARTBEAT_TIMEOUT_MS &&
    !waitingOnUnregistered;
  const tenants = input.tenants.map((entry) =>
    describeTenant(entry, state, input.processes, now, stateStale || waitingOnUnregistered),
  );
  const partial = {
    managed: config?.managed === true,
    daemonRunning: input.daemonRunning,
    phase: state?.phase ?? null,
    cycle: state?.cycle ?? "",
    stateVersion: state?.version ?? null,
    // The host keeps the version field after a finished update, so only these phases have a pending release.
    pendingVersion: state && ["waiting", "stopping", "installing"].includes(state.phase) ? state.version : null,
    error: state?.error ?? null,
    stateAgeMs,
    stateStale,
    unregisteredProcesses: [
      ...new Set(input.processes.filter((process) => !registered.includes(process.uid)).map((p) => p.uid)),
    ],
    unregisteredMain,
    remainingProcesses: input.processes.length,
    tenants,
  };
  return { ...partial, summary: summarize(partial) };
}

export function formatHostStatus(report: HostStatusReport): string {
  const lines = [
    `Management  ${report.managed ? "on" : "off"}    Daemon ${report.daemonRunning ? "running" : "not running"}`,
    `Phase       ${report.phase ?? "unknown"}${report.stateStale ? "  (state is stale; the daemon is not polling)" : ""}`,
    `Update      ${
      report.pendingVersion
        ? `${report.pendingVersion} staged`
        : report.phase === "released" && report.stateVersion
          ? `${report.stateVersion} installed`
          : "none staged"
    }${report.cycle ? `    cycle ${report.cycle.slice(0, 8)}` : ""}`,
  ];
  if (report.stateAgeMs !== null) lines.push(`State age   ${formatDuration(report.stateAgeMs)}`);
  if (report.error) lines.push(`Error       ${report.error}`);
  if (report.unregisteredProcesses.length)
    lines.push(`Unregistered OpenBot processes under UID ${report.unregisteredProcesses.join(", ")}`);
  lines.push("", report.summary, "", "Tenants");
  for (const tenant of report.tenants) {
    const label = `${tenant.name ?? "unknown"} (${tenant.uid})`.padEnd(24);
    // The report and the process list are separate observations. Never present one as the other.
    const activity = !tenant.reporting
      ? tenant.processRunning
        ? "runs without a fresh report"
        : "not running"
      : `${(tenant.healthy ? "healthy" : "unhealthy").padEnd(10)} ${
          tenant.processRunning ? "" : "no process, "
        }${tenant.idleForMs === null ? "working" : `idle ${formatDuration(tenant.idleForMs)}`}`;
    const ready = tenant.readyInMs === null ? "" : `  ready in ~${formatDuration(tenant.readyInMs)}`;
    // "working" already appears in the activity column; every other reason is shown as it is.
    const blocker = tenant.blocker && tenant.blocker !== "working" ? `  blocks: ${tenant.blocker}` : "";
    lines.push(`  ${label} ${(tenant.version ?? "-").padEnd(9)} ${activity}${ready}${blocker}`);
  }
  if (report.phase === "waiting" && !report.stateStale)
    lines.push("", "Countdowns are the earliest possible time, not a promise.");
  return `${lines.join("\n")}\n`;
}

export async function collectHostStatus(ops: HostAdminOperations, now?: number): Promise<HostStatusReport> {
  const config = await ops.readConfig();
  const [state, daemonRunning, processes, tenants] = await Promise.all([
    ops.readState(),
    ops.verifyDaemon().then(
      () => true,
      () => false,
    ),
    // A failed scan must not become an empty process list: the daemon cannot advance without it either.
    ops.bundleProcesses(),
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
  // Read the clock after the files, so a heartbeat written during these reads is not called stale.
  return describeHostStatus({ config, state, daemonRunning, processes, tenants, now: now ?? Date.now() });
}

export function parseHostWatch(args: string[]): number {
  if (!args.length) return 5_000;
  const seconds = args.length === 2 && args[0] === "--interval" ? Number(args[1]) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error("Use --interval 1–60 seconds.");
  return seconds * 1_000;
}
