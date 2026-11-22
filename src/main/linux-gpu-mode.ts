import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, type Details, powerMonitor } from "electron";
import { isMissingFileError } from "../backend/file-errors";
import { countCrashDumps } from "./run-marker";

const GPU_START_FILE = "gpu-start.json";
const GPU_CRASH_FILE = "gpu-crash.json";
const GPU_RECORD_VERSION = 2;
const DEFAULT_START_CONFIRM_MS = 30_000;
const GPU_FAILURE_REASONS: ReadonlySet<Details["reason"]> = new Set([
  "crashed",
  "abnormal-exit",
  "oom",
  "launch-failed",
]);
const GPU_EXIT_ON_CONTEXT_LOST = 34 << 8;
const GPU_RESTART_LOOP_LIMIT = 10;
const GPU_RESTART_LOOP_WINDOW_MS = 60_000;

const logger = createOpenBotLogger("linux-gpu");

interface GpuFailureRecord {
  chromium: string;
  retried: boolean;
}

interface UnfinishedStart extends GpuFailureRecord {
  crashed: boolean;
}

type LinuxGpuModeReason =
  | "not-linux"
  | "server"
  | "environment-off"
  | "environment-on"
  | "gpu-process-crash"
  | "unfinished-start"
  | "unfinished-start-retry"
  | "default";

export interface LinuxGpuMode {
  hardwareAcceleration: boolean;
  reason: LinuxGpuModeReason;
}

interface LinuxGpuModeInput {
  platform: NodeJS.Platform;
  server: boolean;
  disableGpu: string | undefined;
  chromiumMajor: string;
  crash: GpuFailureRecord | undefined;
  unfinishedStart: UnfinishedStart | undefined;
}

function resolveLinuxGpuMode(input: LinuxGpuModeInput): LinuxGpuMode {
  if (input.platform !== "linux") return { hardwareAcceleration: true, reason: "not-linux" };
  if (input.disableGpu === "1") return { hardwareAcceleration: false, reason: "environment-off" };
  if (!input.server && input.disableGpu === "0") return { hardwareAcceleration: true, reason: "environment-on" };
  if (input.crash?.chromium === input.chromiumMajor) {
    return { hardwareAcceleration: false, reason: "gpu-process-crash" };
  }
  if (input.server) return { hardwareAcceleration: true, reason: "server" };
  if (input.unfinishedStart?.chromium === input.chromiumMajor) {
    if (input.unfinishedStart.crashed || input.unfinishedStart.retried) {
      return { hardwareAcceleration: false, reason: "unfinished-start" };
    }
    return { hardwareAcceleration: true, reason: "unfinished-start-retry" };
  }
  return { hardwareAcceleration: true, reason: "default" };
}

export interface ConfigureLinuxGpuOptions {
  userDataPath: string;
  ownsInstance: boolean;
  server: boolean;
  startConfirmMs?: number;
}

export function readLinuxGpuMode(userDataPath: string, server: boolean): LinuxGpuMode {
  const linux = process.platform === "linux";
  return resolveLinuxGpuMode({
    platform: process.platform,
    server,
    disableGpu: process.env.OPENBOT_DISABLE_GPU,
    chromiumMajor: chromiumMajorVersion(),
    crash: linux ? readGpuFailure(join(userDataPath, GPU_CRASH_FILE)) : undefined,
    unfinishedStart: linux ? readUnfinishedStart(join(userDataPath, GPU_START_FILE)) : undefined,
  });
}

export function configureLinuxGpu(options: ConfigureLinuxGpuOptions): LinuxGpuMode {
  const startPath = join(options.userDataPath, GPU_START_FILE);
  const crashPath = join(options.userDataPath, GPU_CRASH_FILE);
  const chromiumMajor = chromiumMajorVersion();
  const mode = readLinuxGpuMode(options.userDataPath, options.server);
  if (mode.reason === "not-linux") return mode;
  if (!mode.hardwareAcceleration) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
    if (options.ownsInstance) quitOnGpuRestartLoop();
    if (options.ownsInstance && (mode.reason === "gpu-process-crash" || mode.reason === "unfinished-start")) {
      logger.warn(
        `Software rendering is on because the GPU failed before (${mode.reason}). ` +
          `Remove ${mode.reason === "gpu-process-crash" ? crashPath : startPath}` +
          `${options.server ? "" : " or set OPENBOT_DISABLE_GPU=0"} to try the GPU again.`,
      );
    }
    return mode;
  }
  if (options.ownsInstance && mode.reason === "unfinished-start-retry") {
    logger.warn("The previous start stopped before it was confirmed, with no crash dump. The GPU gets one more start.");
  }
  if (mode.reason === "server") {
    app.commandLine.appendSwitch("disable-gpu-compositing");
    app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  }
  if (!options.ownsInstance) return mode;
  if (mode.reason !== "server") {
    writeGpuFailure(startPath, chromiumMajor, mode.reason === "unfinished-start-retry");
    const confirmStart = () => removeFile(startPath);
    void app.whenReady().then(() => setTimeout(confirmStart, options.startConfirmMs ?? DEFAULT_START_CONFIRM_MS));
    app.once("before-quit", confirmStart);
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  app.once("before-quit", stop);
  void app.whenReady().then(() => powerMonitor.on("shutdown", stop));
  app.on("child-process-gone", (_event, details) => {
    if (stopping || details.type !== "GPU" || !GPU_FAILURE_REASONS.has(details.reason)) return;
    if (details.reason === "abnormal-exit" && details.exitCode === GPU_EXIT_ON_CONTEXT_LOST) return;
    logger.warn(`The GPU process stopped (${details.reason}, exit code ${details.exitCode}).`);
    writeGpuFailure(crashPath, chromiumMajor);
  });
  return mode;
}

function quitOnGpuRestartLoop(): void {
  const exits: number[] = [];
  let quitting = false;
  app.once("before-quit", () => {
    quitting = true;
  });
  app.on("child-process-gone", (_event, details) => {
    if (quitting || details.type !== "GPU" || details.reason === "clean-exit") return;
    const now = performance.now();
    while (exits.length > 0 && now - (exits[0] ?? now) >= GPU_RESTART_LOOP_WINDOW_MS) exits.shift();
    exits.push(now);
    if (exits.length < GPU_RESTART_LOOP_LIMIT) {
      logger.warn(`The GPU process stopped (${details.reason}, exit code ${details.exitCode}). It starts again.`);
      return;
    }
    quitting = true;
    logger.error(
      `The GPU process stopped ${GPU_RESTART_LOOP_LIMIT} times in ${GPU_RESTART_LOOP_WINDOW_MS / 1000} s, so OpenBot quits.`,
    );
    app.quit();
  });
}

function chromiumMajorVersion(): string {
  return process.versions.chrome?.split(".")[0] ?? "";
}

function readGpuFailure(path: string): GpuFailureRecord | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) logger.warn(`Unable to read ${path}:`, toLogValue(error));
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (!isDynamicRecord(parsed) || parsed.version !== GPU_RECORD_VERSION || !isString(parsed.chromium))
      return undefined;
    return { chromium: parsed.chromium, retried: parsed.retried === true };
  } catch {
    return undefined;
  }
}

function readUnfinishedStart(path: string): UnfinishedStart | undefined {
  const record = readGpuFailure(path);
  if (!record) return undefined;
  let writtenAt = 0;
  try {
    writtenAt = statSync(path).mtimeMs;
  } catch (error) {
    logger.warn(`Unable to read the time of ${path}:`, toLogValue(error));
  }
  return { ...record, crashed: countCrashDumps(app.getPath("crashDumps"), writtenAt, Number.POSITIVE_INFINITY) > 0 };
}

function writeGpuFailure(path: string, chromiumMajor: string, retried = false): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      JSON.stringify({ version: GPU_RECORD_VERSION, chromium: chromiumMajor, ...(retried ? { retried } : {}) }),
    );
  } catch (error) {
    logger.warn(`Unable to write ${path}:`, toLogValue(error));
  }
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    logger.warn(`Unable to remove ${path}:`, toLogValue(error));
  }
}
