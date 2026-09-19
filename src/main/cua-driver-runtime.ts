// The Computer Use driver: one long-lived daemon this process owns, and the MCP entry the
// providers spawn against it.

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
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
 * The most a Unix socket path may hold.
 *
 * `sockaddr_un.sun_path` is 104 bytes on macOS, the last of them the terminator, and the kernel
 * answers a longer path with `EINVAL` rather than anything that names the real cause. The user data
 * directory is far too deep to hold the socket: an isolated development profile alone spends 64
 * characters on the worktree hash. So the socket lives in the per-user temporary directory, which
 * macOS already creates for this user alone, and this limit is checked before the connection.
 */
const MAX_SOCKET_PATH_LENGTH = 103;
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
 * The driver reads this variable as the exact string `1`.
 */
const EMBEDDED_ENV = "CUA_DRIVER_EMBEDDED";
const HOST_BUNDLE_ID_ENV = "CUA_DRIVER_HOST_BUNDLE_ID";

/** The two grants the driver needs, in the order the panel lists them. */
const REQUIRED_PERMISSIONS: readonly MacPermissionId[] = ["screen-recording", "accessibility"];

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

export interface CuaDriverRuntimeOptions {
  /** The resolved executable, or `null` when this computer has none. */
  executable: string | null;
  /**
   * Where the control socket goes. It must be private to this user and short.
   *
   * Private, because the socket is a control channel to a process that can drive the whole desktop.
   * Short, because of `MAX_SOCKET_PATH_LENGTH`. The per-user temporary directory is both.
   */
  socketDirectory: string;
  /** Advisory only. The driver logs it; it is not a trust signal, so nothing may treat it as one. */
  hostBundleId: string;
  platform: NodeJS.Platform;
  spawnProcess?: SpawnDriverProcess;
  onDiagnostic?: (message: string) => void;
  /** Injected by the test, which has no driver to ask. */
  readPermissions?: (config: McpServerConfig) => Promise<readonly ComputerUsePermission[]>;
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

  socketPath(): string {
    return join(this.#options.socketDirectory, SOCKET_FILE);
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
      envPassthrough: ["HOME", "USER", "TMPDIR"],
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
    if (this.#options.platform !== "darwin") return this.#publish(initialState(this.#options));
    if (!this.#options.executable) return this.#publish(initialState(this.#options));

    try {
      await this.start();
    } catch (error) {
      return this.#publish({
        status: "error",
        permissions: ungranted(),
        message: `The Computer Use driver did not start. ${describe(error)}`,
      });
    }

    const config = this.mcpServerConfig();
    if (!config) {
      return this.#publish({
        status: "error",
        permissions: ungranted(),
        message: "The Computer Use driver stopped before it could answer.",
      });
    }

    try {
      const permissions = await (this.#options.readPermissions ?? readPermissionsOverMcp)(config);
      const granted = REQUIRED_PERMISSIONS.every((id) => permissions.some((p) => p.id === id && p.granted));
      return this.#publish({
        status: granted ? "ready" : "permissions-required",
        permissions,
        message: null,
      });
    } catch (error) {
      return this.#publish({
        status: "error",
        permissions: ungranted(),
        message: `The Computer Use driver did not answer. ${describe(error)}`,
      });
    }
  }

  async #start(): Promise<void> {
    const executable = this.#options.executable;
    if (!executable) throw new Error("This computer has no Computer Use driver.");

    const socketPath = this.socketPath();
    if (socketPath.length > MAX_SOCKET_PATH_LENGTH) {
      throw new Error(
        `The Computer Use socket path is ${socketPath.length} characters, and macOS allows ${MAX_SOCKET_PATH_LENGTH}.`,
      );
    }

    // `0o700`, because the socket inside is a control channel to a process that can drive the whole
    // desktop. The per-user temporary directory is already private; this keeps it private if the
    // caller ever names somewhere else.
    await mkdir(this.#options.socketDirectory, { recursive: true, mode: 0o700 });
    await this.#removeSocket();
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
        permissions: ungranted(),
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
    // A socket left by a previous run refuses the bind, so it goes before the daemon starts.
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

function initialState(options: Pick<CuaDriverRuntimeOptions, "platform" | "executable">): ComputerUseState {
  if (options.platform !== "darwin") {
    return {
      status: "unsupported",
      permissions: ungranted(),
      message: "Computer Use is available on macOS.",
    };
  }
  if (!options.executable) {
    return {
      status: "driver-missing",
      permissions: ungranted(),
      message: "Install the Computer Use driver, then check again.",
    };
  }
  return { status: "permissions-required", permissions: ungranted(), message: null };
}

function ungranted(): ComputerUsePermission[] {
  return REQUIRED_PERMISSIONS.map((id) => ({ id, granted: false }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Asks the driver which grants macOS has given it, over one short-lived MCP connection. */
async function readPermissionsOverMcp(config: McpServerConfig): Promise<readonly ComputerUsePermission[]> {
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
    const result = await client.callTool({ name: "check_permissions", arguments: {} }, undefined, {
      signal: timer.signal,
    });
    return readPermissionResult(result);
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
export function readPermissionResult(result: unknown): ComputerUsePermission[] {
  const structured = isDynamicRecord(result) ? result.structuredContent : undefined;
  const source: DynamicRecord = isDynamicRecord(structured) ? structured : isDynamicRecord(result) ? result : {};
  return REQUIRED_PERMISSIONS.map((id) => ({ id, granted: grantedIn(source, id) }));
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
