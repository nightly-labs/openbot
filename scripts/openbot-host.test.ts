import { describe, expect, it, vi } from "vitest";
import { validateTenantMetadata } from "./openbot-host-macos";
import {
  collectHostStatus,
  describeHostStatus,
  formatHostStatus,
  type HostAdminOperations,
  type HostStatusInput,
  parseHostSetup,
  parseHostWatch,
  setupHost,
  verifyHost,
} from "./openbot-host-service";

function fixture() {
  const events: string[] = [];
  const ops: HostAdminOperations = {
    verifyInstallation: vi.fn(async () => undefined),
    verifyApplication: vi.fn(async () => undefined),
    prepareApplication: vi.fn(async () => {
      events.push("prepare");
    }),
    readConfig: vi.fn(async () => null),
    checkNewUsers: vi.fn(async () => undefined),
    inspectTenant: vi.fn(async (name: string) => ({ name, uid: name === "client-acme" ? 501 : 502 })),
    createUsers: vi.fn(async (names: string[]) => {
      events.push("create");
      return names.map((name) => ({
        name,
        uid: name === "client-acme" ? 501 : 502,
        password: "generated-password-only-for-test",
      }));
    }),
    register: vi.fn(async () => {
      events.push("register");
    }),
    startJobs: vi.fn(async () => {
      events.push("launchd");
    }),
    presentCredentials: vi.fn(async () => {
      events.push("passwords");
    }),
    tenantForUid: vi.fn(async (uid) => ({ uid, name: uid === 501 ? "client-acme" : "client-bravo" })),
    verifyState: vi.fn(async () => undefined),
    verifyDaemon: vi.fn(async () => undefined),
    verifyIsolation: vi.fn(async () => undefined),
    readState: vi.fn(async () => null),
    readTenantStatus: vi.fn(async () => null),
    bundleProcesses: vi.fn(async () => []),
  };
  return { ops, events };
}

describe("installed host setup", () => {
  it("accepts Standard private homes and rejects admin, mode, owner, symlink and ACL violations", () => {
    const safe = {
      name: "client-acme",
      uid: 501,
      groups: "20 12",
      homeAttribute: "NFSHomeDirectory: /Users/client-acme",
      owner: 501,
      mode: 0o40700,
      directory: true,
      acl: "",
    };
    expect(validateTenantMetadata(safe)).toEqual({ name: "client-acme", uid: 501 });
    for (const change of [
      { groups: "20 80" },
      { mode: 0o40755 },
      { owner: 502 },
      { directory: false },
      { acl: " 0: group:everyone allow read" },
      { homeAttribute: "NFSHomeDirectory: /Users/other" },
    ]) {
      expect(() => validateTenantMetadata({ ...safe, ...change })).toThrow();
    }
  });
  it("registers existing and newly created accounts, then shows credentials once", async () => {
    const f = fixture();
    await setupHost(parseHostSetup(["--tenant", "client-acme", "--create-user", "client-bravo"]), f.ops);
    expect(f.ops.register).toHaveBeenCalledWith([501, 502]);
    expect(f.events).toEqual(["prepare", "create", "register", "launchd", "passwords"]);
    expect(f.ops.presentCredentials).toHaveBeenCalledOnce();
  });

  it.each([
    { args: ["--tenant", "client-acme", "--create-user", "client-acme"] },
    { args: ["--create-user", "../escape"] },
    { args: ["--tenant", "acme\n"] },
    { args: ["--admin", "acme"] },
    { args: [] },
  ])("rejects invalid or duplicate setup input $args", ({ args }) => {
    expect(() => parseHostSetup(args)).toThrow();
  });

  it("checks a dry run without modifying accounts, application or launchd", async () => {
    const f = fixture();
    await setupHost(parseHostSetup(["--dry-run", "--create-user", "client-acme"]), f.ops);
    expect(f.events).toEqual([]);
    expect(f.ops.verifyApplication).toHaveBeenCalledOnce();
  });

  it("does not reset registered tenants", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501] });
    await expect(setupHost(parseHostSetup(["--tenant", "client-acme"]), f.ops)).rejects.toThrow("already registered");
    expect(f.events).toEqual([]);
  });

  it.each(["admin account", "unsafe home mode", "unsafe home ACL"])(
    "rejects %s before account creation",
    async (reason) => {
      const f = fixture();
      f.ops.inspectTenant = async () => {
        throw new Error(reason);
      };
      await expect(
        setupHost(parseHostSetup(["--tenant", "client-acme", "--create-user", "client-bravo"]), f.ops),
      ).rejects.toThrow(reason);
      expect(f.ops.createUsers).not.toHaveBeenCalled();
      expect(f.ops.register).not.toHaveBeenCalled();
    },
  );

  it("refuses an unsafe shared app before creating users", async () => {
    const f = fixture();
    f.ops.prepareApplication = async () => {
      throw new Error("unsafe app");
    };
    await expect(setupHost(parseHostSetup(["--create-user", "client-acme"]), f.ops)).rejects.toThrow("unsafe app");
    expect(f.ops.createUsers).not.toHaveBeenCalled();
  });

  it("does not claim completion or print passwords after failed registration", async () => {
    const f = fixture();
    f.ops.register = async () => {
      throw new Error("write failure");
    };
    await expect(setupHost(parseHostSetup(["--create-user", "client-acme"]), f.ops)).rejects.toThrow("write failure");
    expect(f.ops.startJobs).not.toHaveBeenCalled();
    expect(f.ops.presentCredentials).not.toHaveBeenCalled();
  });
});

describe("installed host verification", () => {
  it("reports a healthy configuration and checks both registered tenants", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501, 502] });
    const results = await verifyHost(f.ops);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(f.ops.verifyIsolation).toHaveBeenCalledWith([
      { name: "client-acme", uid: 501 },
      { name: "client-bravo", uid: 502 },
    ]);
  });

  it.each([
    "verifyApplication",
    "verifyInstallation",
    "inspectTenant",
    "verifyState",
    "verifyDaemon",
    "verifyIsolation",
  ] as const)("reports %s failure without exposing error details", async (operation) => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501, 502] });
    f.ops[operation] = async () => {
      throw new Error("password=secret provider data");
    };
    const results = await verifyHost(f.ops);
    expect(results.some((result) => !result.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("secret");
  });
});

const NOW = 1_700_000_000_000;

function statusInput(overrides: Partial<HostStatusInput> = {}): HostStatusInput {
  return {
    config: { managed: true, tenants: [501, 502] },
    state: { phase: "waiting", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW - 2_000, error: null },
    daemonRunning: true,
    processes: [
      { uid: 501, pid: 11, main: true },
      { uid: 502, pid: 12, main: true },
    ],
    now: NOW,
    tenants: [
      {
        uid: 501,
        name: "client-acme",
        status: {
          uid: 501,
          pid: 11,
          currentVersion: "0.17.0",
          heartbeatAt: NOW - 2_000,
          safeToRestart: true,
          idleSince: NOW - 120_000,
          cycle: "cycle-one",
          healthy: true,
        },
      },
      {
        uid: 502,
        name: "client-bravo",
        status: {
          uid: 502,
          pid: 12,
          currentVersion: "0.17.0",
          heartbeatAt: NOW - 1_000,
          safeToRestart: true,
          idleSince: null,
          cycle: "cycle-one",
          healthy: true,
        },
      },
    ],
    ...overrides,
  };
}

describe("host status reporting", () => {
  it("names the working tenant that blocks a staged update", () => {
    const report = describeHostStatus(statusInput());
    expect(report.pendingVersion).toBe("0.18.0");
    expect(report.tenants[1]?.blocker).toBe("working");
    expect(report.tenants[1]?.readyInMs).toBeNull();
    expect(report.summary).toContain("client-bravo (working)");
  });

  it("gives the earliest remaining idle grace when every tenant is idle", () => {
    const input = statusInput();
    const bravo = input.tenants[1];
    if (bravo?.status) bravo.status = { ...bravo.status, idleSince: NOW - 60_000 };
    const report = describeHostStatus(input);
    expect(report.tenants[0]?.readyInMs).toBe(180_000);
    expect(report.tenants[1]?.readyInMs).toBe(240_000);
    expect(report.summary).toContain("4m00s at the earliest");
  });

  it("blocks on a stale report, an unacknowledged cycle and a missing tenant", () => {
    const input = statusInput();
    const acme = input.tenants[0];
    if (acme?.status) acme.status = { ...acme.status, heartbeatAt: NOW - 60_000 };
    const bravo = input.tenants[1];
    if (bravo?.status) bravo.status = { ...bravo.status, idleSince: NOW - 600_000, cycle: "cycle-old" };
    const report = describeHostStatus({
      ...input,
      tenants: [...input.tenants, { uid: 503, name: null, status: null }],
    });
    expect(report.tenants.map((tenant) => tenant.blocker)).toEqual([
      "stale status report",
      "has not acknowledged this update cycle",
      "no status report",
    ]);
  });

  it("does not promise a countdown when the process list disagrees with the report", () => {
    const report = describeHostStatus({ ...statusInput(), processes: [{ uid: 501, pid: 99, main: true }] });
    expect(report.tenants[0]?.reporting).toBe(true);
    expect(report.tenants[0]?.readyInMs).toBeNull();
    expect(report.tenants[0]?.blocker).toBe("reported PID is not in the process list");
  });

  it("reports an unregistered OpenBot process that stops the host from starting maintenance", () => {
    const input = statusInput();
    const report = describeHostStatus({ ...input, processes: [...input.processes, { uid: 700, pid: 70, main: true }] });
    expect(report.unregisteredProcesses).toEqual([700]);
    expect(report.summary).toContain("unregistered UID 700");
  });

  it("keeps the phase summary when an unregistered process cannot block that phase", () => {
    const input = statusInput();
    const processes = [...input.processes, { uid: 700, pid: 70, main: true }];
    const installing = describeHostStatus({
      ...input,
      processes,
      state: { phase: "installing", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null },
    });
    expect(installing.unregisteredProcesses).toEqual([700]);
    expect(installing.summary).toContain("Do not interrupt");
    const failed = describeHostStatus({
      ...input,
      processes,
      state: { phase: "failed", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: "Disk is full." },
    });
    expect(failed.summary).toContain("Disk is full.");
  });

  it("reports a stalled daemon instead of a shutdown countdown", () => {
    const input = statusInput();
    const report = describeHostStatus({
      ...input,
      state: { phase: "waiting", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW - 90_000, error: null },
    });
    expect(report.stateStale).toBe(true);
    expect(report.tenants[0]?.readyInMs).toBeNull();
    expect(report.summary).toContain("The daemon is not polling");
    expect(report.summary).not.toContain("Shutdown starts");
    expect(formatHostStatus(report)).not.toContain("earliest possible time");
  });

  it("uses health, version and cycle as the blockers after release", () => {
    const input = statusInput();
    const state = { phase: "released", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const acme = input.tenants[0];
    if (acme?.status) acme.status = { ...acme.status, idleSince: null, currentVersion: "0.18.0", healthy: true };
    const bravo = input.tenants[1];
    if (bravo?.status) bravo.status = { ...bravo.status, currentVersion: "0.17.0", healthy: true };
    const report = describeHostStatus({ ...input, state });
    expect(report.tenants[0]?.blocker).toBeNull();
    expect(report.tenants[1]?.blocker).toBe("still runs 0.17.0");
  });

  it("reports a tenant that still runs while the host waits for shutdown", () => {
    const state = { phase: "stopping", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const report = describeHostStatus({ ...statusInput(), state, processes: [{ uid: 502, pid: 12, main: false }] });
    expect(report.tenants[0]?.blocker).toBeNull();
    expect(report.tenants[1]?.blocker).toBe("still running");
  });

  it("reports a running tenant that publishes no status", () => {
    const report = describeHostStatus({
      ...statusInput(),
      tenants: [{ uid: 501, name: "client-acme", status: null }],
    });
    expect(report.tenants[0]?.blocker).toBe("runs without a status report");
  });

  it("does not present a finished release as a staged update", () => {
    const state = { phase: "idle", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const report = describeHostStatus({ ...statusInput(), state });
    expect(report.pendingVersion).toBeNull();
    expect(report.stateVersion).toBe("0.18.0");
    const text = formatHostStatus(report);
    expect(text).toContain("none staged");
    expect(text).not.toContain("0.18.0 staged");
  });

  it("names the installed version after release and the staged version while waiting", () => {
    const released = { phase: "released", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    expect(formatHostStatus(describeHostStatus({ ...statusInput(), state: released }))).toContain("0.18.0 installed");
    expect(formatHostStatus(describeHostStatus(statusInput()))).toContain("0.18.0 staged");
  });

  it("counts every remaining bundle process while the host waits for shutdown", () => {
    const state = { phase: "stopping", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const report = describeHostStatus({
      ...statusInput(),
      state,
      processes: [{ uid: 501, pid: 44, main: false }],
    });
    expect(report.remainingProcesses).toBe(1);
    expect(report.summary).toContain("1 remaining bundle processes");
  });

  it("keeps tenant status out of the stopping phase, as the host does", () => {
    const state = { phase: "stopping", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const input = statusInput();
    const acme = input.tenants[0];
    if (acme?.status) acme.status = { ...acme.status, heartbeatAt: NOW - 600_000 };
    const report = describeHostStatus({ ...input, state, processes: [] });
    expect(report.remainingProcesses).toBe(0);
    expect(report.tenants.map((tenant) => tenant.blocker)).toEqual([null, null]);
  });

  it("gives no countdown for an idle time in the future", () => {
    const input = statusInput();
    const acme = input.tenants[0];
    if (acme?.status) acme.status = { ...acme.status, idleSince: NOW + 60_000 };
    const report = describeHostStatus(input);
    expect(report.tenants[0]?.readyInMs).toBeNull();
    expect(report.tenants[0]?.blocker).toBe("idle time is in the future");
  });

  it("fails the status reading instead of reporting an empty process list", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501] });
    f.ops.bundleProcesses = async () => {
      throw new Error("Process scan returned no processes.");
    };
    await expect(collectHostStatus(f.ops, NOW)).rejects.toThrow();
  });

  it("shows a helper process that keeps the host in the stopping phase", () => {
    const state = { phase: "stopping", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null } as const;
    const report = describeHostStatus({
      ...statusInput(),
      state,
      tenants: [{ uid: 501, name: "client-acme", status: null }],
      processes: [{ uid: 501, pid: 44, main: false }],
    });
    expect(report.tenants[0]?.processRunning).toBe(true);
    const text = formatHostStatus(report);
    expect(text).toContain("runs without a fresh report");
    expect(text).toContain("blocks: still running");
    expect(text).not.toContain("not running");
  });

  it("calls a stale report stale, even when its PID matches the process list", () => {
    const input = statusInput();
    const acme = input.tenants[0];
    if (acme?.status) acme.status = { ...acme.status, heartbeatAt: NOW - 600_000 };
    const report = describeHostStatus(input);
    expect(report.tenants[0]?.reporting).toBe(false);
    expect(report.tenants[0]?.processRunning).toBe(true);
    const text = formatHostStatus(report);
    expect(text).toContain("blocks: stale status report");
    expect(text).not.toContain("process list disagree");
  });

  it("reads the clock after the files, not before them", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501] });
    f.ops.readState = async () => ({ phase: "idle", cycle: "", version: null, updatedAt: 1_000, error: null });
    let clock = 1_000;
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    // A reading that takes time, as the process scan and the account lookups do.
    f.ops.bundleProcesses = async () => {
      clock = 3_000;
      return [];
    };
    try {
      const report = await collectHostStatus(f.ops);
      expect(report.stateAgeMs).toBe(2_000);
    } finally {
      clockSpy.mockRestore();
    }
  });

  it("reports a stopped daemon and an unmanaged host before any update text", () => {
    expect(describeHostStatus({ ...statusInput(), daemonRunning: false }).summary).toContain("LaunchDaemon is not");
    const unmanaged = describeHostStatus({
      ...statusInput(),
      config: { managed: false, tenants: [501] },
    });
    expect(unmanaged.managed).toBe(false);
    expect(unmanaged.summary).toContain("management is off");
  });

  it("marks a state file that stopped advancing during maintenance", () => {
    const fresh = describeHostStatus(statusInput());
    expect(fresh.stateStale).toBe(false);
    const stalled = describeHostStatus({
      ...statusInput(),
      state: { phase: "waiting", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW - 120_000, error: null },
    });
    expect(stalled.stateStale).toBe(true);
  });

  it("reports a failure and keeps the recorded error", () => {
    const report = describeHostStatus({
      ...statusInput(),
      state: { phase: "failed", cycle: "cycle-one", version: null, updatedAt: NOW, error: "Interrupted maintenance." },
    });
    expect(report.error).toBe("Interrupted maintenance.");
    expect(report.summary).toContain("Interrupted maintenance.");
  });

  it("prints tenant names, versions and the earliest-time warning", () => {
    const text = formatHostStatus(describeHostStatus(statusInput()));
    expect(text).toContain("client-acme (501)");
    expect(text).toContain("0.17.0");
    expect(text).toContain("earliest possible time");
  });

  it("collects status without failing on an unreadable tenant or a stopped daemon", async () => {
    const f = fixture();
    f.ops.readConfig = async () => ({ managed: true, tenants: [501] });
    f.ops.verifyDaemon = async () => {
      throw new Error("not running");
    };
    f.ops.tenantForUid = async () => {
      throw new Error("no such user");
    };
    const report = await collectHostStatus(f.ops, NOW);
    expect(report.daemonRunning).toBe(false);
    // No host state means no phase reads tenant status, so a missing report blocks nothing.
    expect(report.tenants).toEqual([
      expect.objectContaining({ uid: 501, name: null, reporting: false, blocker: null }),
    ]);
    f.ops.readState = async () => ({ phase: "waiting", cycle: "c", version: "0.18.0", updatedAt: NOW, error: null });
    const waiting = await collectHostStatus(f.ops, NOW);
    expect(waiting.tenants[0]?.blocker).toBe("no status report");
  });

  it("names no blocker in a phase whose rules never read tenant status", () => {
    const input = statusInput();
    const idle = describeHostStatus({
      ...input,
      processes: [],
      tenants: input.tenants.map((tenant) => ({ ...tenant, status: null })),
      state: { phase: "idle", cycle: "", version: null, updatedAt: NOW, error: null },
    });
    expect(idle.tenants.map((tenant) => tenant.blocker)).toEqual([null, null]);
    expect(idle.summary).toContain("No update is staged");
  });

  it("does not call a live daemon stalled while an unregistered process holds the idle map", () => {
    const input = statusInput();
    const report = describeHostStatus({
      ...input,
      processes: [...input.processes, { uid: 700, pid: 70, main: true }],
      state: { phase: "waiting", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW - 90_000, error: null },
    });
    // The host stops publishing in this condition, so an old state proves nothing about the daemon.
    expect(report.stateStale).toBe(false);
    expect(report.summary).toContain("unregistered UID 700");
    expect(report.tenants.map((tenant) => tenant.readyInMs)).toEqual([null, null]);
  });

  it("keeps an old state quiet when management is off", () => {
    const input = statusInput();
    const report = describeHostStatus({
      ...input,
      config: { managed: false, tenants: [501, 502] },
      state: { phase: "waiting", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW - 90_000, error: null },
    });
    // The host stops publishing with the update, so the old state says nothing about the daemon.
    expect(report.stateStale).toBe(false);
    expect(report.tenants.map((tenant) => tenant.readyInMs)).toEqual([null, null]);
    expect(report.tenants.map((tenant) => tenant.blocker)).toEqual([null, null]);
    const text = formatHostStatus(report);
    expect(text).not.toContain("not polling");
    expect(text).not.toContain("blocks:");
    expect(text).toContain("Host management is off");
  });

  it("identifies an unregistered helper that holds the bundle during stopping", () => {
    const input = statusInput();
    const report = describeHostStatus({
      ...input,
      processes: [{ uid: 700, pid: 71, main: false }],
      state: { phase: "stopping", cycle: "cycle-one", version: "0.18.0", updatedAt: NOW, error: null },
    });
    expect(report.unregisteredProcesses).toEqual([700]);
    // A helper alone never clears the host's idle map, so it is not the waiting summary.
    expect(report.unregisteredMain).toEqual([]);
    expect(formatHostStatus(report)).toContain("Unregistered OpenBot processes under UID 700");
  });

  it.each<{ args: string[]; ms: number }>([
    { args: [], ms: 5_000 },
    { args: ["--interval", "30"], ms: 30_000 },
  ])("accepts watch interval $args", ({ args, ms }) => {
    expect(parseHostWatch(args)).toBe(ms);
  });

  it.each([["--interval", "0"], ["--interval", "61"], ["--interval"], ["--json"], ["--interval", "5", "extra"]])(
    "rejects invalid watch interval %s",
    (...args: string[]) => {
      expect(() => parseHostWatch(args)).toThrow();
    },
  );
});
