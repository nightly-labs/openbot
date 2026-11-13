// #992: on some Linux GPU drivers the GPU process dies with no fallback mode left, and Chromium then
// stops the main process with SIGTRAP ("GPU process isn't usable. Goodbye."). #1046 turned off
// hardware acceleration for every Linux computer, so on the computers whose GPU works, each surface
// that blurs its backdrop also renders on the CPU, frame by frame.
//
// Hardware acceleration now stays on until it fails on this computer. Two files in `userData` keep
// the evidence, because the main process can stop before it sees the GPU process go:
// - `gpu-start.json` is written before the app is ready. It is removed when the app has run for
//   `startConfirmMs`, or when a quit starts. If the file is there at the next start, that start stopped.
// - `gpu-crash.json` is written when the GPU process crashes.
// Either file keeps software rendering on at each later start with the same Chromium major version.
// A new Chromium major version tries the GPU again, because it can fix the driver problem. An Electron
// patch release keeps the Chromium major version, so it does not make a failing computer stop again.
// `OPENBOT_DISABLE_GPU=1` always uses software rendering. `OPENBOT_DISABLE_GPU=0` always uses the GPU.
// On a Wayland session, software rendering starts OpenBot again on XWayland (`linux-wayland-output.ts`).
// A server (`OPENBOT_SERVER=1` or a hosted server) runs under a virtual display with no GPU, so it
// always composites on the CPU. It keeps hardware acceleration for WebGL on SwiftShader (#6404): the
// browser of its agents opens sites such as the Figma editor, which stop without WebGL. A server
// records a GPU process crash and then turns off hardware acceleration, as a desktop does. It writes
// no start file: a server is often stopped soon after a start. `OPENBOT_DISABLE_GPU=1` turns off
// hardware acceleration on a server; `OPENBOT_DISABLE_GPU=0` does not change a server.
// The renderer sandbox stays on in all cases.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, type Details } from "electron";
import { isMissingFileError } from "../backend/file-errors";

const GPU_START_FILE = "gpu-start.json";
const GPU_CRASH_FILE = "gpu-crash.json";
const DEFAULT_START_CONFIRM_MS = 30_000;
// `killed` and `clean-exit` are a quit or a kill from outside, not a driver failure.
const GPU_FAILURE_REASONS: ReadonlySet<Details["reason"]> = new Set([
  "crashed",
  "abnormal-exit",
  "oom",
  "launch-failed",
]);
// `viz::ExitCode::RESULT_CODE_GPU_EXIT_ON_CONTEXT_LOST`: the GPU process stops on purpose when the GPU
// context is lost (for example after suspend and resume), and Chromium starts it again.
const GPU_EXIT_ON_CONTEXT_LOST = 34;

const logger = createOpenBotLogger("linux-gpu");

/** One GPU failure on this computer, with the Chromium major version that had it. */
interface GpuFailureRecord {
  chromium: string;
}

type LinuxGpuModeReason =
  | "not-linux"
  | "server"
  | "environment-off"
  | "environment-on"
  | "gpu-process-crash"
  | "unfinished-start"
  | "default";

export interface LinuxGpuMode {
  hardwareAcceleration: boolean;
  reason: LinuxGpuModeReason;
}

interface LinuxGpuModeInput {
  platform: NodeJS.Platform;
  server: boolean;
  /** The value of `OPENBOT_DISABLE_GPU`. */
  disableGpu: string | undefined;
  chromiumMajor: string;
  crash: GpuFailureRecord | undefined;
  unfinishedStart: GpuFailureRecord | undefined;
}

/** Decides if this start uses hardware acceleration. It reads no files and changes nothing. */
function resolveLinuxGpuMode(input: LinuxGpuModeInput): LinuxGpuMode {
  if (input.platform !== "linux") return { hardwareAcceleration: true, reason: "not-linux" };
  if (input.disableGpu === "1") return { hardwareAcceleration: false, reason: "environment-off" };
  if (!input.server && input.disableGpu === "0") return { hardwareAcceleration: true, reason: "environment-on" };
  if (input.crash?.chromium === input.chromiumMajor) {
    return { hardwareAcceleration: false, reason: "gpu-process-crash" };
  }
  if (input.server) return { hardwareAcceleration: true, reason: "server" };
  if (input.unfinishedStart?.chromium === input.chromiumMajor) {
    return { hardwareAcceleration: false, reason: "unfinished-start" };
  }
  return { hardwareAcceleration: true, reason: "default" };
}

export interface ConfigureLinuxGpuOptions {
  userDataPath: string;
  /**
   * False in a second instance, which gives its launch to the first instance and exits before it is
   * ready. It must not write the start file: it would never remove it.
   */
  ownsInstance: boolean;
  /** `OPENBOT_SERVER=1` or a hosted server: a virtual display with no GPU. */
  server: boolean;
  startConfirmMs?: number;
}

/** Reads the evidence and decides if this start uses hardware acceleration. It changes nothing. */
export function readLinuxGpuMode(userDataPath: string, server: boolean): LinuxGpuMode {
  const linux = process.platform === "linux";
  return resolveLinuxGpuMode({
    platform: process.platform,
    server,
    disableGpu: process.env.OPENBOT_DISABLE_GPU,
    chromiumMajor: chromiumMajorVersion(),
    crash: linux ? readGpuFailure(join(userDataPath, GPU_CRASH_FILE)) : undefined,
    unfinishedStart: linux ? readGpuFailure(join(userDataPath, GPU_START_FILE)) : undefined,
  });
}

/**
 * Reads the evidence, turns off hardware acceleration when it failed before, and records new
 * failures. Call it before the app is ready and after `userData` has its final path.
 */
export function configureLinuxGpu(options: ConfigureLinuxGpuOptions): LinuxGpuMode {
  const startPath = join(options.userDataPath, GPU_START_FILE);
  const crashPath = join(options.userDataPath, GPU_CRASH_FILE);
  const chromiumMajor = chromiumMajorVersion();
  const mode = readLinuxGpuMode(options.userDataPath, options.server);
  if (mode.reason === "not-linux") return mode;
  if (!mode.hardwareAcceleration) {
    app.disableHardwareAcceleration();
    // A second instance can read the start file of a first instance that is still new.
    if (options.ownsInstance && (mode.reason === "gpu-process-crash" || mode.reason === "unfinished-start")) {
      logger.warn(
        `Software rendering is on because the GPU failed before (${mode.reason}). ` +
          `Remove ${mode.reason === "gpu-process-crash" ? crashPath : startPath}` +
          `${options.server ? "" : " or set OPENBOT_DISABLE_GPU=0"} to try the GPU again.`,
      );
    }
    return mode;
  }
  if (mode.reason === "server") {
    // `disableHardwareAcceleration()` also turns off WebGL, and Chromium has no automatic SwiftShader
    // WebGL fallback. Compositing, raster, 2D canvas and video stay on the CPU, as with that call.
    app.commandLine.appendSwitch("disable-gpu-compositing");
    app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  }
  if (!options.ownsInstance) return mode;
  if (mode.reason !== "server") {
    writeGpuFailure(startPath, chromiumMajor);
    const confirmStart = () => removeFile(startPath);
    void app.whenReady().then(() => setTimeout(confirmStart, options.startConfirmMs ?? DEFAULT_START_CONFIRM_MS));
    // Not `will-quit`: it fires only after the teardown, which can take longer than a stop allows
    // (the shutdown deadline ends with `app.exit`, and `dev:stop` sends SIGKILL after a few seconds).
    app.once("before-quit", confirmStart);
  }
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU" || !GPU_FAILURE_REASONS.has(details.reason)) return;
    if (details.reason === "abnormal-exit" && details.exitCode === GPU_EXIT_ON_CONTEXT_LOST) return;
    logger.warn(`The GPU process stopped (${details.reason}, exit code ${details.exitCode}).`);
    writeGpuFailure(crashPath, chromiumMajor);
  });
  return mode;
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
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isString(parsed.chromium)) return undefined;
    return { chromium: parsed.chromium };
  } catch {
    return undefined;
  }
}

// Synchronous: the first write runs before the app is ready, and a crash can stop the process soon after.
function writeGpuFailure(path: string, chromiumMajor: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ version: 1, chromium: chromiumMajor }));
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
