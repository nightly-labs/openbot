// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import type { RestartReadiness } from "./update-readiness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface FakeTenant {
  coordinator: HostUpdateCoordinator;
  stopCalls: number;
  installCalls: number;
  healthCalls: number;
  setReadiness: (readiness: RestartReadiness) => void;
  setReadyVersion: (version: string | null) => void;
  setHealthy: (healthy: boolean) => void;
  tick: () => Promise<void>;
}

function idle(): RestartReadiness {
  return { safeToRestart: true, reasons: [] };
}

const ownerFieldSchema = z.object({ uid: z.number() }).partial();

async function createDirectory(): Promise<{
  path: string;
  statUid: (name: string) => Promise<number | null>;
  overrides: Map<string, number | null>;
}> {
  const path = await mkdtemp(join(tmpdir(), "openbot-host-update-"));
  directories.push(path);
  const overrides = new Map<string, number | null>();
  return {
    path,
    overrides,
    statUid: async (name: string) => {
      if (overrides.has(name)) return overrides.get(name) ?? null;
      try {
        const parsed = ownerFieldSchema.safeParse(JSON.parse(await readFile(join(path, name), "utf8")));
        return parsed.success && parsed.data.uid !== undefined ? parsed.data.uid : null;
      } catch {
        return null;
      }
    },
  };
}

async function createTenant(
  directory: string,
  statUid: (name: string) => Promise<number | null>,
  uid: number,
  pid: number,
  options: {
    now?: () => number;
    idleGraceMs?: number;
    waitTimeoutMs?: number;
    heartbeatTimeoutMs?: number;
    healthTimeoutMs?: number;
    currentVersion?: string;
  } = {},
): Promise<FakeTenant> {
  let readiness: RestartReadiness = idle();
  let readyVersion: string | null = "0.2.0";
  let stopCalls = 0;
  let installCalls = 0;
  let healthCalls = 0;
  let healthy = true;
  const coordinator = new HostUpdateCoordinator({
    directory,
    uid,
    pid,
    currentVersion: options.currentVersion ?? "0.1.0",
    now: options.now,
    idleGraceMs: options.idleGraceMs ?? 5 * 60 * 1_000,
    heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 60_000,
    waitTimeoutMs: options.waitTimeoutMs,
    healthTimeoutMs: options.healthTimeoutMs,
    describeReadiness: () => readiness,
    getReadyVersion: () => readyVersion,
    checkHealth: async () => {
      healthCalls += 1;
      return healthy ? { ok: true, checks: ["agent-list"] } : { ok: false, checks: ["agent-list-failed"] };
    },
    onShouldStop: () => {
      stopCalls += 1;
    },
    install: async () => {
      installCalls += 1;
    },
    statUid,
  });
  return {
    coordinator,
    get stopCalls() {
      return stopCalls;
    },
    get installCalls() {
      return installCalls;
    },
    get healthCalls() {
      return healthCalls;
    },
    setReadiness: (next: RestartReadiness) => {
      readiness = next;
    },
    setReadyVersion: (version: string | null) => {
      readyVersion = version;
    },
    setHealthy: (next: boolean) => {
      healthy = next;
    },
    tick: () => coordinator.tick(),
  };
}

describe("HostUpdateCoordinator", () => {
  it("claims leadership only when it holds a downloaded update", async () => {
    const { path, statUid } = await createDirectory();
    const lead = await createTenant(path, statUid, 501, 111);
    const plain = await createTenant(path, statUid, 502, 222);
    plain.setReadyVersion(null);

    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "leader.json"), "utf8"))).toMatchObject({ uid: 501, pid: 111 });
    await plain.tick();
    expect(JSON.parse(await readFile(join(path, "leader.json"), "utf8"))).toMatchObject({ uid: 501, pid: 111 });
    await lead.coordinator.stop();
    await plain.coordinator.stop();
  });

  it("waits out the idle grace period before telling tenants to stop", async () => {
    let now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const generousHeartbeat = 3_600_000;
    const lead = await createTenant(path, statUid, 501, 111, {
      now: clock,
      idleGraceMs: 300_000,
      heartbeatTimeoutMs: generousHeartbeat,
    });
    const other = await createTenant(path, statUid, 502, 222, {
      now: clock,
      idleGraceMs: 300_000,
      heartbeatTimeoutMs: generousHeartbeat,
    });

    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({
      state: "waiting",
      version: "0.2.0",
    });
    expect(other.stopCalls).toBe(0);

    now += 299_999;
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "waiting" });

    now += 1;
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "stopping" });
    await other.tick();
    expect(other.stopCalls).toBe(1);
    expect(lead.stopCalls).toBe(0);
    await lead.coordinator.stop();
    await other.coordinator.stop();
  });

  it("restarts a tenant's grace clock when it goes busy", async () => {
    let now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const generousHeartbeat = 3_600_000;
    const lead = await createTenant(path, statUid, 501, 111, {
      now: clock,
      idleGraceMs: 300_000,
      heartbeatTimeoutMs: generousHeartbeat,
    });
    const other = await createTenant(path, statUid, 502, 222, {
      now: clock,
      idleGraceMs: 300_000,
      heartbeatTimeoutMs: generousHeartbeat,
    });

    await lead.tick();
    await other.tick();
    await lead.tick();
    now += 200_000;
    other.setReadiness({ safeToRestart: false, reasons: ["agent-turn"] });
    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "waiting" });

    other.setReadiness(idle());
    now += 200_000;
    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "waiting" });

    now += 300_000;
    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "stopping" });
    await lead.coordinator.stop();
    await other.coordinator.stop();
  });

  it("installs once every tenant stopped and publishes the release", async () => {
    const now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const lead = await createTenant(path, statUid, 501, 111, { now: clock, idleGraceMs: 0 });
    const other = await createTenant(path, statUid, 502, 222, { now: clock, idleGraceMs: 0 });

    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "stopping" });

    await other.coordinator.markStopped("0.2.0");
    await lead.tick();
    expect(lead.installCalls).toBe(1);
    expect(JSON.parse(await readFile(join(path, "release.json"), "utf8"))).toMatchObject({ version: "0.2.0" });
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "done" });
    // A completed install is terminal for this process: later ticks must not replace the
    // bundle again.
    await lead.tick();
    await lead.tick();
    await lead.tick();
    expect(lead.installCalls).toBe(1);
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "done" });
    await lead.coordinator.stop();
    await other.coordinator.stop();
  });

  it("aborts the cycle when tenants never go idle", async () => {
    let now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const lead = await createTenant(path, statUid, 501, 111, {
      now: clock,
      idleGraceMs: 300_000,
      waitTimeoutMs: 600_000,
      heartbeatTimeoutMs: 3_600_000,
    });
    const other = await createTenant(path, statUid, 502, 222, {
      now: clock,
      idleGraceMs: 300_000,
      heartbeatTimeoutMs: 3_600_000,
    });
    other.setReadiness({ safeToRestart: false, reasons: ["agent-turn"] });

    await lead.tick();
    await other.tick();
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "waiting" });
    now += 600_001;
    await lead.tick();
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "aborted" });
    expect(lead.installCalls).toBe(0);
    await lead.coordinator.stop();
    await other.coordinator.stop();
  });

  it("ignores malformed and foreign-owned status files", async () => {
    const now = 1_000_000;
    const { path, statUid, overrides } = await createDirectory();
    const clock = () => now;
    const lead = await createTenant(path, statUid, 501, 111, { now: clock, idleGraceMs: 0 });

    await writeFile(join(path, "status-999.json"), "not json\n");
    await writeFile(
      join(path, "status-998.json"),
      `${JSON.stringify({ uid: 998, safeToRestart: false, reasons: ["agent-turn"], currentVersion: "0.1.0", updateVersion: "0.2.0", heartbeatAt: now })}\n`,
    );
    overrides.set("status-998.json", 0);

    await lead.tick();
    await lead.tick();
    // Only the leader itself is a known tenant, and it is idle: stopping proceeds.
    expect(JSON.parse(await readFile(join(path, "intent.json"), "utf8"))).toMatchObject({ state: "stopping" });
    await lead.coordinator.stop();
  });

  it("a stale leader loses the lock to a tenant holding the update", async () => {
    let now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const first = await createTenant(path, statUid, 501, 111, { now: clock });
    const second = await createTenant(path, statUid, 502, 222, { now: clock });

    await first.tick();
    expect(JSON.parse(await readFile(join(path, "leader.json"), "utf8"))).toMatchObject({ uid: 501 });
    now += 61_000;
    await second.tick();
    expect(JSON.parse(await readFile(join(path, "leader.json"), "utf8"))).toMatchObject({ uid: 502 });
    await first.coordinator.stop();
    await second.coordinator.stop();
  });

  it("reports health once after relaunching on the released version", async () => {
    const now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const relaunched = await createTenant(path, statUid, 502, 222, {
      now: () => now,
      currentVersion: "0.2.0",
    });
    relaunched.setReadyVersion(null);
    await writeFile(join(path, "release.json"), `${JSON.stringify({ version: "0.2.0", releasedAt: now, wave: 1 })}\n`);

    await relaunched.tick();
    expect(relaunched.healthCalls).toBe(1);
    expect(JSON.parse(await readFile(join(path, "health-502.json"), "utf8"))).toMatchObject({
      uid: 502,
      version: "0.2.0",
      ok: true,
    });
    await relaunched.tick();
    expect(relaunched.healthCalls).toBe(1);
    await relaunched.coordinator.stop();
  });

  it("writes a complete alert once every tenant reports healthy", async () => {
    const now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const generousHeartbeat = 3_600_000;
    const lead = await createTenant(path, statUid, 501, 111, {
      now: clock,
      idleGraceMs: 0,
      heartbeatTimeoutMs: generousHeartbeat,
    });
    const other = await createTenant(path, statUid, 502, 222, {
      now: clock,
      idleGraceMs: 0,
      heartbeatTimeoutMs: generousHeartbeat,
    });

    await lead.tick();
    await other.tick();
    await lead.tick();
    await other.coordinator.markStopped("0.2.0");
    await lead.tick();
    expect(lead.installCalls).toBe(1);
    await lead.coordinator.stop();
    await other.coordinator.stop();

    // Both tenants relaunch on the new version and prove they loaded.
    const lead2 = await createTenant(path, statUid, 501, 333, {
      now: clock,
      heartbeatTimeoutMs: generousHeartbeat,
      currentVersion: "0.2.0",
    });
    const other2 = await createTenant(path, statUid, 502, 444, {
      now: clock,
      heartbeatTimeoutMs: generousHeartbeat,
      currentVersion: "0.2.0",
    });
    lead2.setReadyVersion(null);
    other2.setReadyVersion(null);
    await lead2.tick();
    await other2.tick();
    await lead2.tick();
    expect(JSON.parse(await readFile(join(path, `alert-0.2.0.json`), "utf8"))).toMatchObject({
      version: "0.2.0",
      complete: true,
      tenants: [
        { uid: 501, ok: true },
        { uid: 502, ok: true },
      ],
    });
    await lead2.coordinator.stop();
    await other2.coordinator.stop();
  });

  it("flags missing and failed health in the alert after the timeout", async () => {
    let now = 1_000_000;
    const { path, statUid } = await createDirectory();
    const clock = () => now;
    const generousHeartbeat = 3_600_000;
    const lead = await createTenant(path, statUid, 501, 111, {
      now: clock,
      idleGraceMs: 0,
      heartbeatTimeoutMs: generousHeartbeat,
    });
    const other = await createTenant(path, statUid, 502, 222, {
      now: clock,
      idleGraceMs: 0,
      heartbeatTimeoutMs: generousHeartbeat,
    });

    await lead.tick();
    await other.tick();
    await lead.tick();
    await other.coordinator.markStopped("0.2.0");
    await lead.tick();
    expect(lead.installCalls).toBe(1);
    await lead.coordinator.stop();
    await other.coordinator.stop();

    // Only one tenant comes back, and it comes back broken.
    const lead2 = await createTenant(path, statUid, 501, 333, {
      now: clock,
      heartbeatTimeoutMs: generousHeartbeat,
      healthTimeoutMs: 60_000,
      currentVersion: "0.2.0",
    });
    lead2.setReadyVersion(null);
    lead2.setHealthy(false);
    await lead2.tick();
    now += 61_000;
    await lead2.tick();
    expect(JSON.parse(await readFile(join(path, `alert-0.2.0.json`), "utf8"))).toMatchObject({
      version: "0.2.0",
      complete: false,
      tenants: [
        { uid: 501, ok: false },
        { uid: 502, ok: false },
      ],
    });
    await lead2.coordinator.stop();
  });
});
