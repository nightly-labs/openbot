// @vitest-environment node
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { hostConfigSchema, readOwnedJson, writeProtocolJson } from "./host-update-files";

const directories: string[] = [];
const uid = process.getuid?.() ?? 501;
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(process.cwd(), ".host-client-test-"));
  directories.push(directory);
  await mkdir(join(directory, "tenants"), { mode: 0o755 });
  await mkdir(join(directory, "tenants", String(uid)), { mode: 0o700 });
  const state = { phase: "stopping" as const, cycle: "cycle-1", version: "0.2.0", updatedAt: 1_000_000, error: null };
  await writeProtocolJson(join(directory, "state.json"), state);
  const stop = vi.fn(async () => undefined);
  const managed = vi.fn();
  const client = new HostUpdateCoordinator({
    directory,
    hostUid: uid,
    uid,
    pid: 123,
    currentVersion: "0.1.0",
    now: () => 1_000_000,
    describeReadiness: () => ({ safeToRestart: true, reasons: [] }),
    checkHealth: async () => ({ ok: true, checks: [] }),
    setManagedByHost: managed,
  });
  client.setStopHandler(stop);
  return { directory, state, stop, managed, client };
}

describe("tenant host-status client", () => {
  it("does nothing when host management is absent or disabled", async () => {
    const f = await fixture();
    await f.client.tick();
    expect(f.stop).not.toHaveBeenCalled();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: false, tenants: [uid] });
    await f.client.tick();
    expect(f.stop).not.toHaveBeenCalled();
    await expect(readFile(join(f.directory, "tenants", String(uid), "status.json"))).rejects.toThrow();
  });

  it("reports only its own status and requests cooperative shutdown once", async () => {
    const f = await fixture();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] });
    await Promise.all([f.client.tick(), f.client.tick()]);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(f.directory, "tenants", String(uid), "status.json"), "utf8"))).toMatchObject({
      uid,
      pid: 123,
      safeToRestart: true,
      healthy: true,
    });
    expect(JSON.parse(await readFile(join(f.directory, "state.json"), "utf8"))).toEqual(f.state);
  });

  it("rejects a symlinked admin config and a writable admin config", async () => {
    const f = await fixture();
    const target = join(f.directory, "target.json");
    await writeFile(target, JSON.stringify({ managed: true, tenants: [uid] }));
    await symlink(target, join(f.directory, "config.json"));
    await expect(f.client.tick()).rejects.toThrow();
    await rm(join(f.directory, "config.json"));
    await writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] });
    await chmod(join(f.directory, "config.json"), 0o666);
    await expect(f.client.tick()).rejects.toThrow();
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("rejects false file ownership and oversized input", async () => {
    const f = await fixture();
    const path = join(f.directory, "config.json");
    await writeProtocolJson(path, { managed: true, tenants: [uid] });
    await expect(readOwnedJson(path, uid + 1, hostConfigSchema)).rejects.toThrow();
    await writeFile(path, "x".repeat(8193));
    await expect(readOwnedJson(path, uid, hostConfigSchema)).rejects.toThrow();
  });

  it("does not follow a status symlink when publishing", async () => {
    const f = await fixture();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] });
    const target = join(f.directory, "untouched");
    await writeFile(target, "keep");
    await symlink(target, join(f.directory, "tenants", String(uid), "status.json"));
    await f.client.tick();
    expect(await readFile(target, "utf8")).toBe("keep");
  });

  it("ignores stale stop requests and stops reporting after management is disabled", async () => {
    const f = await fixture();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid] });
    await writeProtocolJson(join(f.directory, "state.json"), { ...f.state, updatedAt: 0 });
    await f.client.tick();
    expect(f.stop).not.toHaveBeenCalled();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: false, tenants: [uid] });
    await f.client.tick();
    expect(f.managed).toHaveBeenLastCalledWith(false);
  });
});
