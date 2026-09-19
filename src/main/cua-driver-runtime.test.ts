import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CuaDriverRuntime,
  type CuaDriverRuntimeOptions,
  readPermissionResult,
  type SpawnDriverOptions,
  type SpawnDriverProcess,
} from "./cua-driver-runtime";

/** A process that stays alive until the runtime ends it, so `running()` and `stop()` are real. */
const STAND_IN_DAEMON = ["/bin/sleep", "30"] as const;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runtime(overrides: Partial<CuaDriverRuntimeOptions> = {}) {
  const socketDirectory = join(await mkdtemp(join(tmpdir(), "cua-driver-test-")), "cua-driver");
  directories.push(socketDirectory);
  const spawned: Array<{ command: string; args: readonly string[]; options: SpawnDriverOptions }> = [];
  // The argv and the environment are recorded, and a stand-in process is run in place of the driver
  // this computer may not have. A real child, so `stop()` has something real to end.
  const spawnProcess: SpawnDriverProcess = vi.fn((command, args, options) => {
    spawned.push({ command, args, options });
    const [standIn, ...standInArgs] = STAND_IN_DAEMON;
    return spawn(standIn, standInArgs, { stdio: options.stdio, windowsHide: true });
  });
  const driver = new CuaDriverRuntime({
    executable: "/opt/cua/bin/cua-driver",
    socketDirectory,
    hostBundleId: "app.openbot.desktop",
    platform: "darwin",
    spawnProcess,
    waitForSocket: async () => undefined,
    readPermissions: async () => [
      { id: "screen-recording", granted: true },
      { id: "accessibility", granted: true },
    ],
    ...overrides,
  });
  return { driver, spawned, socketDirectory };
}

describe("CuaDriverRuntime", () => {
  it("serves on a socket in a private directory, never in a world-writable one", async () => {
    const { driver, spawned, socketDirectory } = await runtime();
    await driver.start();

    expect(spawned).toHaveLength(1);
    expect(spawned[0].command).toBe("/opt/cua/bin/cua-driver");
    expect(spawned[0].args).toEqual(["serve", "--socket", join(socketDirectory, "driver.sock")]);
    expect(driver.socketPath().startsWith(tmpdir())).toBe(true);
    expect(driver.socketPath()).not.toBe(join(tmpdir(), "driver.sock"));
  });

  // The user data directory cannot hold this socket: an isolated development profile alone spends 64
  // characters on a worktree hash, and macOS answers a path over 103 characters with a bare `EINVAL`
  // that names nothing. The daemon must not be started at all in that case.
  it("refuses a socket path macOS cannot hold, rather than let the connection fail as EINVAL", async () => {
    const tooDeep = join(tmpdir(), "cua", "x".repeat(120));
    const { driver, spawned } = await runtime({ socketDirectory: tooDeep });

    await expect(driver.start()).rejects.toThrow(/103/);
    expect(spawned).toHaveLength(0);
  });

  it("marks itself embedded, so macOS holds OpenBot responsible for the grant", async () => {
    const { driver, spawned } = await runtime();
    await driver.start();

    expect(spawned[0].options.env.CUA_DRIVER_EMBEDDED).toBe("1");
    expect(spawned[0].options.env.CUA_DRIVER_HOST_BUNDLE_ID).toBe("app.openbot.desktop");
  });

  it("starts one daemon however many callers ask at once", async () => {
    const { driver, spawned } = await runtime();
    await Promise.all([driver.start(), driver.start(), driver.start()]);

    expect(spawned).toHaveLength(1);
  });

  it("offers no MCP entry before the daemon runs, and one with no working directory after", async () => {
    const { driver } = await runtime();
    expect(driver.mcpServerConfig()).toBeNull();

    await driver.start();
    const config = driver.mcpServerConfig();

    // ACP drops a stdio entry that carries a working directory, and Codex accepts none, so an entry
    // with one would vanish for two of the three providers with no error.
    expect(config?.workingDirectory).toBe("");
    expect(config?.args).toEqual(["mcp", "--socket", driver.socketPath()]);
    expect(config?.env).toEqual([{ key: "CUA_DRIVER_EMBEDDED", value: "1" }]);
  });

  it("stops the daemon it started", async () => {
    const { driver } = await runtime();
    await driver.start();
    expect(driver.running()).toBe(true);

    await driver.stop();

    expect(driver.running()).toBe(false);
    expect(driver.mcpServerConfig()).toBeNull();
  });

  it("reports the driver missing without spawning anything", async () => {
    const { driver, spawned } = await runtime({ executable: null });

    await expect(driver.state()).resolves.toMatchObject({ status: "driver-missing" });
    expect(spawned).toHaveLength(0);
  });

  it("reports both grants as ready, and a missing one as setup still required", async () => {
    const granted = await runtime();
    await expect(granted.driver.state()).resolves.toMatchObject({ status: "ready" });

    const partial = await runtime({
      readPermissions: async () => [
        { id: "screen-recording", granted: true },
        { id: "accessibility", granted: false },
      ],
    });
    await expect(partial.driver.state()).resolves.toMatchObject({ status: "permissions-required" });
  });

  it("does not claim a grant an unfamiliar answer never mentioned", () => {
    expect(readPermissionResult({ structuredContent: { screen_capture: true, accessibility: "granted" } })).toEqual([
      { id: "screen-recording", granted: true },
      { id: "accessibility", granted: true },
    ]);
    expect(readPermissionResult({ structuredContent: { somethingElse: true } })).toEqual([
      { id: "screen-recording", granted: false },
      { id: "accessibility", granted: false },
    ]);
  });
});
