import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CuaDriverCommandAliasInput,
  CuaDriverRuntime,
  type CuaDriverRuntimeOptions,
  cuaDriverCommandAlias,
  readPermissionResult,
  resolveCuaDriverEndpoint,
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

  it("gives the daemon the OpenBot cursor, so a user sees which pointer an agent moves", async () => {
    const { driver, spawned } = await runtime({
      cursorTheme: {
        directory: "/Applications/OpenBot.app/Contents/Resources/cua-driver-theme",
        id: "run.openbot.cursor",
      },
    });
    await driver.start();

    expect(spawned[0].args).toContain("--cursor-theme");
    expect(spawned[0].args.at(-1)).toBe("run.openbot.cursor");
    expect(spawned[0].options.env.CUA_DRIVER_CURSOR_THEME_DIR).toBe(
      "/Applications/OpenBot.app/Contents/Resources/cua-driver-theme",
    );
  });

  it("names no cursor when the build ships none, so the driver keeps its own", async () => {
    const { driver, spawned } = await runtime({ cursorTheme: null });
    await driver.start();

    expect(spawned[0].args).not.toContain("--cursor-theme");
    expect(spawned[0].options.env.CUA_DRIVER_CURSOR_THEME_DIR).toBeUndefined();
  });

  it("makes neither call the driver makes to its own vendor, because OpenBot ships the driver and pins it", async () => {
    // Set in the inherited environment, which the daemon spawn copies first. OpenBot ships the
    // driver, so the analytics and the release check stay off whatever a process it inherits from
    // asks for.
    vi.stubEnv("CUA_DRIVER_RS_TELEMETRY_ENABLED", "1");
    vi.stubEnv("CUA_DRIVER_RS_UPDATE_CHECK", "1");
    const { driver, spawned } = await runtime();
    await driver.start();

    expect(spawned[0].options.env.CUA_DRIVER_RS_TELEMETRY_ENABLED).toBe("0");
    expect(spawned[0].options.env.CUA_DRIVER_RS_UPDATE_CHECK).toBe("0");
    // The providers spawn their own proxy, so the entry they are handed must carry them too.
    expect(driver.mcpServerConfig()?.env).toEqual([
      { key: "CUA_DRIVER_EMBEDDED", value: "1" },
      { key: "CUA_DRIVER_RS_TELEMETRY_ENABLED", value: "0" },
      { key: "CUA_DRIVER_RS_UPDATE_CHECK", value: "0" },
    ]);
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
    expect(config?.env.map((entry) => entry.key)).toContain("CUA_DRIVER_EMBEDDED");
  });

  it("stops the daemon it started", async () => {
    const { driver } = await runtime();
    await driver.start();
    expect(driver.running()).toBe(true);

    await driver.stop();

    expect(driver.running()).toBe(false);
    expect(driver.mcpServerConfig()).toBeNull();
  });

  // Both own the socket path. A start that overtook a stop would have its own socket removed by it,
  // and the daemon would then serve an address no client can reach.
  it("does not let a start overtake a stop and lose the socket it just made", async () => {
    const children: ChildProcess[] = [];
    const { driver, socketDirectory } = await runtime({
      spawnProcess: (_command, _args, options) => {
        // Deaf to `SIGTERM`, so the stop takes the grace period a real daemon can take to go. That
        // is the window in which a start could overtake it. It says when the handler is installed,
        // so the test signals it and never guesses.
        const child = spawn(
          process.execPath,
          ["-e", "process.on('SIGTERM', () => {}); console.log('deaf'); setInterval(() => {}, 1_000);"],
          { stdio: options.stdio },
        );
        children.push(child);
        return child;
      },
      waitForSocket: async (path) => {
        await writeFile(path, "");
      },
    });
    await driver.start();
    await new Promise<void>((resolve) => children[0].stdout?.once("data", () => resolve()));

    // What the panel does while `warmUp` is putting an ungranted daemon away.
    await Promise.all([driver.stop(), driver.state()]);

    expect(children).toHaveLength(2);
    expect(driver.running()).toBe(true);
    // The replacement's socket is still there: the stop it waited for removed the first one only.
    expect(existsSync(join(socketDirectory, "driver.sock"))).toBe(true);
    await driver.stop();
  });

  it("reports the driver missing without spawning anything", async () => {
    const { driver, spawned } = await runtime({ executable: null });

    await expect(driver.state()).resolves.toMatchObject({ status: "driver-missing" });
    expect(spawned).toHaveLength(0);
  });

  // `spawn` reports a removed or unreadable executable through an `error` event after it returns,
  // and an unhandled one throws in the main process. Computer Use is optional; it may not end the app.
  it("reports a failed spawn as a state, rather than throw out of the main process", async () => {
    const { driver } = await runtime({
      executable: "/opt/cua/bin/cua-driver-that-was-removed",
      spawnProcess: (command, _args, options) => spawn(command, [], { stdio: options.stdio }),
      // The socket never appears, because nothing ever started to serve it.
      waitForSocket: () => new Promise(() => undefined),
    });

    await expect(driver.state()).resolves.toMatchObject({ status: "error" });
    expect(driver.running()).toBe(false);
    expect(driver.mcpServerConfig()).toBeNull();
  });

  // The panel tells a user with no driver to install it and check again. Reading the answer from
  // startup would make a restart the only way to finish that installation.
  it("looks for the driver again, so an installation made while OpenBot runs is found", async () => {
    let installed: string | null = null;
    const { driver, spawned } = await runtime({
      executable: null,
      resolveExecutable: async () => installed,
    });

    await expect(driver.state()).resolves.toMatchObject({ status: "driver-missing" });
    expect(spawned).toHaveLength(0);

    installed = "/opt/cua/bin/cua-driver";
    await expect(driver.state()).resolves.toMatchObject({ status: "ready" });
    expect(spawned).toHaveLength(1);
  });

  // Each notification replaces every agent's provider session, because the tool set changed.
  // Reopening the panel asks the same question again, and the same answer must cost nothing.
  it("tells the listeners once for an answer that did not change", async () => {
    const { driver } = await runtime();
    const seen: string[] = [];
    driver.onStateChanged((state) => seen.push(state.status));

    await driver.state();
    await driver.state();
    await driver.state();

    expect(seen).toEqual(["ready"]);
  });

  // Opening the panel starts the daemon before any grant exists, and the warm-up stops an ungranted
  // daemon at the next start. Handing the entry over in between would put it in the tool fingerprint
  // of every session spawned meanwhile, and each of those would be replaced after the restart for a
  // tool set the user never changed. A stop this process asked for is the teardown, where the stored
  // sessions are left for the next run.
  it("hands the providers nothing until the grants are in place, and stays quiet when it is stopped", async () => {
    let granted = false;
    const { driver } = await runtime({
      readPermissions: async () => [
        { id: "screen-recording", granted },
        { id: "accessibility", granted },
      ],
    });
    let entries = 0;
    driver.onMcpServerChanged(() => {
      entries += 1;
    });

    await expect(driver.state()).resolves.toMatchObject({ status: "permissions-required" });
    expect(driver.running()).toBe(true);
    expect(driver.mcpServerForProviders()).toBeNull();
    expect(entries).toBe(0);

    granted = true;
    await expect(driver.state()).resolves.toMatchObject({ status: "ready" });
    expect(driver.mcpServerForProviders()).not.toBeNull();
    expect(entries).toBe(1);

    await driver.stop();
    expect(entries).toBe(1);
  });

  // The daemon going on its own is the one loss the providers must hear: a live session keeps a
  // command that no longer answers until its session is replaced.
  it("reports the MCP entry going when the daemon dies under it", async () => {
    const children: ChildProcess[] = [];
    const { driver } = await runtime({
      spawnProcess: (_command, _args, options) => {
        const [standIn, ...standInArgs] = STAND_IN_DAEMON;
        const child = spawn(standIn, standInArgs, { stdio: options.stdio });
        children.push(child);
        return child;
      },
    });
    let entries = 0;
    driver.onMcpServerChanged(() => {
      entries += 1;
    });
    await driver.state();
    expect(entries).toBe(1);

    // The runtime's own `exit` listener was added first, so it has run by the time this one does.
    const died = new Promise<void>((resolve) => children[0].once("exit", () => resolve()));
    children[0].kill("SIGKILL");
    await died;

    expect(entries).toBe(2);
    expect(driver.mcpServerConfig()).toBeNull();
  });

  // The sessions read back from the database were written by a run that had this same entry, so
  // announcing the warm-up would deactivate every one of them for a tool set that did not move.
  it("keeps the startup warm-up quiet, and still reports a later start", async () => {
    const { driver } = await runtime();
    let entries = 0;
    driver.onMcpServerChanged(() => {
      entries += 1;
    });

    await driver.warmUp();
    expect(driver.running()).toBe(true);
    expect(entries).toBe(0);

    await driver.stop();
    await driver.start();
    expect(entries).toBe(1);

    await driver.stop();
  });

  // A remote request and a scheduled task open no window, so waiting for the panel would leave a
  // user who granted the permissions without the tools after every restart.
  it("keeps the daemon at startup for a granted computer, and drops it for one that is not", async () => {
    const granted = await runtime();
    await granted.driver.warmUp();
    expect(granted.driver.running()).toBe(true);
    expect(granted.driver.mcpServerForProviders()).not.toBeNull();

    const ungranted = await runtime({
      readPermissions: async () => [
        { id: "screen-recording", granted: false },
        { id: "accessibility", granted: false },
      ],
    });
    await ungranted.driver.warmUp();
    expect(ungranted.driver.running()).toBe(false);
    expect(ungranted.driver.mcpServerForProviders()).toBeNull();

    await granted.driver.stop();
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

  // The endpoint reaches each proxy as an argument, and the arguments are folded into the stored
  // Codex tool fingerprint. A name that moves at each launch replaces every session on the next
  // turn, which keeps the public thread and loses what the provider held privately.
  describe("resolveCuaDriverEndpoint", () => {
    it("keeps the Windows pipe name across restarts, and unguessable outside this profile", async () => {
      const userDataPath = await mkdtemp(join(tmpdir(), "cua-profile-"));
      directories.push(userDataPath);
      const first = await resolveCuaDriverEndpoint({ platform: "win32", userDataPath, temporaryDirectory: tmpdir() });
      const second = await resolveCuaDriverEndpoint({ platform: "win32", userDataPath, temporaryDirectory: tmpdir() });

      expect(first).toEqual(second);
      expect(first.kind).toBe("windows-pipe");
      expect(first.kind === "windows-pipe" && first.name).toMatch(/^\\\\\.\\pipe\\openbot-cua-[0-9a-f-]{36}$/);

      const other = await mkdtemp(join(tmpdir(), "cua-profile-"));
      directories.push(other);
      // A second profile on the same computer must not answer on the first one's pipe.
      expect(
        await resolveCuaDriverEndpoint({ platform: "win32", userDataPath: other, temporaryDirectory: tmpdir() }),
      ).not.toEqual(first);
    });

    it("replaces a pipe name that is not one it wrote", async () => {
      const userDataPath = await mkdtemp(join(tmpdir(), "cua-profile-"));
      directories.push(userDataPath);
      await mkdir(join(userDataPath, "cua-driver"), { recursive: true });
      await writeFile(join(userDataPath, "cua-driver", "pipe-name"), "\\\\.\\pipe\\somebody-else");

      const endpoint = await resolveCuaDriverEndpoint({
        platform: "win32",
        userDataPath,
        temporaryDirectory: tmpdir(),
      });
      expect(endpoint.kind === "windows-pipe" && endpoint.name).toMatch(/openbot-cua-[0-9a-f-]{36}$/);
    });

    it("names the same socket directory for one profile, and a different one for another", async () => {
      const temporaryDirectory = tmpdir();
      const mine = await resolveCuaDriverEndpoint({
        platform: "darwin",
        userDataPath: "/Users/a/Library/OpenBot",
        temporaryDirectory,
      });
      const again = await resolveCuaDriverEndpoint({
        platform: "darwin",
        userDataPath: "/Users/a/Library/OpenBot",
        temporaryDirectory,
      });
      const other = await resolveCuaDriverEndpoint({
        platform: "darwin",
        userDataPath: "/Users/a/Library/OpenBot-dev",
        temporaryDirectory,
      });

      expect(mine).toEqual(again);
      expect(mine).not.toEqual(other);
      expect(mine.kind === "unix-socket" && mine.directory.startsWith(temporaryDirectory)).toBe(true);
    });

    // `/tmp` is world-writable on Linux, so another local user can create our directory first.
    it("prefers the login session's runtime directory on Linux", async () => {
      const onLinux = await resolveCuaDriverEndpoint({
        platform: "linux",
        userDataPath: "/home/a/.config/OpenBot",
        temporaryDirectory: "/tmp",
        runtimeDirectory: "/run/user/1000",
      });
      const noSession = await resolveCuaDriverEndpoint({
        platform: "linux",
        userDataPath: "/home/a/.config/OpenBot",
        temporaryDirectory: "/tmp",
        runtimeDirectory: "  ",
      });

      expect(onLinux.kind === "unix-socket" && onLinux.directory.startsWith("/run/user/1000/")).toBe(true);
      expect(noSession.kind === "unix-socket" && noSession.directory.startsWith("/tmp/")).toBe(true);
    });
  });

  // The packaged Linux build is an AppImage, which mounts its resources somewhere else at each
  // launch. The command reaches the stored Codex tool fingerprint, so a path that moves replaces
  // every session after a restart, and the old path is gone with the mount it named.
  describe("cuaDriverCommandAlias", () => {
    it("holds the command still for an AppImage, and leaves every other build alone", () => {
      const onAppImage: CuaDriverCommandAliasInput = {
        platform: "linux",
        isPackaged: true,
        appImagePath: "/home/jane/Applications/OpenBot.AppImage",
        userDataPath: "/home/jane/.config/OpenBot",
      };

      expect(cuaDriverCommandAlias(onAppImage)).toBe("/home/jane/.config/OpenBot/cua-driver/cua-driver");
      expect(cuaDriverCommandAlias({ ...onAppImage, appImagePath: "  " })).toBeNull();
      expect(cuaDriverCommandAlias({ ...onAppImage, isPackaged: false })).toBeNull();
      expect(cuaDriverCommandAlias({ ...onAppImage, platform: "darwin" })).toBeNull();
    });

    it("gives the proxies the link, and the link the driver of this run", async () => {
      const profile = await mkdtemp(join(tmpdir(), "cua-profile-"));
      directories.push(profile);
      const alias = join(profile, "cua-driver", "cua-driver");
      const { driver } = await runtime({ commandAlias: alias, executable: process.execPath });

      await driver.start();

      expect(driver.mcpServerConfig()?.command).toBe(alias);
      expect(await realpath(alias)).toBe(await realpath(process.execPath));

      await driver.stop();
    });
  });
});
