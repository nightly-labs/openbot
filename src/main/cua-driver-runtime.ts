// The Computer Use driver: one long-lived daemon this process owns, and the MCP entry the
// providers spawn against it.

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { lstat, mkdir, rm } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  type ComputerUsePermission,
  type ComputerUseState,
  type MacPermissionId,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { stopRemoteProcess } from "./remote-diagnostics";

const SOCKET_FILE = "driver.sock";
/**
 * The most a Unix socket path may hold, per platform.
 *
 * `sockaddr_un.sun_path` is 104 bytes on macOS and 108 on Linux, the last of them the terminator,
 * and the kernel answers a longer path with `EINVAL` rather than anything that names the real
 * cause. The user data directory is far too deep to hold the socket: an isolated development
 * profile alone spends 64 characters on the worktree hash. So the socket lives in a per-user
 * runtime directory, and the length is checked before the daemon is started.
 *
 * Windows has no such limit. A named pipe is a name in a kernel namespace rather than a path on
 * disk, so nothing there is measured.
 */
const MAX_SOCKET_PATH_LENGTH: Readonly<Partial<Record<NodeJS.Platform, number>>> = {
  darwin: 103,
  linux: 107,
};
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 200;
const PERMISSION_TIMEOUT_MS = 10_000;

/**
 * Embedded mode, which is what makes the grant OpenBot's own.
 *
 * macOS attributes a permission to the responsible process, which it finds by walking up the
 * launch chain. Spawning the daemon directly from this process puts OpenBot at the top of that
 * chain, so the user grants Accessibility and Screen Recording to OpenBot rather than to a helper
 * signed by somebody else. Launching it through `open(1)` or `NSWorkspace` would hand the chain to
 * `launchd` instead and break the attribution, so nothing here may do that.
 *
 * Windows and Linux have no equivalent to grant, so there the variable only tells the driver that
 * its lifetime belongs to this process.
 *
 * The driver reads this variable as the exact string `1`.
 */
const EMBEDDED_ENV = "CUA_DRIVER_EMBEDDED";
const HOST_BUNDLE_ID_ENV = "CUA_DRIVER_HOST_BUNDLE_ID";

/**
 * The grants the driver needs, in the order the panel lists them.
 *
 * Only macOS has any. Windows and Linux put no permission between a program and the desktop it is
 * already running on, so there the list is empty and a driver that answers is a driver that is
 * ready. An empty list must never read as "nothing granted yet": the panel shows rows only when
 * this list has entries.
 */
const REQUIRED_PERMISSIONS: Readonly<Partial<Record<NodeJS.Platform, readonly MacPermissionId[]>>> = {
  darwin: ["screen-recording", "accessibility"],
};

/**
 * Exactly the spawn this class performs, rather than every overload `child_process` carries.
 *
 * Narrow on purpose: a test supplies its own, and a wider type would make it write an assertion to
 * satisfy overloads this code never uses.
 */
export interface SpawnDriverOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "pipe", "pipe"];
  windowsHide: boolean;
}

export type SpawnDriverProcess = (
  command: string,
  args: readonly string[],
  options: SpawnDriverOptions,
) => ChildProcess;

/**
 * The variables the proxy inherits from this machine, named per desktop.
 *
 * The proxy is a short-lived client of the daemon, so it needs only enough to start and to find a
 * temporary directory. Windows needs `SystemRoot`: a process started without it cannot load the
 * system libraries it links against. A name this machine does not hold is skipped, so nothing here
 * invents a value.
 */
const ENVIRONMENT_PASSTHROUGH: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: ["SystemRoot", "windir", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"],
};

/** The POSIX set, which macOS and Linux share. */
const POSIX_ENVIRONMENT_PASSTHROUGH: readonly string[] = ["HOME", "USER", "TMPDIR"];

function environmentPassthrough(platform: NodeJS.Platform): readonly string[] {
  return ENVIRONMENT_PASSTHROUGH[platform] ?? POSIX_ENVIRONMENT_PASSTHROUGH;
}

/**
 * Where the daemon listens, which is a different kind of thing on each desktop.
 *
 * Both forms are passed to the driver as `--socket`, and both are what `net.connect` takes, so the
 * only code that cares about the difference is the code that creates and removes them.
 */
export type CuaDriverEndpoint =
  | {
      /**
       * A Unix domain socket in a directory private to this user.
       *
       * Private, because the socket is a control channel to a process that can drive the whole
       * desktop. Short, because of `MAX_SOCKET_PATH_LENGTH`.
       */
      kind: "unix-socket";
      directory: string;
    }
  | {
      /**
       * A Windows named pipe.
       *
       * Windows gives a pipe a security descriptor rather than a directory mode, and the default
       * one already denies every other user, so there is nothing here to create or to remove.
       */
      kind: "windows-pipe";
      name: string;
    };

export interface CuaDriverRuntimeOptions {
  /** The resolved executable, or `null` when this computer has none. */
  executable: string | null;
  endpoint: CuaDriverEndpoint;
  /**
   * Whether the driver is published for this computer at all, which is not whether it is installed.
   *
   * Separate from `executable`, because the two mean different things to the user: an unsupported
   * computer has nothing to install, and a supported one without a binary has an install command.
   */
  supported: boolean;
  /** Advisory only. The driver logs it; it is not a trust signal, so nothing may treat it as one. */
  hostBundleId: string;
  platform: NodeJS.Platform;
  spawnProcess?: SpawnDriverProcess;
  onDiagnostic?: (message: string) => void;
  /** Injected by the test, which has no driver to ask. */
  readPermissions?: (config: McpServerConfig, platform: NodeJS.Platform) => Promise<readonly ComputerUsePermission[]>;
  waitForSocket?: (path: string) => Promise<void>;
}

export class CuaDriverRuntime {
  readonly #options: CuaDriverRuntimeOptions;
  readonly #spawn: SpawnDriverProcess;
  readonly #listeners = new Set<(state: ComputerUseState) => void>();
  #child: ChildProcess | null = null;
  #starting: Promise<void> | null = null;
  #state: ComputerUseState;

  constructor(options: CuaDriverRuntimeOptions) {
    this.#options = options;
    this.#spawn = options.spawnProcess ?? nodeSpawn;
    this.#state = initialState(options);
  }

  get lastState(): ComputerUseState {
    return this.#state;
  }

  running(): boolean {
    return this.#child !== null && this.#child.exitCode === null;
  }

  /** The address the daemon listens on and every client connects to. */
  socketPath(): string {
    const endpoint = this.#options.endpoint;
    return endpoint.kind === "windows-pipe" ? endpoint.name : join(endpoint.directory, SOCKET_FILE);
  }

  /**
   * What the providers are handed, or `null` while there is nothing to hand them.
   *
   * The command is absolute, so `resolveMcpCommand` accepts it without a login shell. The working
   * directory stays empty on purpose: ACP has no field for one and Codex accepts none, so both
   * would drop this entry with no error if it carried one.
   */
  mcpServerConfig(): McpServerConfig | null {
    const executable = this.#options.executable;
    if (!executable || !this.running()) return null;
    return {
      id: COMPUTER_USE_MCP_SERVER_ID,
      name: COMPUTER_USE_MCP_SERVER_NAME,
      transport: "stdio",
      enabled: true,
      command: executable,
      args: ["mcp", "--socket", this.socketPath()],
      env: [{ key: EMBEDDED_ENV, value: "1" }],
      envPassthrough: [...environmentPassthrough(this.#options.platform)],
      workingDirectory: "",
      url: "",
      headers: [],
    };
  }

  onStateChanged(listener: (state: ComputerUseState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The daemon, started once however many callers ask at the same time.
   *
   * Starting is what makes macOS ask for the grants, so nothing starts it before the user opens the
   * Computer Use panel or an agent reaches for the tools.
   */
  async start(): Promise<void> {
    if (this.running()) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start();
    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    if (child) await stopRemoteProcess(child);
    await this.#removeSocket();
  }

  /** The panel's answer: starts the daemon if it is not running, then asks it what it may do. */
  async state(): Promise<ComputerUseState> {
    if (!this.#options.supported || !this.#options.executable) return this.#publish(initialState(this.#options));

    try {
      await this.start();
    } catch (error) {
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: `The Computer Use driver did not start. ${describe(error)}`,
      });
    }

    const config = this.mcpServerConfig();
    if (!config) {
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: "The Computer Use driver stopped before it could answer.",
      });
    }

    try {
      const required = requiredPermissions(this.#options.platform);
      const permissions = await (this.#options.readPermissions ?? readPermissionsOverMcp)(
        config,
        this.#options.platform,
      );
      const granted = required.every((id) => permissions.some((p) => p.id === id && p.granted));
      return this.#publish({
        status: granted ? "ready" : "permissions-required",
        permissions,
        message: null,
      });
    } catch (error) {
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: `The Computer Use driver did not answer. ${describe(error)}`,
      });
    }
  }

  async #start(): Promise<void> {
    const executable = this.#options.executable;
    if (!executable) throw new Error("This computer has no Computer Use driver.");

    const socketPath = this.socketPath();
    const endpoint = this.#options.endpoint;
    if (endpoint.kind === "unix-socket") {
      const limit = MAX_SOCKET_PATH_LENGTH[this.#options.platform];
      if (limit !== undefined && socketPath.length > limit) {
        throw new Error(
          `The Computer Use socket path is ${socketPath.length} characters, and this system allows ${limit}.`,
        );
      }

      // `0o700`, because the socket inside is a control channel to a process that can drive the
      // whole desktop. The per-user runtime directory is already private; this keeps it private if
      // the caller ever names somewhere else. The mode applies only to a directory this call
      // creates, which is why what is already there is inspected below rather than trusted.
      await mkdir(endpoint.directory, { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(endpoint.directory);
      await this.#removeSocket();
    }
    const child = this.#spawn(executable, ["serve", "--socket", socketPath], {
      cwd: dirname(executable),
      env: {
        ...process.env,
        [EMBEDDED_ENV]: "1",
        [HOST_BUNDLE_ID_ENV]: this.#options.hostBundleId,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    this.#pipeDiagnostics(child);
    child.once("exit", (code) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#options.onDiagnostic?.(`OpenBot: the Computer Use driver stopped with code ${code ?? "unknown"}.\n`);
      this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: "The Computer Use driver stopped.",
      });
    });

    try {
      await (this.#options.waitForSocket ?? waitForSocket)(socketPath);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async #removeSocket(): Promise<void> {
    // A socket file left by a previous run refuses the bind, so it goes before the daemon starts.
    // A Windows pipe has no file: it is released when the process that owns it exits.
    if (this.#options.endpoint.kind !== "unix-socket") return;
    await rm(this.socketPath(), { force: true }).catch(() => undefined);
  }

  #pipeDiagnostics(child: ChildProcess): void {
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => this.#options.onDiagnostic?.(chunk.toString("utf8")));
    }
  }

  #publish(state: ComputerUseState): ComputerUseState {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
    return state;
  }
}

function initialState(
  options: Pick<CuaDriverRuntimeOptions, "platform" | "executable" | "supported">,
): ComputerUseState {
  if (!options.supported) {
    return {
      status: "unsupported",
      permissions: ungranted(options.platform),
      message: "Computer Use is available on macOS, Windows and Linux.",
    };
  }
  if (!options.executable) {
    return {
      status: "driver-missing",
      permissions: ungranted(options.platform),
      message: "Install the Computer Use driver, then check again.",
    };
  }
  return { status: "permissions-required", permissions: ungranted(options.platform), message: null };
}

function requiredPermissions(platform: NodeJS.Platform): readonly MacPermissionId[] {
  return REQUIRED_PERMISSIONS[platform] ?? [];
}

function ungranted(platform: NodeJS.Platform): ComputerUsePermission[] {
  return requiredPermissions(platform).map((id) => ({ id, granted: false }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Refuses a socket directory this user does not privately own.
 *
 * `mkdir` succeeds without complaint when the directory is already there, and applies its mode only
 * to one it creates. On a shared temporary directory another local user can therefore put ours in
 * place first, and then read or replace the socket a process that drives the whole desktop listens
 * on. Anything not owned by this user, or writable by anyone else, is refused rather than used.
 *
 * Windows reaches none of this: a named pipe has a security descriptor rather than a directory.
 */
async function assertPrivateDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`The Computer Use socket directory ${directory} is not a directory.`);
  }
  // `getuid` is absent on Windows, which never calls this.
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(`The Computer Use socket directory ${directory} belongs to another user.`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`The Computer Use socket directory ${directory} is open to other users.`);
  }
}

/**
 * Waits until the daemon accepts on its socket.
 *
 * The file appearing is not enough: the driver creates it and then binds, so a client that connects
 * between the two is refused. Connecting is the only condition that means "ready".
 */
async function waitForSocket(path: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect(path);
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }
  throw new Error(`It did not accept a connection in ${READY_TIMEOUT_MS / 1000} seconds. ${describe(lastError)}`);
}

/**
 * Asks the driver what it may do, over one short-lived MCP connection.
 *
 * Only macOS has a grant to report. Elsewhere the question is simply whether the daemon answers, so
 * the tool list is the probe: it proves the same connection without assuming a tool that a
 * non-macOS build may not publish.
 */
async function readPermissionsOverMcp(
  config: McpServerConfig,
  platform: NodeJS.Platform,
): Promise<readonly ComputerUsePermission[]> {
  const client = new Client({ name: "openbot-computer-use", version: "1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...getDefaultEnvironment(), [EMBEDDED_ENV]: "1" },
    stderr: "ignore",
  });
  const timer = new AbortController();
  const deadline = setTimeout(() => timer.abort(), PERMISSION_TIMEOUT_MS);
  try {
    await client.connect(transport);
    if (requiredPermissions(platform).length === 0) {
      await client.listTools(undefined, { signal: timer.signal });
      return [];
    }
    const result = await client.callTool({ name: "check_permissions", arguments: {} }, undefined, {
      signal: timer.signal,
    });
    return readPermissionResult(result, platform);
  } finally {
    clearTimeout(deadline);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

/**
 * The grants inside a `check_permissions` answer.
 *
 * The driver reports its own names for the two, so this reads both what macOS calls them and what
 * the driver does. Anything it does not recognise counts as not granted, which keeps a driver
 * release that renames a field from reporting a permission the user never gave.
 */
export function readPermissionResult(result: unknown, platform: NodeJS.Platform): ComputerUsePermission[] {
  const structured = isDynamicRecord(result) ? result.structuredContent : undefined;
  const source: DynamicRecord = isDynamicRecord(structured) ? structured : isDynamicRecord(result) ? result : {};
  return requiredPermissions(platform).map((id) => ({ id, granted: grantedIn(source, id) }));
}

function grantedIn(source: DynamicRecord, id: MacPermissionId): boolean {
  const keys =
    id === "screen-recording"
      ? ["screen_recording", "screenRecording", "screen_capture", "screenCapture"]
      : ["accessibility"];
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "granted" || value === "authorized";
    if (isDynamicRecord(value) && typeof value.granted === "boolean") return value.granted;
  }
  return false;
}
