import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import type { Logger } from "@openbot/logging";
import { findAvailablePort } from "../dev-services";
import { withoutElectronRuntimeFlags } from "../electron-spawn-env";
import { withDevPortAllocation } from "./port-allocation";
import { type DevStackRecord, removeDevStackRecord, writeDevStackRecord } from "./stack-registry";

const DEFAULT_BENCH_DEBUG_PORT = 9_433;
const DEFAULT_BENCH_INSPECT_PORT = 9_449;

export interface BenchApp {
  pid: number;
  remoteDebuggingPort: number;
  inspectorPort: number;
  stop: () => Promise<void>;
}

export interface LaunchBenchAppOptions {
  projectRoot: string;
  instanceId: string;
  logger: Logger;
  environment?: Record<string, string>;
  logPath?: string;
}

function electronExecutable(projectRoot: string): string {
  const resolved = createRequire(join(projectRoot, "package.json"))("electron");
  if (!isString(resolved) || !existsSync(resolved)) {
    throw new Error("The electron package did not name an installed binary. Run `bun install --frozen-lockfile`.");
  }
  return resolved;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

export async function launchBenchApp(options: LaunchBenchAppOptions): Promise<BenchApp> {
  const { projectRoot, instanceId, logger } = options;
  if (!existsSync(join(projectRoot, "out", "main", "index.js"))) {
    throw new Error("No built app in out/. Run `bun run build` or `bun run build:bench` first.");
  }
  const executable = electronExecutable(projectRoot);
  const startedAt = Date.now();
  const { child, record } = await withDevPortAllocation(async (records) => {
    const held = new Set(records.flatMap((stack) => stack.ports.map((entry) => entry.port)));
    const reserved = new Set<number>();
    const remoteDebuggingPort = await findAvailablePort(DEFAULT_BENCH_DEBUG_PORT, reserved, held);
    reserved.add(remoteDebuggingPort);
    const inspectorPort = await findAvailablePort(DEFAULT_BENCH_INSPECT_PORT, reserved, held);
    let logFile: number | null = null;
    if (options.logPath) {
      mkdirSync(dirname(options.logPath), { recursive: true });
      logFile = openSync(options.logPath, "a", 0o600);
    }
    const linuxCi = process.platform === "linux" && process.env.CI === "true";
    const spawned = spawn(
      executable,
      [`--inspect=127.0.0.1:${inspectorPort}`, ...(linuxCi ? ["--no-sandbox"] : []), projectRoot],
      {
        cwd: projectRoot,
        detached: true,
        stdio: logFile === null ? "ignore" : ["ignore", logFile, logFile],
        env: {
          ...withoutElectronRuntimeFlags(process.env),
          OPENBOT_APP_VARIANT: "preview",
          OPENBOT_DEV_PROFILE: "app",
          OPENBOT_DEV_INSTANCE_ID: instanceId,
          OPENBOT_DEV_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
          ...options.environment,
        },
      },
    );
    if (logFile !== null) closeSync(logFile);
    if (spawned.pid === undefined) throw new Error("Electron did not start.");
    const stack: DevStackRecord = {
      services: ["app"],
      projectRoot,
      supervisorPid: process.pid,
      startedAt,
      ports: [
        { name: "app-debug", port: remoteDebuggingPort },
        { name: "app-inspect", port: inspectorPort },
      ],
      processes: [{ name: "app", pid: spawned.pid, startedAt: Date.now() }],
    };
    writeDevStackRecord(stack);
    return { child: spawned, record: stack };
  });
  const pid = child.pid ?? 0;
  const [debugPort, inspectPort] = record.ports;
  logger.info(`bench app pid ${pid}, CDP :${debugPort?.port}, inspector :${inspectPort?.port}`);
  let stopped = false;
  return {
    pid,
    remoteDebuggingPort: debugPort?.port ?? 0,
    inspectorPort: inspectPort?.port ?? 0,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      child.kill("SIGTERM");
      if (!(await waitForExit(child, 15_000))) {
        logger.warn("the bench app did not quit in 15 s; stopping its process group");
        signalGroup(child, "SIGKILL");
        await waitForExit(child, 5_000);
      }
      signalGroup(child, "SIGTERM");
      removeDevStackRecord(record);
    },
  };
}
