// @vitest-environment node
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostManager, type HostManagerOperations } from "../src/main/host-manager";
import { hostStateSchema, readOwnedJson, writeProtocolJson } from "../src/main/host-update-files";
import { relaunchManagedTenant } from "../src/main/host-update-relaunch";
import { isNewerRelease, verifyBundleTree } from "./host-manager-macos";

const directories: string[] = [];
const uid = process.getuid?.() ?? 501;

describe.skipIf(process.platform === "win32")("application staging permissions", () => {
  it("stages under the administrator-writable Applications parent but rejects unsafe staging paths", async () => {
    const stage = "/Applications/.openbot-host-stage";
    const metadata = { uid: 0, mode: 0o40700, directory: true, acl: "" };
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs/promises")>()),
      mkdir: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      lstat: async (path: string) =>
        Object.assign(await lstat(process.cwd()), {
          uid: path === stage ? metadata.uid : 0,
          gid: path === "/Applications" ? 80 : 0,
          mode: path === stage ? metadata.mode : path === "/Applications" ? 0o40775 : 0o40755,
          isDirectory: () => path !== stage || metadata.directory,
        }),
    }));
    vi.doMock("node:child_process", () => ({
      execFile: Object.assign(vi.fn(), {
        [promisify.custom]: async (_file: string, args: string[]) => ({
          stdout: args.at(-1) === stage ? metadata.acl : "",
          stderr: "",
        }),
      }),
    }));
    try {
      const { ensureHostDirectory, verifyHostPath } = await import("./host-manager-macos");
      await ensureHostDirectory(stage, 0o700);
      await verifyHostPath(stage);
      metadata.mode = 0o40777;
      await expect(verifyHostPath(stage)).rejects.toThrow("Unsafe");
      metadata.mode = 0o40700;
      metadata.uid = 501;
      await expect(verifyHostPath(stage)).rejects.toThrow("Unsafe");
      metadata.uid = 0;
      metadata.directory = false;
      await expect(verifyHostPath(stage)).rejects.toThrow("Unsafe");
      metadata.directory = true;
      metadata.acl = " 0: user:client-acme allow add_file";
      await expect(verifyHostPath(stage)).rejects.toThrow("ACL");
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(process.cwd(), ".host-daemon-test-"));
  directories.push(directory);
  await mkdir(join(directory, "tenants"), { mode: 0o755 });
  await mkdir(join(directory, "tenants", String(uid)), { mode: 0o700 });
  await writeProtocolJson(join(directory, "config.json"), { managed: true, tenants: [uid] });
  let now = 1_000_000;
  let running = [{ uid, pid: 123 }];
  let installed = "0.1.0";
  const install = vi.fn(async () => {
    installed = "0.2.0";
  });
  const operations: HostManagerOperations = {
    stageLatest: vi.fn(async () => "0.2.0"),
    install,
    installedVersion: async () => installed,
    runningTenants: async () => running,
    applicationInUse: async () => running.length !== 0,
  };
  const manager = new HostManager(directory, operations, { hostUid: uid, now: () => now });
  const state = () => readOwnedJson(join(directory, "state.json"), uid, hostStateSchema);
  const status = async (safe = true, idleSince = 1_000_000, currentVersion = "0.1.0") => {
    const current = await state();
    await writeProtocolJson(join(directory, "tenants", String(uid), "status.json"), {
      uid,
      pid: 123,
      safeToRestart: safe,
      heartbeatAt: now,
      idleSince: safe ? idleSince : null,
      currentVersion,
      cycle: current.cycle,
      healthy: true,
    });
  };
  const idle = async () => {
    for (let step = 0; step <= 60; step += 1) {
      await status();
      await manager.tick();
      now += 5000;
    }
  };
  return {
    directory,
    manager,
    operations,
    install,
    state,
    status,
    idle,
    advance: (ms: number) => {
      now += ms;
    },
    setRunning: (value: typeof running) => {
      running = value;
    },
    setInstalled: (value: string) => {
      installed = value;
    },
  };
}

describe("privileged host update lifecycle", () => {
  it("stages without a tenant download and installs only after five minutes and actual exit", async () => {
    const f = await fixture();
    await f.manager.tick();
    expect(f.operations.stageLatest).toHaveBeenCalledOnce();
    expect((await f.state()).phase).toBe("waiting");
    await f.idle();
    expect((await f.state()).phase).toBe("stopping");
    await f.manager.tick();
    expect(f.install).not.toHaveBeenCalled();
    f.setRunning([]);
    await Promise.all([f.manager.tick(), f.manager.tick()]);
    expect(f.install).toHaveBeenCalledOnce();
    expect((await f.state()).phase).toBe("released");
    await f.status(true, 1_000_000, "0.2.0");
    await f.manager.tick();
    expect((await f.state()).phase).toBe("idle");
  });

  it("keeps the old application available when staging fails", async () => {
    const f = await fixture();
    f.operations.stageLatest = async () => {
      throw new Error("offline");
    };
    await f.manager.tick();
    expect((await f.state()).phase).toBe("aborted");
    expect(f.install).not.toHaveBeenCalled();
  });

  it("does not publish success before the bundle version matches", async () => {
    const f = await fixture();
    f.install.mockImplementation(async () => undefined);
    await f.manager.tick();
    await f.idle();
    f.setRunning([]);
    await f.manager.tick();
    expect((await f.state()).phase).toBe("failed");
    await f.manager.tick();
    expect(f.install).toHaveBeenCalledOnce();
  });

  it("blocks for a registered tenant with missing, malformed, symlinked or stale status", async () => {
    const f = await fixture();
    await f.manager.tick();
    const path = join(f.directory, "tenants", String(uid), "status.json");
    await f.manager.tick();
    await writeFile(path, "invalid");
    await f.manager.tick();
    await rm(path);
    await symlink(join(f.directory, "config.json"), path);
    await f.manager.tick();
    await rm(path);
    await f.status();
    f.advance(300_000);
    await f.manager.tick();
    expect((await f.state()).phase).toBe("waiting");
    expect(f.install).not.toHaveBeenCalled();
  });

  it("starts a new grace period after a busy report or a missed heartbeat", async () => {
    const f = await fixture();
    await f.manager.tick();
    await f.status();
    await f.manager.tick();
    f.advance(290_000);
    await f.status(false);
    await f.manager.tick();
    f.advance(10_000);
    await f.status(true, 1_300_000);
    await f.manager.tick();
    expect((await f.state()).phase).toBe("waiting");
    f.advance(300_000);
    await f.status(true, 1_300_000);
    await f.manager.tick();
    expect((await f.state()).phase).toBe("waiting");
  });

  it("does not let an unregistered running user disappear from participation", async () => {
    const f = await fixture();
    await f.manager.tick();
    f.setRunning([
      { uid, pid: 123 },
      { uid: uid + 1, pid: 456 },
    ]);
    await f.idle();
    expect((await f.state()).phase).toBe("waiting");
  });

  it("does not coordinate when disabled", async () => {
    const f = await fixture();
    await writeProtocolJson(join(f.directory, "config.json"), { managed: false, tenants: [uid] });
    await f.manager.tick();
    expect(f.operations.stageLatest).not.toHaveBeenCalled();
  });

  it("holds an interrupted installation for administrator recovery", async () => {
    const f = await fixture();
    await writeProtocolJson(join(f.directory, "state.json"), {
      phase: "installing",
      cycle: "interrupted",
      version: "0.2.0",
      updatedAt: 1,
      error: null,
    });
    await f.manager.tick();
    expect((await f.state()).phase).toBe("failed");
    expect(f.install).not.toHaveBeenCalled();
  });

  it("reports shutdown and post-restart health timeouts", async () => {
    const f = await fixture();
    await f.manager.tick();
    await f.idle();
    f.advance(120_001);
    await f.manager.tick();
    expect((await f.state()).error).toContain("shutdown timed out");
    const healthy = await fixture();
    await healthy.manager.tick();
    await healthy.idle();
    healthy.setRunning([]);
    await healthy.manager.tick();
    healthy.advance(600_001);
    await healthy.manager.tick();
    expect((await healthy.state()).error).toContain("health reports");
  });

  it("rejects hard links instead of reading tenant content through them", async () => {
    const f = await fixture();
    await f.manager.tick();
    const config = join(f.directory, "config.json");
    await link(config, join(f.directory, "linked.json"));
    await expect(readOwnedJson(join(f.directory, "linked.json"), uid, hostStateSchema)).rejects.toThrow("ownership");
    expect(await readFile(config, "utf8")).toContain('"managed":true');
  });

  it("rejects bundle files writable by tenants or linked outside the application", async () => {
    const f = await fixture();
    const app = join(f.directory, "App.app");
    await mkdir(app);
    await writeFile(join(app, "code"), "app");
    await chmod(join(app, "code"), 0o666);
    await expect(verifyBundleTree(app, true)).rejects.toThrow();
    await symlink("/Users", join(app, "external"));
    await expect(verifyBundleTree(app, false)).rejects.toThrow("external symlink");
  });

  it("relaunches only the missing tenant, in either UID order", async () => {
    const f = await fixture();
    const otherUid = uid + 1;
    await writeProtocolJson(join(f.directory, "config.json"), { managed: true, tenants: [uid, otherUid] });
    await writeProtocolJson(join(f.directory, "state.json"), {
      phase: "released",
      cycle: "release-1",
      version: "0.2.0",
      updatedAt: 1,
      error: null,
    });
    for (const [runningUid, missingUid] of [
      [uid, otherUid],
      [otherUid, uid],
    ]) {
      const open = vi.fn(async () => undefined);
      const operations = {
        runningTenants: async () => [{ uid: runningUid, pid: 100 }],
        installedVersion: async () => "0.2.0",
        open,
      };
      await relaunchManagedTenant(runningUid, operations, f.directory, uid);
      expect(open).not.toHaveBeenCalled();
      await relaunchManagedTenant(missingUid, operations, f.directory, uid);
      expect(open).toHaveBeenCalledOnce();
    }
  });

  it("never relaunches against an unverified version or a failed cycle", async () => {
    const f = await fixture();
    const open = vi.fn(async () => undefined);
    const operations = { runningTenants: async () => [], installedVersion: async () => "0.1.0", open };
    await writeProtocolJson(join(f.directory, "state.json"), {
      phase: "released",
      cycle: "release-1",
      version: "0.2.0",
      updatedAt: 1,
      error: null,
    });
    await expect(relaunchManagedTenant(uid, operations, f.directory, uid)).rejects.toThrow("does not match");
    await writeProtocolJson(join(f.directory, "state.json"), {
      phase: "failed",
      cycle: "release-1",
      version: "0.2.0",
      updatedAt: 1,
      error: "Failed",
    });
    await relaunchManagedTenant(uid, operations, f.directory, uid);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not downgrade or reinstall an equal version", () => {
    expect(isNewerRelease("0.14.2", "0.14.1")).toBe(true);
    expect(isNewerRelease("0.14.1", "0.14.1")).toBe(false);
    expect(isNewerRelease("0.13.9", "0.14.1")).toBe(false);
  });
});
