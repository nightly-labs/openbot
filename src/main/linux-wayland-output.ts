import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { endianness } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AboveAppsSupport } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";
import { app } from "electron";
import { relaunchApp } from "./linux-appimage-relaunch";
import { x11CompositorRunning } from "./linux-x11-activation";

const logger = createOpenBotLogger("main");

const RESTART_MARKER = "OPENBOT_XWAYLAND_RESTART";
export type XWaylandRestartReason = "monitor" | "above-apps" | "software-rendering";
export type AboveAppsFeature = "agent-dock" | "dynamic-island";
const ABOVE_APPS_XWAYLAND_FILES: Record<AboveAppsFeature, string> = {
  "agent-dock": "agent-dock-xwayland",
  "dynamic-island": "dynamic-island-xwayland",
};
const PROBE_TIMEOUT = "2 seconds";

const DISPLAY_ID = 1;
const REGISTRY_ID = 2;
const CALLBACK_ID = 3;
const HEADER_BYTES = 8;
const X11_ARGUMENT = "--ozone-platform=x11";

const littleEndian = endianness() === "LE";
const readUInt32 = littleEndian ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
const writeUInt32 = littleEndian ? Buffer.prototype.writeUInt32LE : Buffer.prototype.writeUInt32BE;

class WaylandProbeFailure extends Schema.TaggedError<WaylandProbeFailure>()("WaylandProbeFailure", {
  cause: Schema.Defect(),
}) {}

class AboveAppsXWaylandFailure extends Schema.TaggedError<AboveAppsXWaylandFailure>()("AboveAppsXWaylandFailure", {
  cause: Schema.Defect(),
}) {}

function waylandSocketPath(environment: NodeJS.ProcessEnv): string | null {
  if (environment.WAYLAND_SOCKET) return null;
  const display =
    environment.WAYLAND_DISPLAY?.trim() || (environment.XDG_SESSION_TYPE === "wayland" ? "wayland-0" : "");
  if (!display) return null;
  if (isAbsolute(display)) return display;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim() ?? "";
  return isAbsolute(runtimeDirectory) ? join(runtimeDirectory, display) : null;
}

function chromiumChoosesWayland(): boolean {
  if (process.argv.some((argument) => argument.startsWith("--ozone-platform="))) return false;
  return app.commandLine.getSwitchValue("ozone-platform") === "wayland";
}

function message(id: number, opcode: number, newId: number): Buffer {
  const bytes = Buffer.alloc(12);
  writeUInt32.call(bytes, id, 0);
  writeUInt32.call(bytes, (12 << 16) | opcode, 4);
  writeUInt32.call(bytes, newId, 8);
  return bytes;
}

function listWaylandGlobals(socketPath: string): Effect.Effect<ReadonlySet<string>, WaylandProbeFailure> {
  return Effect.callback<ReadonlySet<string>, WaylandProbeFailure>((resume) => {
    const interfaces = new Set<string>();
    let pending = Buffer.alloc(0);
    let finished = false;
    const finish = (result: Effect.Effect<ReadonlySet<string>, WaylandProbeFailure>) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resume(result);
    };
    const fail = (cause: unknown) => finish(Effect.fail(new WaylandProbeFailure({ cause })));
    const socket = createConnection(socketPath, () => {
      socket.write(Buffer.concat([message(DISPLAY_ID, 1, REGISTRY_ID), message(DISPLAY_ID, 0, CALLBACK_ID)]));
    });
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("The Wayland compositor closed the connection.")));
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_BYTES) {
        const id = readUInt32.call(pending, 0);
        const word = readUInt32.call(pending, 4);
        const size = word >>> 16;
        const opcode = word & 0xffff;
        if (size < HEADER_BYTES) return fail(new Error(`A Wayland message has the size ${size}.`));
        if (pending.length < size) return;
        const body = pending.subarray(HEADER_BYTES, size);
        pending = pending.subarray(size);
        if (id === REGISTRY_ID && opcode === 0 && body.length >= 8) {
          const length = readUInt32.call(body, 4);
          if (length > 0 && body.length >= 8 + length)
            interfaces.add(body.subarray(8, 8 + length - 1).toString("utf8"));
        } else if (id === CALLBACK_ID && opcode === 0) {
          return finish(Effect.succeed(interfaces));
        } else if (id === DISPLAY_ID && opcode === 0) {
          return fail(new Error("The Wayland compositor sent an error."));
        }
      }
    });
    return Effect.sync(() => {
      finished = true;
      socket.destroy();
    });
  });
}

function startOnX11(
  environment: NodeJS.ProcessEnv,
  reason: XWaylandRestartReason,
): Effect.Effect<void, WaylandProbeFailure> {
  return Effect.callback<void, WaylandProbeFailure>((resume) => {
    const executable = environment.APPIMAGE || process.execPath;
    const child = spawn(executable, [...process.argv.slice(1), X11_ARGUMENT], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...environment, [RESTART_MARKER]: reason },
    });
    child.once("error", (cause) => resume(Effect.fail(new WaylandProbeFailure({ cause }))));
    child.once("spawn", () => {
      child.unref();
      resume(Effect.void);
    });
  });
}

export function takeXWaylandRestartMarker(
  environment: NodeJS.ProcessEnv,
  argv: string[],
): XWaylandRestartReason | null {
  const marker = environment[RESTART_MARKER];
  delete environment[RESTART_MARKER];
  if (marker === undefined) return null;
  const index = argv.lastIndexOf(X11_ARGUMENT);
  if (index > 0) argv.splice(index, 1);
  return marker === "above-apps" || marker === "software-rendering" ? marker : "monitor";
}

export function ozonePlatformArguments(): string[] {
  if (process.platform !== "linux") return [];
  const platform = app.commandLine.getSwitchValue("ozone-platform");
  return platform ? [`--ozone-platform=${platform}`] : [];
}

export function usesX11Windows(): boolean {
  return process.platform === "linux" && app.commandLine.getSwitchValue("ozone-platform") !== "wayland";
}

function onNiri(environment: NodeJS.ProcessEnv): boolean {
  if (environment.NIRI_SOCKET?.trim()) return true;
  return (environment.XDG_CURRENT_DESKTOP ?? "").split(":").some((desktop) => desktop.trim().toLowerCase() === "niri");
}

export function aboveAppsWindowKind(server: boolean): "panel" | "tool" | "x11" | null {
  if (server) return null;
  if (process.platform === "darwin") return "panel";
  if (process.platform === "win32") return "tool";
  return usesX11Windows() && !onNiri(process.env) ? "x11" : null;
}

export function aboveAppsScreenSupport(): AboveAppsSupport | undefined {
  if (process.platform !== "linux") return undefined;
  if (onNiri(process.env)) return "unsupported";
  if (usesX11Windows()) return onXWayland() || x11CompositorRunning() ? undefined : "no-compositor";
  return app.isPackaged && process.env.DISPLAY && chromiumChoosesWayland() ? "restart" : "unsupported";
}

function onXWayland(): boolean {
  return usesX11Windows() && Boolean(process.env.WAYLAND_DISPLAY?.trim() || process.env.XDG_SESSION_TYPE === "wayland");
}

export const keepAboveAppsXWayland = Effect.fn("keepAboveAppsXWayland")(function* (
  userDataPath: string,
  feature: AboveAppsFeature,
) {
  if (process.platform !== "linux" || !onXWayland()) return;
  yield* Effect.tryPromise({
    try: () => writeFile(join(userDataPath, ABOVE_APPS_XWAYLAND_FILES[feature]), ""),
    catch: (cause) => new AboveAppsXWaylandFailure({ cause }),
  });
});

export const setAboveAppsXWayland = Effect.fn("setAboveAppsXWayland")(function* (
  userDataPath: string,
  feature: AboveAppsFeature,
  enabled: boolean,
) {
  if (process.platform !== "linux") return;
  const file = join(userDataPath, ABOVE_APPS_XWAYLAND_FILES[feature]);
  if (!enabled) {
    yield* Effect.tryPromise({
      try: () => rm(file, { force: true }),
      catch: (cause) => new AboveAppsXWaylandFailure({ cause }),
    });
    return;
  }
  if (aboveAppsScreenSupport() !== "restart") return yield* keepAboveAppsXWayland(userDataPath, feature);
  yield* Effect.tryPromise({
    try: () => writeFile(file, ""),
    catch: (cause) => new AboveAppsXWaylandFailure({ cause }),
  });
  logger.info(`The ${feature} shows above other apps, so OpenBot starts again on XWayland.`);
  relaunchApp(app, process.argv.slice(1));
  app.quit();
});

export const restartOnXWaylandForAboveApps = Effect.fn("restartOnXWaylandForAboveApps")(function* (
  environment: NodeJS.ProcessEnv,
  userDataPath: string,
) {
  if (process.platform !== "linux" || !chromiumChoosesWayland() || !environment.DISPLAY || onNiri(environment))
    return false;
  if (!Object.values(ABOVE_APPS_XWAYLAND_FILES).some((file) => existsSync(join(userDataPath, file)))) return false;
  return yield* startOnX11(environment, "above-apps").pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not start OpenBot on XWayland for the windows above other apps:", toLogValue(error.cause));
        return false;
      }),
    ),
  );
});

export const restartOnXWaylandForSoftwareRendering = Effect.fn("restartOnXWaylandForSoftwareRendering")(function* (
  environment: NodeJS.ProcessEnv,
  softwareRendering: boolean,
) {
  if (process.platform !== "linux" || !softwareRendering || !chromiumChoosesWayland() || !environment.DISPLAY)
    return false;
  return yield* startOnX11(environment, "software-rendering").pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not start OpenBot on XWayland for software rendering:", toLogValue(error.cause));
        return false;
      }),
    ),
  );
});

export const restartOnXWaylandWithoutMonitor = Effect.fn("restartOnXWaylandWithoutMonitor")(function* (
  environment: NodeJS.ProcessEnv,
) {
  if (process.platform !== "linux" || !chromiumChoosesWayland()) return false;
  const socketPath = waylandSocketPath(environment);
  if (!socketPath) return false;
  const globals = yield* listWaylandGlobals(socketPath).pipe(
    Effect.timeoutOption(PROBE_TIMEOUT),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not read the Wayland displays:", toLogValue(error.cause));
        return Option.none<ReadonlySet<string>>();
      }),
    ),
  );
  if (Option.isNone(globals) || globals.value.has("wl_output")) return false;
  if (!environment.DISPLAY) {
    logger.warn("The Wayland session has no monitor and no XWayland. OpenBot starts when a monitor is on.");
    return false;
  }
  return yield* startOnX11(environment, "monitor").pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not start OpenBot on XWayland:", toLogValue(error.cause));
        return false;
      }),
    ),
  );
});
