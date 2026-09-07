import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import {
  developmentInstanceIdForWorktree,
  developmentUserDataName,
  readDevelopmentInstanceId,
} from "../src/main/development-profile";
import {
  type DevInstanceRecord,
  removeDevInstanceRecord,
  writeDevInstanceRecord,
} from "./dev-automation/instance-registry";
import { withDevPortAllocation } from "./dev-automation/port-allocation";
import {
  conflictingDevStacks,
  type DevStackPort,
  type DevStackRecord,
  describeDevStack,
  heldDevStackPorts,
  removeDevStackRecord,
  writeDevStackRecord,
} from "./dev-automation/stack-registry";
import { prepareDevelopmentEnvironment } from "./prepare-dev-environment";

const logger = createOpenBotLogger("dev-services");

export type DevelopmentService = "api" | "remote" | "app" | "test-client";
type DevelopmentTarget = Exclude<DevelopmentService, "remote"> | "all";
type DevelopmentNetworkInterfaces = NodeJS.Dict<Array<Pick<NetworkInterfaceInfo, "address" | "family" | "internal">>>;

export interface DevelopmentServiceSpec {
  name: DevelopmentService;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

// A pid and whether it has been reaped is all the stop path needs, so
// `dev:stop` can pass a recorded pid it never spawned through the same code.
export type OwnedProcess = Pick<ChildProcess, "pid" | "exitCode">;
type KillProcess = (pid: number, signal?: NodeJS.Signals | number) => boolean;

// "group" is right for anything this runner spawned: those children are
// detached, so each leads its own group and its grandchildren - Electron
// helpers, the Vite worker, the Worker runtime - go with it. "process" is for a
// pid this runner did not spawn, which `dev:stop` passes for a supervisor it
// found in the registry: that process shares its group with whatever shell or
// `bun run` started it, and signalling the group would either miss it, because
// the group leader is somebody else, or reach the terminal job around it.
type SignalScope = "group" | "process";

interface StopOwnedProcessesOptions {
  platform?: NodeJS.Platform;
  killProcess?: KillProcess;
  timeoutMs?: number;
  pollIntervalMs?: number;
  scope?: SignalScope;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

export function developmentEnvironmentForTarget(
  target: DevelopmentTarget,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    OPENBOT_DEV_TEST_CLIENT_ENABLED: target === "test-client" ? "1" : "0",
  };
}

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
export const projectRoot = dirname(scriptsRoot);

const DEFAULT_API_PORT = 3_100;
const DEFAULT_REMOTE_SIGNAL_PORT = 3_101;
const DEFAULT_REMOTE_HEALTH_PORT = 3_102;
const DEFAULT_RENDERER_PORTS = {
  app: 5_173,
  "test-client": 5_174,
} as const;
const DEFAULT_REMOTE_DEBUGGING_PORTS = {
  app: 9_333,
  "test-client": 9_334,
} as const;

export function servicesForTarget(target: DevelopmentTarget): DevelopmentService[] {
  if (target === "all") return ["api", "remote", "app"];
  if (target === "test-client") return ["api", "remote", "app", "test-client"];
  if (target === "api") return ["api"];
  return ["api", "remote", "app"];
}

export function createDevelopmentServiceSpec(
  name: DevelopmentService,
  environment: NodeJS.ProcessEnv = process.env,
): DevelopmentServiceSpec {
  if (name === "api") {
    return {
      name,
      executable: process.execPath,
      args: ["run", "--cwd", join(projectRoot, "apps", "auth-api"), "dev"],
      cwd: projectRoot,
      env: { ...environment },
    };
  }

  if (name === "remote") {
    const dotenvx = join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "dotenvx.cmd" : "dotenvx");
    return {
      name,
      executable: dotenvx,
      args: [
        "run",
        "--redact",
        "--strict",
        "-f",
        join(projectRoot, "apps", "auth-api", ".env.dev"),
        "-fk",
        join(projectRoot, ".env.keys"),
        "--",
        process.execPath,
        "run",
        "--cwd",
        join(projectRoot, "remote", "api"),
        "dev",
      ],
      cwd: projectRoot,
      env: { ...environment },
    };
  }

  const isTestClient = name === "test-client";
  const outputDirectory = isTestClient ? "out-dev-test-client" : "out-dev-app";
  const electronVite = join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
  );
  return {
    name,
    executable: electronVite,
    args: ["dev", "--watch", "--outDir", outputDirectory, "--entry", join(outputDirectory, "main", "index.js")],
    cwd: projectRoot,
    env: {
      ...environment,
      OPENBOT_APP_VARIANT: "dev",
      OPENBOT_DEV_PROFILE: isTestClient ? "test-client" : "app",
      OPENBOT_DEV_RENDERER_PORT:
        environment.OPENBOT_DEV_RENDERER_PORT ??
        String(isTestClient ? DEFAULT_RENDERER_PORTS["test-client"] : DEFAULT_RENDERER_PORTS.app),
      OPENBOT_DEV_REMOTE_DEBUGGING_PORT:
        environment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT ??
        String(isTestClient ? DEFAULT_REMOTE_DEBUGGING_PORTS["test-client"] : DEFAULT_REMOTE_DEBUGGING_PORTS.app),
      OPENBOT_DEV_REMOTE_ROLE: environment.OPENBOT_DEV_REMOTE_ROLE ?? (isTestClient ? "client" : "host"),
    },
  };
}

// The ports in the spec are the ones this instance actually won, after
// `findAvailablePort` walked past whatever a sibling worktree already held.
// Publishing them is what lets `dev:automation` find this instance instead of
// guessing 9333, so the record carries the worktree it belongs to as well.
export function createDevInstanceRecord(
  spec: DevelopmentServiceSpec,
  pid: number,
  startedAt: number,
): DevInstanceRecord | null {
  if (spec.name !== "app" && spec.name !== "test-client") return null;
  const rendererPort = readPort(spec.env.OPENBOT_DEV_RENDERER_PORT);
  const remoteDebuggingPort = readPort(spec.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT);
  if (!rendererPort || !remoteDebuggingPort) return null;
  const instanceId = readDevelopmentInstanceId(spec.env.OPENBOT_DEV_INSTANCE_ID);
  const profileKind = spec.name === "test-client" ? "test-client" : "app";
  return {
    service: spec.name,
    instanceId: instanceId ?? "default",
    profile: developmentUserDataName(profileKind, instanceId),
    projectRoot: spec.cwd,
    rendererPort,
    remoteDebuggingPort,
    pid,
    startedAt,
  };
}

const DEVELOPMENT_OPTIONS = ["--dry-run", "--force", "--isolated"] as const;

export interface DevelopmentInvocation {
  target: DevelopmentTarget;
  dryRun: boolean;
  // Start beside this worktree's own running stack instead of refusing. Two
  // stacks in one worktree is nearly always a forgotten terminal, so it takes
  // saying so.
  force: boolean;
  // Give this worktree a profile of its own, keyed to its path, instead of
  // whichever suffix the renderer port happened to produce. The default keeps
  // the shared `OpenBot Dev` profile, so a worktree needs no seeding of its
  // own; `--isolated` is for the times two worktrees must not see each other's
  // conversations.
  isolated: boolean;
}

export function parseDevelopmentTarget(args: string[]): DevelopmentInvocation {
  const target = args.find((argument) => !argument.startsWith("--")) ?? "all";
  if (target !== "api" && target !== "app" && target !== "test-client" && target !== "all") {
    throw new Error(`Unknown development target: ${target}. Use api, app, test-client, or all.`);
  }
  const unsupportedOption = args.find(
    (argument) => argument.startsWith("--") && !DEVELOPMENT_OPTIONS.some((option) => option === argument),
  );
  if (unsupportedOption) throw new Error(`Unknown option: ${unsupportedOption}.`);
  return {
    target,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    isolated: args.includes("--isolated"),
  };
}

async function main(): Promise<void> {
  const { target, dryRun, force, isolated } = parseDevelopmentTarget(process.argv.slice(2));
  if (!dryRun && prepareDevelopmentEnvironment() === "created") {
    logger.info("Generated apps/auth-api/.env.dev for local development.");
  }
  const services = servicesForTarget(target);
  const sharedEnvironment = developmentEnvironmentForTarget(target);
  if (isolated) {
    sharedEnvironment.OPENBOT_DEV_INSTANCE_ID ??= developmentInstanceIdForWorktree(projectRoot);
  }

  // Everything between reading the registry and publishing this stack's ports
  // happens under one machine-wide lock, so a sibling worktree starting at the
  // same moment cannot claim a port this one has already chosen.
  const { specs, stack } = await withDevPortAllocation(async (records) => {
    const conflicts = conflictingDevStacks(records, { projectRoot, services });
    if (conflicts.length > 0) {
      const detail = conflicts.map((record) => `- ${describeDevStack(record)}`).join("\n");
      if (!force && !dryRun) {
        throw new Error(
          `This worktree already runs a dev stack:\n${detail}\n` +
            "Reuse it, stop it with `bun run dev:stop`, or start beside it with --force.",
        );
      }
      logger.warn(`This worktree already runs a dev stack:\n${detail}`);
    }
    const allocated = await allocateDevelopmentPorts(services, sharedEnvironment, heldDevStackPorts(records));
    validateServiceSpecs(allocated);
    if (dryRun) return { specs: allocated, stack: null };
    const record = createDevStackRecord(allocated, process.pid, Date.now());
    writeDevStackRecord(record);
    return { specs: allocated, stack: record };
  });

  if (dryRun) {
    for (const spec of specs) {
      logger.info(`[${spec.name}]`, JSON.stringify([spec.executable, ...spec.args]));
    }
    return;
  }

  await runDevelopmentServices(specs, stack);
}

// The ports the stack won, under the label a developer reads in
// `bun run dev:status`. Every long-running listener the stack owns belongs
// here: a port missing from the record is a port a sibling worktree will take.
export function createDevStackRecord(
  specs: DevelopmentServiceSpec[],
  supervisorPid: number,
  startedAt: number,
): DevStackRecord {
  const ports: DevStackPort[] = [];
  const addPort = (name: string, value: string | undefined): void => {
    const port = readPort(value);
    if (port !== undefined) ports.push({ name, port });
  };
  for (const spec of specs) {
    if (spec.name === "api") addPort("api", spec.env.OPENBOT_API_PORT);
    if (spec.name === "remote") {
      addPort("signal", spec.env.REMOTE_SIGNAL_PORT);
      addPort("signal-health", spec.env.REMOTE_HEALTH_PORT);
    }
    if (spec.name === "app" || spec.name === "test-client") {
      addPort(`${spec.name}-renderer`, spec.env.OPENBOT_DEV_RENDERER_PORT);
      addPort(`${spec.name}-debug`, spec.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT);
    }
  }
  return {
    services: specs.map((spec) => spec.name),
    projectRoot,
    supervisorPid,
    startedAt,
    ports,
    processes: [],
  };
}

async function allocateDevelopmentPorts(
  services: DevelopmentService[],
  sharedEnvironment: NodeJS.ProcessEnv,
  heldPorts: Set<number>,
): Promise<DevelopmentServiceSpec[]> {
  const reservedPorts = new Set<number>();

  if (services.includes("api")) {
    const apiPort = await findAvailablePort(
      readPort(sharedEnvironment.OPENBOT_API_PORT) ?? DEFAULT_API_PORT,
      reservedPorts,
      heldPorts,
    );
    reservedPorts.add(apiPort);
    sharedEnvironment.OPENBOT_API_PORT = String(apiPort);
    if (!sharedEnvironment.OPENBOT_AUTH_API_URL) {
      sharedEnvironment.OPENBOT_AUTH_API_URL = `http://127.0.0.1:${apiPort}`;
    }
    configureSiteHostingDevelopmentEnvironment(sharedEnvironment, apiPort);
    if (services.includes("remote")) {
      const signalPort = await findAvailablePort(
        readPort(sharedEnvironment.REMOTE_SIGNAL_PORT) ?? DEFAULT_REMOTE_SIGNAL_PORT,
        reservedPorts,
        heldPorts,
      );
      reservedPorts.add(signalPort);
      sharedEnvironment.REMOTE_SIGNAL_PORT = String(signalPort);

      const healthPort = await findAvailablePort(
        readPort(sharedEnvironment.REMOTE_HEALTH_PORT) ?? DEFAULT_REMOTE_HEALTH_PORT,
        reservedPorts,
        heldPorts,
      );
      reservedPorts.add(healthPort);
      sharedEnvironment.REMOTE_HEALTH_PORT = String(healthPort);
      sharedEnvironment.REMOTE_SESSION_SECRET ??= randomBytes(32).toString("hex");
      sharedEnvironment.TURN_SHARED_SECRET ??= randomBytes(32).toString("hex");
      if (signalPort !== DEFAULT_REMOTE_SIGNAL_PORT) {
        logger.info(`Signal port ${DEFAULT_REMOTE_SIGNAL_PORT} is busy. Using ${signalPort}.`);
      }
      if (healthPort !== DEFAULT_REMOTE_HEALTH_PORT) {
        logger.info(`Signal health port ${DEFAULT_REMOTE_HEALTH_PORT} is busy. Using ${healthPort}.`);
      }
    }
    configureMobileConnectDevelopmentNetwork(services, sharedEnvironment, networkInterfaces());
    if (sharedEnvironment.OPENBOT_MOBILE_AUTH_API_URL) {
      logger.info(`Mobile Connect API: ${sharedEnvironment.OPENBOT_MOBILE_AUTH_API_URL}`);
    }
    if (apiPort !== DEFAULT_API_PORT) {
      logger.info(`API port ${DEFAULT_API_PORT} is busy. Using ${apiPort}.`);
    }
  }

  const specs: DevelopmentServiceSpec[] = [];
  for (const service of services) {
    const environment = { ...sharedEnvironment };
    if (service === "app" || service === "test-client") {
      const defaultPort = DEFAULT_RENDERER_PORTS[service];
      const rendererPort = await findAvailablePort(
        readPort(environment.OPENBOT_DEV_RENDERER_PORT) ?? defaultPort,
        reservedPorts,
        heldPorts,
      );
      reservedPorts.add(rendererPort);
      environment.OPENBOT_DEV_RENDERER_PORT = String(rendererPort);
      if (rendererPort !== defaultPort) {
        environment.OPENBOT_DEV_INSTANCE_ID ??= String(rendererPort);
        logger.info(`Renderer port ${defaultPort} is busy. Using ${rendererPort} for ${service}.`);
      }

      const defaultRemoteDebuggingPort = DEFAULT_REMOTE_DEBUGGING_PORTS[service];
      const remoteDebuggingPort = await findAvailablePort(
        readPort(environment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT) ?? defaultRemoteDebuggingPort,
        reservedPorts,
        heldPorts,
      );
      reservedPorts.add(remoteDebuggingPort);
      environment.OPENBOT_DEV_REMOTE_DEBUGGING_PORT = String(remoteDebuggingPort);
      if (remoteDebuggingPort !== defaultRemoteDebuggingPort) {
        logger.info(
          `Electron debug port ${defaultRemoteDebuggingPort} is busy. Using ${remoteDebuggingPort} for ${service}.`,
        );
      }
    }
    specs.push(createDevelopmentServiceSpec(service, environment));
  }
  return specs;
}

async function runDevelopmentServices(specs: DevelopmentServiceSpec[], stack: DevStackRecord | null): Promise<void> {
  logger.info(`Starting: ${specs.map((spec) => spec.name).join(", ")}`);
  const processes = new Map<DevelopmentService, ChildProcess>();
  const publishedInstances: DevInstanceRecord[] = [];
  let stopping = false;

  const unpublishInstances = (): void => {
    while (publishedInstances.length > 0) {
      const record = publishedInstances.pop();
      if (record) removeDevInstanceRecord(record);
    }
  };

  const stopAll = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    unpublishInstances();
    await stopOwnedProcesses([...processes.values()], signal);
    // Last, not first: while this record exists, `dev:stop` can still find the
    // pids. Dropping it before the escalation would make anything that
    // survived SIGKILL an unrecorded orphan holding this worktree's ports.
    if (stack) removeDevStackRecord(stack);
  };

  process.once("SIGINT", () => void stopAll("SIGTERM").then(() => process.exit(130)));
  process.once("SIGTERM", () => void stopAll("SIGTERM").then(() => process.exit(143)));
  process.once("SIGHUP", () => void stopAll("SIGTERM").then(() => process.exit(129)));

  try {
    for (const spec of specs) {
      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: "inherit",
        shell: false,
        detached: process.platform !== "win32",
      });
      processes.set(spec.name, child);
      if (stack && child.pid) {
        // Republished after every spawn rather than once at the end: a stack
        // that dies while starting still leaves behind the pids of whatever it
        // did get running, which is what `dev:stop` needs to clear the ports.
        stack.processes.push({ name: spec.name, pid: child.pid, startedAt: Date.now() });
        writeDevStackRecord(stack);
      }
      const instance = child.pid ? createDevInstanceRecord(spec, child.pid, Date.now()) : null;
      if (instance) {
        writeDevInstanceRecord(instance);
        publishedInstances.push(instance);
        logger.info(
          `[${spec.name}] dev:automation can reach this instance with --instance=${instance.instanceId} (:${instance.remoteDebuggingPort}).`,
        );
      }
      child.once("error", (error) => {
        logger.error(`[${spec.name}] Could not start:`, error.message);
        void stopAll("SIGTERM").then(() => {
          process.exitCode = 1;
        });
      });
      child.once("exit", (code, signal) => {
        if (stopping) return;
        const result = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        logger.info(`[${spec.name}] stopped with ${result}. Stopping the other services.`);
        void stopAll("SIGTERM").then(() => {
          process.exitCode = code ?? 1;
        });
      });
      if (spec.name === "api") await waitForDevelopmentApi(spec.env.OPENBOT_API_PORT, child);
      if (spec.name === "remote") await waitForDevelopmentRemote(spec.env.REMOTE_HEALTH_PORT, child);
    }
  } catch (error) {
    await stopAll("SIGTERM");
    throw error;
  }
}

export function configureSiteHostingDevelopmentEnvironment(environment: NodeJS.ProcessEnv, apiPort: number): void {
  environment.SITE_PUBLISH_ENABLED ??= "true";
  environment.SITE_COOKIE_ISOLATION_READY ??= "true";
  environment.SITE_LOCAL_ORIGIN ??= `http://openbot.localhost:${apiPort}`;
}

export function configureMobileConnectDevelopmentNetwork(
  services: DevelopmentService[],
  environment: NodeJS.ProcessEnv,
  interfaces: DevelopmentNetworkInterfaces,
): void {
  const hasMobileClient = services.some((service) => service === "app" || service === "test-client");
  const apiPort = readPort(environment.OPENBOT_API_PORT);
  if (!apiPort) return;
  const exposeToLan = hasMobileClient && environment.OPENBOT_API_HOST !== "127.0.0.1";
  const address = exposeToLan ? selectMobileConnectLanAddress(interfaces) : null;

  if (services.includes("remote")) {
    const signalPort = readPort(environment.REMOTE_SIGNAL_PORT) ?? DEFAULT_REMOTE_SIGNAL_PORT;
    environment.REMOTE_SIGNAL_PORT ??= String(signalPort);
    environment.REMOTE_SIGNAL_HOST ??= "0.0.0.0";
    environment.REMOTE_TLS_DISABLED ??= "true";
    environment.REMOTE_CONTROL_PLANE_URL ??= `http://127.0.0.1:${apiPort}`;
    environment.REMOTE_AUTH_WEBHOOK_URL ??= `http://127.0.0.1:${signalPort}/internal/auth-events`;
    environment.REMOTE_SIGNAL_URL ??= `ws://${address ?? "127.0.0.1"}:${signalPort}/v1/signal`;
    environment.TURN_HOST ??= address ?? "127.0.0.1";
  }

  if (!address) return;
  environment.OPENBOT_API_HOST ??= "0.0.0.0";
  environment.OPENBOT_MOBILE_AUTH_API_URL ??= `http://${address}:${apiPort}`;
}

export function selectMobileConnectLanAddress(interfaces: DevelopmentNetworkInterfaces): string | null {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).flatMap((address) =>
      address.family === "IPv4" && !address.internal && isPrivateIpv4(address.address)
        ? [{ name, address: address.address }]
        : [],
    ),
  );
  candidates.sort(
    (left, right) =>
      interfacePriority(left.name) - interfacePriority(right.name) ||
      left.name.localeCompare(right.name) ||
      left.address.localeCompare(right.address),
  );
  return candidates[0]?.address ?? null;
}

function interfacePriority(name: string): 0 | 1 | 2 {
  if (name === "en0" || name === "eth0") return 0;
  if (/^(?:en|eth|wl)/u.test(name)) return 1;
  return 2;
}

function isPrivateIpv4(address: string): boolean {
  const values = address.split(".").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second] = values;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

async function waitForDevelopmentApi(portValue: string | undefined, child: ChildProcess): Promise<void> {
  const port = readPort(portValue);
  if (!port) throw new Error("The development API port is missing.");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The development Auth API stopped before it became ready.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The API can reject connections while Vite and the Worker runtime start.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`The development Auth API did not become ready on port ${port}.`);
}

async function waitForDevelopmentRemote(portValue: string | undefined, child: ChildProcess): Promise<void> {
  const port = readPort(portValue);
  if (!port) throw new Error("The development Signal health port is missing.");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The development Signal service stopped before it became ready.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The Signal service can reject connections while Bun starts its watcher.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`The development Signal service did not become ready on port ${port}.`);
}

// `heldPorts` are the ones a live dev stack has published, and they are skipped
// without probing on purpose: a stack that has won 5173 has not bound it yet,
// so probing would say it is free and hand it to this worktree as well.
// `reservedPorts` is the same idea within this one allocation.
export async function findAvailablePort(
  preferredPort: number,
  reservedPorts: Set<number>,
  heldPorts: Set<number> = new Set(),
  isAvailable: (port: number) => Promise<boolean> = isPortAvailable,
): Promise<number> {
  for (let port = preferredPort; port <= 65_535; port += 1) {
    if (reservedPorts.has(port) || heldPorts.has(port)) continue;
    if (await isAvailable(port)) return port;
  }
  throw new Error("No available development port was found.");
}

function isPortAvailable(port: number): Promise<boolean> {
  return Promise.all([isAddressPortAvailable(port, "127.0.0.1"), isAddressPortAvailable(port, "::1")]).then((results) =>
    results.every(Boolean),
  );
}

function isAddressPortAvailable(port: number, host: "127.0.0.1" | "::1"): Promise<boolean> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolvePort(available);
    };
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        finish(false);
        return;
      }
      if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) {
        finish(true);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close(() => finish(true));
    });
  });
}

function readPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("Development ports must be integers from 1024 to 65535.");
  }
  return port;
}

function validateServiceSpecs(specs: DevelopmentServiceSpec[]): void {
  for (const spec of specs) {
    if (spec.name === "api" && !existsSync(join(projectRoot, "apps", "auth-api", "package.json"))) {
      throw new Error("The auth API package is missing at apps/auth-api/package.json.");
    }
    if (spec.name === "remote" && !existsSync(join(projectRoot, "remote", "api", "package.json"))) {
      throw new Error("The Remote API package is missing at remote/api/package.json.");
    }
    if (spec.name !== "api" && !existsSync(spec.executable)) {
      const executableName = spec.name === "remote" ? "dotenvx" : "electron-vite";
      throw new Error(`${executableName} is missing at ${spec.executable}. Run bun install.`);
    }
  }
}

export function signalOwnedProcess(
  child: OwnedProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
  killProcess: KillProcess = process.kill,
  scope: SignalScope = "group",
): void {
  if (!child.pid) return;
  try {
    if (platform === "win32") {
      // Windows has no process groups to signal, so this reaches the process
      // alone; anything it started outlives it. `exitCode` guards a child this
      // runner already reaped, which a recorded pid never has.
      if (child.exitCode === null) killProcess(child.pid, signal);
    } else {
      killProcess(scope === "group" ? -child.pid : child.pid, signal);
    }
  } catch (error) {
    if (!isUnavailableProcess(error, platform)) throw error;
  }
}

export async function stopOwnedProcesses(
  owned: OwnedProcess[],
  signal: NodeJS.Signals,
  options: StopOwnedProcessesOptions = {},
): Promise<void> {
  const {
    platform = process.platform,
    killProcess = process.kill,
    timeoutMs = 3_000,
    pollIntervalMs = 50,
    scope = "group",
    now = Date.now,
    wait = (milliseconds) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  } = options;
  for (const child of owned) signalOwnedProcess(child, signal, platform, killProcess, scope);

  const deadline = now() + timeoutMs;
  while (owned.some((child) => ownedProcessIsRunning(child, platform, killProcess, scope))) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(pollIntervalMs, remaining));
  }

  for (const child of owned) {
    if (ownedProcessIsRunning(child, platform, killProcess, scope)) {
      signalOwnedProcess(child, "SIGKILL", platform, killProcess, scope);
    }
  }
}

function ownedProcessIsRunning(
  child: OwnedProcess,
  platform: NodeJS.Platform,
  killProcess: KillProcess,
  scope: SignalScope = "group",
): boolean {
  if (!child.pid) return false;
  if (platform === "win32") return child.exitCode === null;
  try {
    killProcess(scope === "group" ? -child.pid : child.pid, 0);
    return true;
  } catch (error) {
    if (isUnavailableProcess(error, platform)) return false;
    throw error;
  }
}

function isUnavailableProcess(error: unknown, platform: NodeJS.Platform): error is NodeJS.ErrnoException {
  // macOS can report EPERM while a detached Electron group is disappearing and only sandboxed helpers remain.
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ESRCH" || (platform === "darwin" && error.code === "EPERM"))
  );
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    logger.error(error instanceof Error ? error.message : toLogValue(error));
    process.exitCode = 1;
  });
}
