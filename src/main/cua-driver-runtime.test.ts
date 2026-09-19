import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
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
  vi.unstubAllEnvs();
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
    endpoint: { kind: "unix-socket", directory: socketDirectory },
    supported: true,
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
    const { driver, spawned } = await runtime({ endpoint: { kind: "unix-socket", directory: tooDeep } });

    await expect(driver.start()).rejects.toThrow(/103/);
    expect(spawned).toHaveLength(0);
  });

  // `mkdir` applies its mode only to a directory it creates. On Linux the temporary directory is
  // usually the shared `/tmp`, so another local user can put ours there first and then read or
  // replace the socket that controls the whole desktop.
  it("refuses a socket directory other users can write to, rather than serve the control channel in it", async () => {
    const shared = join(tmpdir(), `cua-driver-shared-${process.pid}`);
    directories.push(shared);
    await mkdir(shared, { recursive: true });
    await chmod(shared, 0o777);
    const { driver, spawned } = await runtime({ endpoint: { kind: "unix-socket", directory: shared } });

    await expect(driver.start()).rejects.toThrow(/open to other users/);
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

  // Windows names a pipe in a kernel namespace rather than a path on disk, so nothing is created,
  // nothing is unlinked, and the path-length rule that macOS and Linux need does not apply.
  it("serves on a named pipe on Windows, and measures no path", async () => {
    const { driver, spawned } = await runtime({
      endpoint: { kind: "windows-pipe", name: `\\\\.\\pipe\\openbot-cua-${"x".repeat(200)}` },
      platform: "win32",
    });
    await driver.start();

    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toEqual(["serve", "--socket", driver.socketPath()]);
    expect(driver.socketPath().startsWith("\\\\.\\pipe\\")).toBe(true);
    // A Windows process started without `SystemRoot` cannot load the system libraries it links
    // against, so the proxy would fail before it reached the daemon.
    expect(driver.mcpServerConfig()?.envPassthrough).toContain("SystemRoot");
  });

  // Linux allows four more characters than macOS. A limit copied from macOS would refuse a path the
  // system accepts, and no limit at all would return the same unnamed `EINVAL`.
  it("holds a Linux socket path macOS would refuse, and refuses a longer one", async () => {
    const base = join(tmpdir(), "cua");
    const fits = "y".repeat(105 - base.length - "/driver.sock".length);
    const fitting = await runtime({
      endpoint: { kind: "unix-socket", directory: join(base, fits) },
      platform: "linux",
    });
    await fitting.driver.start();
    expect(fitting.driver.socketPath().length).toBeGreaterThan(103);
    expect(fitting.spawned).toHaveLength(1);

    const tooDeep = await runtime({
      endpoint: { kind: "unix-socket", directory: join(base, "z".repeat(120)) },
      platform: "linux",
    });
    await expect(tooDeep.driver.start()).rejects.toThrow(/107/);
    expect(tooDeep.spawned).toHaveLength(0);
  });

  // The driver keeps its native Wayland backend behind a variable, and without it a Wayland session
  // falls back to XWayland, where the driver sees only XWayland clients and misses every native
  // window. OpenBot starts the daemon, so OpenBot is what knows which session it woke up on.
  it("turns on the Wayland backend on a Wayland session, and leaves an X11 one alone", async () => {
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    const wayland = await runtime({ platform: "linux" });
    await wayland.driver.start();
    expect(wayland.spawned[0].options.env.CUA_DRIVER_RS_ENABLE_WAYLAND).toBe("1");

    vi.stubEnv("XDG_SESSION_TYPE", "x11");
    const x11 = await runtime({ platform: "linux" });
    await x11.driver.start();
    expect(x11.spawned[0].options.env.CUA_DRIVER_RS_ENABLE_WAYLAND).toBeUndefined();
  });

  // A user who turned the backend off did so because their compositor handles it badly.
  it("leaves a Wayland choice the user made already", async () => {
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    vi.stubEnv("CUA_DRIVER_RS_ENABLE_WAYLAND", "0");
    const { driver, spawned } = await runtime({ platform: "linux" });
    await driver.start();

    expect(spawned[0].options.env.CUA_DRIVER_RS_ENABLE_WAYLAND).toBe("0");
  });

  // Windows and Linux put no permission between a program and the desktop it already runs on. An
  // empty permission list must read as ready, never as "nothing granted yet".
  it("treats a driver that answers as ready where the system grants no permission", async () => {
    const { driver } = await runtime({
      endpoint: { kind: "windows-pipe", name: "\\\\.\\pipe\\openbot-cua-test" },
      platform: "win32",
      readPermissions: async () => [],
    });

    await expect(driver.state()).resolves.toMatchObject({ status: "ready", permissions: [] });
  });

  it("reports a computer the driver is not published for, without spawning anything", async () => {
    const { driver, spawned } = await runtime({ supported: false, executable: null });

    await expect(driver.state()).resolves.toMatchObject({ status: "unsupported" });
    expect(spawned).toHaveLength(0);
  });

  it("does not claim a grant an unfamiliar answer never mentioned", () => {
    expect(
      readPermissionResult({ structuredContent: { screen_capture: true, accessibility: "granted" } }, "darwin"),
    ).toEqual([
      { id: "screen-recording", granted: true },
      { id: "accessibility", granted: true },
    ]);
    expect(readPermissionResult({ structuredContent: { somethingElse: true } }, "darwin")).toEqual([
      { id: "screen-recording", granted: false },
      { id: "accessibility", granted: false },
    ]);
  });
});
