// Starts the built app (`bun run build` output in `out/`) for one `dev:bench`
// run, on a profile only the bench uses, and stops it again. The Electron
// binary is spawned directly rather than through `electron-vite preview`, so
// the process tree under the recorded pid is the app and nothing else.
//
// The run publishes a stack record like `bun run dev` does: its ports stay
// reserved against sibling worktrees, and `bun run dev:stop` can stop an app a
// crashed bench left behind.

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
  // Extra environment for the app, such as `OPENBOT_CLAUDE_PATH`.
  environment?: Record<string, string>;
  // The app's stdout and stderr, which carry its log. They hold conversation
  // metadata, so the file is owner-only and stays under the build directory.
  logPath?: string;
}

function electronExecutable(projectRoot: string): string {
  // The `electron` package's main export is the path of the binary it
  // downloaded. Its `.bin` shim is a Node wrapper, which would add a process
  // the packaged app does not have to every reading.
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

// The whole group, because the app's helpers and provider CLIs are its
// children. The group is the one this process created with `detached`, so the
// signal reaches nothing it did not start.
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

export async function launchBenchApp(options: LaunchBenchAppOptions): Promise<BenchApp> {
  const { projectRoot, instanceId, logger } = options;
  if (!existsSync(join(projectRoot, "out", "main", "index.js"))) {
    throw new Error("No built app in out/. Run `bun run build` first.");
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
    const spawned = spawn(executable, [`--inspect=127.0.0.1:${inspectorPort}`, projectRoot], {
      cwd: projectRoot,
      detached: true,
      stdio: logFile === null ? "ignore" : ["ignore", logFile, logFile],
      env: {
        ...withoutElectronRuntimeFlags(process.env),
        // The packaged look and name, on the bench's own profile.
        OPENBOT_APP_VARIANT: "preview",
        OPENBOT_DEV_PROFILE: "app",
        OPENBOT_DEV_INSTANCE_ID: instanceId,
        OPENBOT_DEV_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
        ...options.environment,
      },
    });
    // The child holds its own copy of the descriptor.
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
      // SIGTERM to the main process first: an unpackaged build quits through
      // `app.quit()` on it, which closes SQLite and stops provider CLIs.
      child.kill("SIGTERM");
      if (!(await waitForExit(child, 15_000))) {
        logger.warn("the bench app did not quit in 15 s; stopping its process group");
        signalGroup(child, "SIGKILL");
        await waitForExit(child, 5_000);
      }
      // Helpers and provider CLIs that outlived the main process.
      signalGroup(child, "SIGTERM");
      removeDevStackRecord(record);
    },
  };
}
