import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
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
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Result, Semaphore } from "effect";
import { agentDisplayEnvironment } from "./agent-display";
import { CuaDriverActionTap, type ObservedAction, type ObservedPointer } from "./cua-driver-action-tap";
import { CUA_DRIVER_VENDOR_CALLS_OFF } from "./cua-driver-artifact";
import { CuaDriverFailure, cuaIO, cuaSync, toCuaDriverFailure } from "./cua-driver-effects";
import { LifecycleGate } from "./lifecycle-gate";
import { forwardDiagnosticLines, stopRemoteProcess } from "./remote-diagnostics";

const SOCKET_FILE = "driver.sock";
const TAP_SOCKET_FILE = "tap.sock";
const PIPE_NAME_FILE = ["cua-driver", "pipe-name"] as const;
const MAX_SOCKET_PATH_LENGTH: Readonly<Partial<Record<NodeJS.Platform, number>>> = {
  darwin: 103,
  linux: 107,
};
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 200;
const ORPHAN_STOP_TIMEOUT_MS = 2_000;
const PERMISSION_TIMEOUT_MS = 10_000;
const WAYLAND_INPUT_CHECK_TIMEOUT_MS = 4_000;
const WAYLAND_BACKEND_CHECK = "wayland_backend";
const RECHECK_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
const RECHECK_STABLE_MS = 5 * 60_000;

const EMBEDDED_ENV = "CUA_DRIVER_EMBEDDED";
const PARENT_LIVENESS_ENV = "CUA_DRIVER_PARENT_LIVENESS_STDIN";
const HOST_BUNDLE_ID_ENV = "CUA_DRIVER_HOST_BUNDLE_ID";
const WAYLAND_ENV = "CUA_DRIVER_RS_ENABLE_WAYLAND";
const KEEP_DISPLAY_AWAKE_ENV = "CUA_DRIVER_KEEP_DISPLAY_AWAKE";

const REQUIRED_PERMISSIONS: Readonly<Partial<Record<NodeJS.Platform, readonly MacPermissionId[]>>> = {
  darwin: ["screen-recording", "accessibility"],
};

interface SpawnDriverOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  windowsHide: boolean;
}

export type SpawnDriverProcess = (
  command: string,
  args: readonly string[],
  options: SpawnDriverOptions,
) => ChildProcess;

const ENVIRONMENT_PASSTHROUGH: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: ["SystemRoot", "windir", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"],
};

const POSIX_ENVIRONMENT_PASSTHROUGH: readonly string[] = ["HOME", "USER", "TMPDIR"];

function environmentPassthrough(platform: NodeJS.Platform): readonly string[] {
  return ENVIRONMENT_PASSTHROUGH[platform] ?? POSIX_ENVIRONMENT_PASSTHROUGH;
}

export type CuaDriverEndpoint =
  | {
      kind: "unix-socket";
      directory: string;
    }
  | {
      kind: "windows-pipe";
      name: string;
    };

export interface CuaDriverEndpointInput {
  platform: NodeJS.Platform;
  userDataPath: string;
  temporaryDirectory: string;
  runtimeDirectory?: string | null | undefined;
}

export const resolveCuaDriverEndpoint = Effect.fn("CuaDriver.endpoint")(function* (
  input: CuaDriverEndpointInput,
): Effect.fn.Return<CuaDriverEndpoint, CuaDriverFailure> {
  if (input.platform === "win32") return { kind: "windows-pipe", name: yield* windowsPipeName(input.userDataPath) };
  const runtimeDirectory = input.runtimeDirectory?.trim();
  const parent =
    input.platform === "linux" && runtimeDirectory && isAbsolute(runtimeDirectory)
      ? runtimeDirectory
      : input.temporaryDirectory;
  const digest = createHash("sha256").update(input.userDataPath).digest("hex").slice(0, 12);
  return { kind: "unix-socket", directory: join(parent, `openbot-cua-${digest}`) };
});

const WINDOWS_PIPE_NAME = /^\\\\\.\\pipe\\openbot-cua-[0-9a-f-]{36}$/;

const windowsPipeName = Effect.fn("CuaDriver.windowsPipeName")(function* (userDataPath: string) {
  const file = join(userDataPath, ...PIPE_NAME_FILE);
  const stored = yield* cuaIO(() => readFile(file, "utf8")).pipe(
    Effect.map((text) => text.trim()),
    Effect.catch(() => Effect.succeed("")),
  );
  if (WINDOWS_PIPE_NAME.test(stored)) return stored;
  const name = `\\\\.\\pipe\\openbot-cua-${randomUUID()}`;
  yield* cuaIO(() => mkdir(dirname(file), { recursive: true, mode: 0o700 }));
  yield* cuaIO(() => writeFile(file, name, { mode: 0o600 }));
  return name;
});

export interface CuaDriverCommandAliasInput {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  appImagePath?: string | null | undefined;
  userDataPath: string;
}

export function cuaDriverCommandAlias(input: CuaDriverCommandAliasInput): string | null {
  if (input.platform !== "linux" || !input.isPackaged || !input.appImagePath?.trim()) return null;
  return join(input.userDataPath, "cua-driver", "cua-driver");
}

export interface CuaDriverRuntimeOptions {
  executable: string | null;
  resolveExecutable?: () => Effect.Effect<string | null, CuaDriverFailure>;
  commandAlias?: string | null;
  endpoint: CuaDriverEndpoint;
  supported: boolean;
  hostBundleId: string;
  platform: NodeJS.Platform;
  spawnProcess?: SpawnDriverProcess;
  onDiagnostic?: (message: string) => void;
  readPermissions?: (config: McpServerConfig, platform: NodeJS.Platform) => Promise<readonly ComputerUsePermission[]>;
  waitForSocket?: (path: string) => Promise<void>;
  actionTap?: CuaDriverActionTap;
  quitting?: () => boolean;
}

export class CuaDriverRuntime {
  readonly #options: CuaDriverRuntimeOptions;
  readonly #spawn: SpawnDriverProcess;
  readonly #listeners = new Set<(state: ComputerUseState) => void>();
  readonly #mcpListeners = new Set<() => void>();
  #announcedMcpServer = "";
  #quiet = false;
  #command: string | null = null;
  #child: ChildProcess | null = null;
  readonly #lifecycle = new LifecycleGate<void, CuaDriverFailure>();
  #state: ComputerUseState;
  #executable: string | null;
  readonly #tap: CuaDriverActionTap;
  #waylandInputRefused = false;
  #restartRequired = false;
  #recheckTimer: ReturnType<typeof setTimeout> | null = null;
  #recheckAttempt = 0;
  #readySince: number | null = null;

  constructor(options: CuaDriverRuntimeOptions) {
    this.#options = options;
    this.#spawn = options.spawnProcess ?? nodeSpawn;
    this.#executable = options.executable;
    this.#tap = options.actionTap ?? new CuaDriverActionTap();
    this.#tap.onAccessibilityRefused(() => this.#requireRestart());
    this.#state = initialState(options.platform, options.supported, options.executable);
  }

  get lastState(): ComputerUseState {
    return this.#state;
  }

  waylandInputRefused(): boolean {
    return this.#waylandInputRefused;
  }

  running(): boolean {
    return this.#child !== null && this.#child.exitCode === null;
  }

  socketPath(): string {
    const endpoint = this.#options.endpoint;
    return endpoint.kind === "windows-pipe" ? endpoint.name : join(endpoint.directory, SOCKET_FILE);
  }

  tapAddress(): string {
    return this.#tap.address ?? this.socketPath();
  }

  lastAction(maxAgeMs: number): ObservedAction | null {
    return this.#tap.lastAction(maxAgeMs);
  }

  lastPointer(maxAgeMs: number): ObservedPointer | null {
    return this.#tap.lastPointer(maxAgeMs);
  }

  onToolCall(listener: () => void): void {
    this.#tap.onToolCall(listener);
  }

  mcpServerConfig(): McpServerConfig | null {
    const command = this.#command ?? this.#executable;
    if (!command || !this.running()) return null;
    return {
      id: COMPUTER_USE_MCP_SERVER_ID,
      name: COMPUTER_USE_MCP_SERVER_NAME,
      transport: "stdio",
      enabled: true,
      command,
      args: ["mcp", "--socket", this.tapAddress()],
      env: [
        { key: EMBEDDED_ENV, value: "1" },
        ...Object.entries(CUA_DRIVER_VENDOR_CALLS_OFF).map(([key, value]) => ({ key, value })),
      ],
      envPassthrough: [...environmentPassthrough(this.#options.platform)],
      workingDirectory: "",
      url: "",
      headers: [],
    };
  }

  mcpServerForProviders(): McpServerConfig | null {
    return this.#state.status === "ready" ? this.mcpServerConfig() : null;
  }

  onStateChanged(listener: (state: ComputerUseState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onMcpServerChanged(listener: () => void): () => void {
    this.#mcpListeners.add(listener);
    return () => this.#mcpListeners.delete(listener);
  }

  start(): Effect.Effect<void, CuaDriverFailure> {
    return this.#lifecycle.start(() =>
      Effect.gen({ self: this }, function* () {
        if (this.running()) return;
        yield* this.#start();
        this.#announceMcpServer();
      }),
    );
  }

  stop(): Effect.Effect<void, CuaDriverFailure> {
    this.#cancelRecheck();
    return this.#lifecycle.stop(() => this.#stop());
  }

  readonly #checks = Semaphore.makeUnsafe(1);

  state(): Effect.Effect<ComputerUseState, CuaDriverFailure> {
    return this.#checks.withPermit(this.#check());
  }

  readonly #check = Effect.fn("CuaDriver.state")(function* (
    this: CuaDriverRuntime,
  ): Effect.fn.Return<ComputerUseState, CuaDriverFailure> {
    if (!this.#options.supported) return this.#publish(this.#initialState());
    if (!this.#executable) {
      const resolve = this.#options.resolveExecutable;
      this.#executable = resolve ? yield* resolve() : null;
    }
    if (!this.#executable) return this.#publish(this.#initialState());
    const started = yield* Effect.result(this.start());
    if (Result.isFailure(started))
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: sourceText("status.computerUse.driverNotStarted", { reason: describe(started.failure.cause) }),
      });
    const config = this.mcpServerConfig();
    if (!config)
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: sourceText("status.computerUse.driverStoppedBeforeAnswer"),
      });
    const injected = this.#options.readPermissions;
    const result = yield* Effect.result(
      injected
        ? cuaIO(() => injected(config, this.#options.platform)).pipe(
            Effect.map((permissions) => ({ permissions, waylandInputRefused: false })),
          )
        : readPermissionsOverMcpEffect(config, this.#options.platform),
    );
    if (Result.isFailure(result))
      return this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: sourceText("status.computerUse.driverNoAnswer", { reason: describe(result.failure.cause) }),
      });
    const { permissions, waylandInputRefused } = result.success;
    this.#waylandInputRefused = waylandInputRefused;
    const granted = requiredPermissions(this.#options.platform).every((id) =>
      permissions.some((p) => p.id === id && p.granted),
    );
    const state = this.#publish(
      !granted
        ? { status: "permissions-required", permissions, message: null }
        : this.#restartRequired
          ? restartRequiredState(permissions)
          : { status: "ready", permissions, message: null },
    );
    if (!granted) yield* this.stop().pipe(Effect.catch(() => Effect.void));
    return state;
  }).bind(this);

  readonly warmUp = Effect.fn("CuaDriver.warmUp")(function* (this: CuaDriverRuntime) {
    if (!this.#options.supported) return;
    this.#quiet = true;
    yield* Effect.gen({ self: this }, function* () {
      const state = yield* this.state();
      if (state.status !== "ready") yield* this.stop().pipe(Effect.catch(() => Effect.void));
      if (state.status === "error") this.#scheduleRecheck();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#quiet = false;
        }),
      ),
    );
  }).bind(this);

  #stop = Effect.fn("CuaDriver.stop")(function* (this: CuaDriverRuntime): Effect.fn.Return<void, CuaDriverFailure> {
    const child = this.#child;
    this.#child = null;
    yield* this.#tap.close();
    if (child) yield* stopRemoteProcess(child).pipe(toCuaDriverFailure);
    yield* this.#removeSocket();
    this.#announcedMcpServer = "";
  });

  #start = Effect.fn("CuaDriver.start")(function* (this: CuaDriverRuntime): Effect.fn.Return<void, CuaDriverFailure> {
    const executable = this.#executable;
    if (!executable) return yield* new CuaDriverFailure({ cause: new Error(sourceText("error.computerUse.noDriver")) });

    const socketPath = this.socketPath();
    const endpoint = this.#options.endpoint;
    if (endpoint.kind === "unix-socket") {
      const limit = MAX_SOCKET_PATH_LENGTH[this.#options.platform];
      if (limit !== undefined && socketPath.length > limit) {
        return yield* new CuaDriverFailure({
          cause: new Error(sourceText("error.computerUse.socketPathTooLong", { length: socketPath.length, limit })),
        });
      }

      yield* cuaIO(() => mkdir(endpoint.directory, { recursive: true, mode: 0o700 }));
      yield* assertPrivateDirectoryEffect(endpoint.directory);
    }
    yield* this.#stopOrphanedDaemon(socketPath);
    yield* this.#removeSocket();
    this.#command = yield* this.#linkCommandAlias(executable);
    const child = yield* cuaSync(() =>
      this.#spawn(executable, ["serve", "--socket", socketPath, "--no-overlay"], {
        cwd: dirname(executable),
        env: {
          ...process.env,
          ...agentDisplayEnvironment(this.#options.platform),
          [EMBEDDED_ENV]: "1",
          [PARENT_LIVENESS_ENV]: "1",
          ...CUA_DRIVER_VENDOR_CALLS_OFF,
          [HOST_BUNDLE_ID_ENV]: this.#options.hostBundleId,
          ...waylandEnvironment(this.#options.platform),
          ...displayAwakeEnvironment(this.#options.platform),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    this.#child = child;
    this.#pipeDiagnostics(child);
    const spawnFailure = Deferred.makeUnsafe<never, CuaDriverFailure>();
    child.once("error", (error: Error) => {
      if (this.#child === child) this.#child = null;
      this.#options.onDiagnostic?.(`OpenBot: the Computer Use driver could not start. ${error.message}\n`);
      Deferred.doneUnsafe(spawnFailure, Exit.fail(new CuaDriverFailure({ cause: error })));
    });
    child.once("exit", (code) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#options.onDiagnostic?.(`OpenBot: the Computer Use driver stopped with code ${code ?? "unknown"}.\n`);
      this.#announceMcpServer();
      this.#publish({
        status: "error",
        permissions: ungranted(this.#options.platform),
        message: sourceText("status.computerUse.driverStopped"),
      });
      this.#scheduleRecheck();
    });

    const ready = yield* Effect.result(
      Effect.raceFirst(waitForDriverSocket(this.#options.waitForSocket, socketPath), Deferred.await(spawnFailure)),
    );
    if (Result.isFailure(ready)) {
      yield* this.#stop();
      return yield* ready.failure;
    }
    yield* this.#startTap(socketPath);
  });

  #startTap = Effect.fn("CuaDriver.startTap")(function* (
    this: CuaDriverRuntime,
    socketPath: string,
  ): Effect.fn.Return<void, CuaDriverFailure> {
    const endpoint = this.#options.endpoint;
    const address =
      endpoint.kind === "windows-pipe" ? `${endpoint.name}-tap` : join(endpoint.directory, TAP_SOCKET_FILE);
    yield* this.#tap.close();
    if (endpoint.kind === "unix-socket") yield* cuaIO(() => rm(address, { force: true }).catch(() => undefined));
    const listening = yield* Effect.result(this.#tap.listen({ upstream: socketPath, tap: address }));
    if (Result.isFailure(listening))
      this.#options.onDiagnostic?.(
        `OpenBot: the Computer Use tap could not listen. ${describe(listening.failure.cause)}\n`,
      );
  });

  #stopOrphanedDaemon = Effect.fn("CuaDriver.stopOrphanedDaemon")(function* (
    this: CuaDriverRuntime,
    socketPath: string,
  ): Effect.fn.Return<void, CuaDriverFailure> {
    if (!(yield* acceptsEffect(socketPath, `${JSON.stringify({ method: "shutdown" })}\n`))) return;
    this.#options.onDiagnostic?.("OpenBot: stopping a Computer Use driver that a previous run left running.\n");
    const deadline = Date.now() + ORPHAN_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      yield* Effect.sleep(READY_POLL_MS / 4);
      if (!(yield* acceptsEffect(socketPath))) return;
    }
    this.#options.onDiagnostic?.("OpenBot: the Computer Use driver left by a previous run did not stop.\n");
  });

  #removeSocket = Effect.fn("CuaDriver.removeSocket")(function* (
    this: CuaDriverRuntime,
  ): Effect.fn.Return<void, CuaDriverFailure> {
    if (this.#options.endpoint.kind !== "unix-socket") return;
    yield* cuaIO(() => rm(this.socketPath(), { force: true }).catch(() => undefined));
  });

  #pipeDiagnostics(child: ChildProcess): void {
    for (const stream of [child.stdout, child.stderr]) {
      forwardDiagnosticLines(stream, (text) => this.#options.onDiagnostic?.(text));
    }
  }

  #linkCommandAlias = Effect.fn("CuaDriver.linkCommandAlias")(function* (
    this: CuaDriverRuntime,
    executable: string,
  ): Effect.fn.Return<string, CuaDriverFailure> {
    const alias = this.#options.commandAlias;
    if (!alias) return executable;
    const linked = yield* Effect.result(
      Effect.gen(function* () {
        yield* cuaIO(() => mkdir(dirname(alias), { recursive: true, mode: 0o700 }));
        yield* cuaIO(() => rm(alias, { force: true }));
        yield* cuaIO(() => symlink(executable, alias));
      }),
    );
    if (Result.isFailure(linked)) {
      this.#options.onDiagnostic?.(
        `OpenBot: the Computer Use driver link could not be written. ${describe(linked.failure.cause)}\n`,
      );
      return executable;
    }
    return alias;
  });

  #requireRestart(): void {
    if (this.#restartRequired) return;
    this.#restartRequired = true;
    this.#options.onDiagnostic?.("OpenBot: macOS refused Accessibility to Computer Use (AXError -25211).\n");
    if (this.#state.status === "ready") this.#publish(restartRequiredState(this.#state.permissions));
  }

  #scheduleRecheck(): void {
    if (this.#recheckTimer || this.#options.quitting?.()) return;
    if (this.#readySince !== null && Date.now() - this.#readySince >= RECHECK_STABLE_MS) {
      this.#recheckAttempt = 0;
      this.#readySince = null;
    }
    const delay = RECHECK_DELAYS_MS[this.#recheckAttempt];
    if (delay === undefined) return;
    this.#recheckAttempt += 1;
    this.#recheckTimer = setTimeout(() => {
      this.#recheckTimer = null;
      if (this.#options.quitting?.()) return;
      Effect.runFork(
        this.state().pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              if (state.status === "error") this.#scheduleRecheck();
            }),
          ),
          Effect.catch(() => Effect.void),
        ),
      );
    }, delay);
    this.#recheckTimer.unref?.();
  }

  #cancelRecheck(): void {
    if (this.#recheckTimer) clearTimeout(this.#recheckTimer);
    this.#recheckTimer = null;
  }

  #announceMcpServer(): void {
    const config = this.mcpServerForProviders();
    const announced = config ? [config.command, ...config.args].join(" ") : "";
    if (announced === this.#announcedMcpServer) return;
    this.#announcedMcpServer = announced;
    if (this.#quiet || this.#options.quitting?.()) return;
    for (const listener of this.#mcpListeners) listener();
  }

  #initialState(): ComputerUseState {
    return initialState(this.#options.platform, this.#options.supported, this.#executable);
  }

  #publish(state: ComputerUseState): ComputerUseState {
    if (sameState(this.#state, state)) return this.#state;
    this.#state = state;
    if (state.status === "ready") this.#readySince = Date.now();
    for (const listener of this.#listeners) listener(state);
    this.#announceMcpServer();
    return state;
  }
}

function sameState(left: ComputerUseState, right: ComputerUseState): boolean {
  return (
    left.status === right.status &&
    left.message === right.message &&
    left.permissions.length === right.permissions.length &&
    left.permissions.every((permission, index) => {
      const other = right.permissions[index];
      return other !== undefined && other.id === permission.id && other.granted === permission.granted;
    })
  );
}

function initialState(platform: NodeJS.Platform, supported: boolean, executable: string | null): ComputerUseState {
  if (!supported) {
    return {
      status: "unsupported",
      permissions: ungranted(platform),
      message: sourceText("status.computerUse.unsupported"),
    };
  }
  if (!executable) {
    return {
      status: "driver-missing",
      permissions: ungranted(platform),
      message: sourceText("status.computerUse.driverMissing"),
    };
  }
  return { status: "permissions-required", permissions: ungranted(platform), message: null };
}

function restartRequiredState(permissions: readonly ComputerUsePermission[]): ComputerUseState {
  return { status: "restart-required", permissions, message: null };
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

function displayAwakeEnvironment(platform: NodeJS.Platform): Record<string, string> {
  return platform === "darwin" ? { [KEEP_DISPLAY_AWAKE_ENV]: "0" } : {};
}

function waylandEnvironment(platform: NodeJS.Platform): NodeJS.ProcessEnv {
  if (platform !== "linux" || process.env[WAYLAND_ENV] !== undefined) return {};
  return process.env.XDG_SESSION_TYPE === "wayland" ? { [WAYLAND_ENV]: "1" } : {};
}

export function cuaDriverDrivesWayland(platform: NodeJS.Platform): boolean {
  if (platform !== "linux" || !process.env.WAYLAND_DISPLAY) return false;
  const flag = (process.env[WAYLAND_ENV] ?? waylandEnvironment(platform)[WAYLAND_ENV] ?? "").trim();
  return flag !== "" && flag !== "0" && flag.toLowerCase() !== "false";
}

const assertPrivateDirectoryEffect = Effect.fn("CuaDriver.privateDirectory")(function* (directory: string) {
  const stats = yield* cuaIO(() => lstat(directory));
  if (!stats.isDirectory()) {
    return yield* new CuaDriverFailure({
      cause: new Error(sourceText("error.computerUse.socketDirectoryNotDirectory", { path: directory })),
    });
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    return yield* new CuaDriverFailure({
      cause: new Error(sourceText("error.computerUse.socketDirectoryOtherOwner", { path: directory })),
    });
  }
  if ((stats.mode & 0o077) !== 0) {
    return yield* new CuaDriverFailure({
      cause: new Error(sourceText("error.computerUse.socketDirectoryShared", { path: directory })),
    });
  }
});

const acceptsEffect = Effect.fn("CuaDriver.accepts")((path: string, message = "") =>
  Effect.callback<boolean>((resume) => {
    const socket = connect(path);
    socket.once("connect", () => {
      socket.end(message, () => {
        socket.destroy();
        resume(Effect.succeed(true));
      });
    });
    socket.on("error", () => {
      socket.destroy();
      resume(Effect.succeed(false));
    });
    return Effect.sync(() => {
      socket.destroy();
    });
  }).pipe(Effect.timeoutOrElse({ duration: READY_POLL_MS, orElse: () => Effect.succeed(false) })),
);

const waitForSocketEffect = Effect.fn("CuaDriver.waitForSocket")(function* (path: string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const result = yield* Effect.result(
      Effect.callback<void, CuaDriverFailure>((resume) => {
        const socket = connect(path);
        socket.once("connect", () => {
          socket.end();
          resume(Effect.void);
        });
        socket.on("error", (cause) => resume(Effect.fail(new CuaDriverFailure({ cause }))));
        return Effect.sync(() => {
          socket.destroy();
        });
      }).pipe(
        Effect.timeoutOrElse({
          duration: Math.max(1, deadline - Date.now()),
          orElse: () => Effect.fail(new CuaDriverFailure({ cause: new Error("Socket connection timed out") })),
        }),
      ),
    );
    if (Result.isSuccess(result)) return;
    lastError = result.failure.cause;
    yield* Effect.sleep(READY_POLL_MS);
  }
  return yield* new CuaDriverFailure({
    cause: new Error(
      sourceText("error.computerUse.socketNotReady", { seconds: READY_TIMEOUT_MS / 1000, reason: describe(lastError) }),
    ),
  });
});

const readPermissionsOverMcpEffect = Effect.fn("CuaDriver.permissions")(
  (config: McpServerConfig, platform: NodeJS.Platform) =>
    Effect.acquireUseRelease(
      cuaSync(() => ({
        client: new Client({ name: "openbot-computer-use", version: "1" }, { capabilities: {} }),
        transport: new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...getDefaultEnvironment(), [EMBEDDED_ENV]: "1", ...CUA_DRIVER_VENDOR_CALLS_OFF },
          stderr: "ignore",
        }),
        timer: new AbortController(),
      })),
      ({ client, transport, timer }) =>
        Effect.gen(function* () {
          yield* cuaIO((signal) => client.connect(transport, { signal: AbortSignal.any([signal, timer.signal]) }));
          if (requiredPermissions(platform).length === 0) {
            yield* cuaIO((signal) => client.listTools(undefined, { signal: AbortSignal.any([signal, timer.signal]) }));
            const waylandInputRefused = cuaDriverDrivesWayland(platform)
              ? yield* readWaylandInputRefusedEffect(client, timer.signal)
              : false;
            return { permissions: [], waylandInputRefused };
          }
          const result = yield* cuaIO((signal) =>
            client.callTool({ name: "check_permissions", arguments: {} }, undefined, {
              signal: AbortSignal.any([signal, timer.signal]),
            }),
          );
          return { permissions: readPermissionResult(result, platform), waylandInputRefused: false };
        }).pipe(
          Effect.timeoutOrElse({
            duration: PERMISSION_TIMEOUT_MS,
            orElse: () =>
              cuaSync(() => {
                timer.abort();
                throw timer.signal.reason;
              }),
          }),
        ),
      ({ client, transport, timer }) =>
        Effect.gen(function* () {
          timer.abort();
          yield* cuaIO(() => client.close()).pipe(Effect.catch(() => Effect.void));
          yield* cuaIO(() => transport.close()).pipe(Effect.catch(() => Effect.void));
        }),
    ),
);

const readWaylandInputRefusedEffect = Effect.fn("CuaDriver.waylandInput")((client: Client, abort: AbortSignal) =>
  cuaIO((signal) =>
    client.callTool({ name: "health_report", arguments: { include: [WAYLAND_BACKEND_CHECK] } }, undefined, {
      signal: AbortSignal.any([signal, abort]),
    }),
  ).pipe(
    Effect.map(waylandBackendFailed),
    Effect.timeoutOrElse({ duration: WAYLAND_INPUT_CHECK_TIMEOUT_MS, orElse: () => Effect.succeed(false) }),
    Effect.catch(() => Effect.succeed(false)),
  ),
);

function waylandBackendFailed(result: unknown): boolean {
  const structured = isDynamicRecord(result) ? result.structuredContent : undefined;
  const checks = isDynamicRecord(structured) ? structured.checks : undefined;
  return (
    Array.isArray(checks) &&
    checks.some((check) => isDynamicRecord(check) && check.name === WAYLAND_BACKEND_CHECK && check.status === "fail")
  );
}

function readPermissionResult(result: unknown, platform: NodeJS.Platform): ComputerUsePermission[] {
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

function waitForDriverSocket(
  injected: CuaDriverRuntimeOptions["waitForSocket"],
  path: string,
): Effect.Effect<void, CuaDriverFailure> {
  return injected ? cuaIO(() => injected(path)) : waitForSocketEffect(path);
}
