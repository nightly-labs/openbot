// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { recordRestartActivity } from "../backend/restart-activity";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { hostConfigSchema, readOwnedJson, writeProtocolJson } from "./host-update-files";

const directories: string[] = [];
const uid = process.getuid?.() ?? 501;
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(platform: NodeJS.Platform = "darwin") {
  const directory = await mkdtemp(join(process.cwd(), ".host-client-test-"));
  directories.push(directory);
  await mkdir(join(directory, "tenants"), { mode: 0o755 });
  await mkdir(join(directory, "tenants", String(uid)), { mode: 0o700 });
  const state = { phase: "stopping" as const, cycle: "cycle-1", version: "0.2.0", updatedAt: 1_000_000, error: null };
  await runCauseEffect(writeProtocolJson(join(directory, "state.json"), state));
  const stop = vi.fn(async () => undefined);
  const managed = vi.fn();
  let now = 1_000_000;
  const client = new HostUpdateCoordinator({
    platform,
    directory,
    hostUid: uid,
    uid,
    pid: 123,
    currentVersion: "0.1.0",
    now: () => now,
    describeReadiness: () => ({ safeToRestart: true, reasons: [] }),
    checkHealth: () => Effect.succeed({ ok: true, checks: [] }),
    setManagedByHost: managed,
  });
  client.setStopHandler(stop);
  return {
    directory,
    state,
    stop,
    managed,
    client,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe("tenant host-status client", () => {
  it.each(["win32", "linux"] as const)("does not read host files on %s", async (platform) => {
    const f = await fixture(platform);
    await writeFile(join(f.directory, "config.json"), "invalid host configuration");
    await runCauseEffect(f.client.tick());
    expect(f.managed).toHaveBeenCalledWith(false);
    expect(f.stop).not.toHaveBeenCalled();
    await expect(readFile(join(f.directory, "tenants", String(uid), "status.json"))).rejects.toThrow();
  });

  it("does nothing when host management is absent or disabled", async () => {
    const f = await fixture();
    await runCauseEffect(f.client.tick());
    expect(f.stop).not.toHaveBeenCalled();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: false, tenants: [uid] }));
    await runCauseEffect(f.client.tick());
    expect(f.stop).not.toHaveBeenCalled();
    await expect(readFile(join(f.directory, "tenants", String(uid), "status.json"))).rejects.toThrow();
  });

  it("reports only its own status and requests cooperative shutdown once", async () => {
    const f = await fixture();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] }));
    await runCauseEffect(f.client.tick());
    expect(f.stop).not.toHaveBeenCalled();
    f.advance(300_000);
    await runCauseEffect(writeProtocolJson(join(f.directory, "state.json"), { ...f.state, updatedAt: f.now() }));
    await Promise.all([runCauseEffect(f.client.tick()), runCauseEffect(f.client.tick())]);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(f.directory, "tenants", String(uid), "status.json"), "utf8"))).toMatchObject({
      uid,
      pid: 123,
      safeToRestart: true,
      healthy: true,
    });
    expect(JSON.parse(await readFile(join(f.directory, "state.json"), "utf8"))).toEqual({
      ...f.state,
      updatedAt: f.now(),
    });
  });

  it("resets local idle grace after work that finishes between polls and vetoes an old stop", async () => {
    const f = await fixture();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] }));
    await runCauseEffect(f.client.tick());
    f.advance(300_000);
    recordRestartActivity();
    await runCauseEffect(writeProtocolJson(join(f.directory, "state.json"), { ...f.state, updatedAt: f.now() }));
    await runCauseEffect(f.client.tick());
    expect(f.stop).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(f.directory, "tenants", String(uid), "status.json"), "utf8"))).toMatchObject({
      safeToRestart: true,
      idleSince: f.now(),
    });
    f.advance(300_000);
    await runCauseEffect(writeProtocolJson(join(f.directory, "state.json"), { ...f.state, updatedAt: f.now() }));
    await runCauseEffect(f.client.tick());
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("rejects a symlinked admin config and a writable admin config", async () => {
    const f = await fixture();
    const target = join(f.directory, "target.json");
    await writeFile(target, JSON.stringify({ managed: true, tenants: [uid] }));
    await symlink(target, join(f.directory, "config.json"));
    await expect(runCauseEffect(f.client.tick())).rejects.toThrow();
    await rm(join(f.directory, "config.json"));
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] }));
    await chmod(join(f.directory, "config.json"), 0o666);
    await expect(runCauseEffect(f.client.tick())).rejects.toThrow();
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("rejects false file ownership and oversized input", async () => {
    const f = await fixture();
    const path = join(f.directory, "config.json");
    await runCauseEffect(writeProtocolJson(path, { managed: true, tenants: [uid] }));
    await expect(runCauseEffect(readOwnedJson(path, uid + 1, hostConfigSchema))).rejects.toThrow();
    await writeFile(path, "x".repeat(8193));
    await expect(runCauseEffect(readOwnedJson(path, uid, hostConfigSchema))).rejects.toThrow();
  });

  it("does not follow a status symlink when publishing", async () => {
    const f = await fixture();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] }));
    const target = join(f.directory, "untouched");
    await writeFile(target, "keep");
    await symlink(target, join(f.directory, "tenants", String(uid), "status.json"));
    await runCauseEffect(f.client.tick());
    expect(await readFile(target, "utf8")).toBe("keep");
  });

  it("ignores stale stop requests and stops reporting after management is disabled", async () => {
    const f = await fixture();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] }));
    await runCauseEffect(writeProtocolJson(join(f.directory, "state.json"), { ...f.state, updatedAt: 0 }));
    await runCauseEffect(f.client.tick());
    expect(f.stop).not.toHaveBeenCalled();
    await runCauseEffect(writeProtocolJson(join(f.directory, "config.json"), { managed: false, tenants: [uid] }));
    await runCauseEffect(f.client.tick());
    expect(f.managed).toHaveBeenLastCalledWith(false);
  });
});
