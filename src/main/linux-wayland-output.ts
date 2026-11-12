// A Linux host with its only monitor off did not start, also after an update restart. Chromium 152
// (Electron 44) connects to Wayland in `WaylandConnection::Initialize` and loops on
// `while (!WlGlobalsReady())` until the compositor reports a `wl_output`. GNOME reports none while no
// monitor is on, so the main thread sends `wl_display.sync` for ever and no window or agent starts.
//
// Electron runs the ESM main script, top-level awaits included, before Chromium connects. Here main
// asks the compositor for its globals. With no `wl_output` and an X11 display (XWayland), it starts
// OpenBot again with `--ozone-platform=x11` and exits: the X11 platform does not wait for a monitor.
// When the monitor is on again, the window shows through XWayland. The next start uses Wayland again.
//
// The agent dock and the Dynamic Island above other apps need X11 windows: a Wayland client cannot set
// its position, stay above other windows or show on all workspaces. When the user chooses one of them
// on a Wayland session, each start goes to XWayland in the same way, until the user turns it off.

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

const logger = createOpenBotLogger("main");

/** Set on the new process only, so that it logs why it uses X11 and never starts again itself. */
const RESTART_MARKER = "OPENBOT_XWAYLAND_RESTART";
/** Why a process started again on XWayland: no monitor, or a window above other apps. */
export type XWaylandRestartReason = "monitor" | "above-apps";
/** The windows above other apps that need XWayland on a Wayland session. */
export type AboveAppsFeature = "agent-dock" | "dynamic-island";
/**
 * In `userData`, one file for each feature: the user put it above other apps, so each Wayland start
 * uses XWayland. One file for each, so that a feature that the user turns off does not take XWayland
 * from the other one.
 */
const ABOVE_APPS_XWAYLAND_FILES: Record<AboveAppsFeature, string> = {
  "agent-dock": "agent-dock-xwayland",
  "dynamic-island": "dynamic-island-xwayland",
};
const PROBE_TIMEOUT = "2 seconds";

// Object ids of the probe: 1 is `wl_display`; the client picks 2 for the registry and 3 for the callback.
const DISPLAY_ID = 1;
const REGISTRY_ID = 2;
const CALLBACK_ID = 3;
const HEADER_BYTES = 8;
const X11_ARGUMENT = "--ozone-platform=x11";

// Wayland uses the byte order of the computer.
const littleEndian = endianness() === "LE";
const readUInt32 = littleEndian ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
const writeUInt32 = littleEndian ? Buffer.prototype.writeUInt32LE : Buffer.prototype.writeUInt32BE;

class WaylandProbeFailure extends Schema.TaggedError<WaylandProbeFailure>()("WaylandProbeFailure", {
  cause: Schema.Defect(),
}) {}

class AboveAppsXWaylandFailure extends Schema.TaggedError<AboveAppsXWaylandFailure>()("AboveAppsXWaylandFailure", {
  cause: Schema.Defect(),
}) {}

/** The compositor socket that Chromium connects to, or null when this is not a Wayland session. */
function waylandSocketPath(environment: NodeJS.ProcessEnv): string | null {
  // An inherited socket can be read only once, and Chromium needs it.
  if (environment.WAYLAND_SOCKET) return null;
  const display =
    environment.WAYLAND_DISPLAY?.trim() || (environment.XDG_SESSION_TYPE === "wayland" ? "wayland-0" : "");
  if (!display) return null;
  if (isAbsolute(display)) return display;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim() ?? "";
  return isAbsolute(runtimeDirectory) ? join(runtimeDirectory, display) : null;
}

/**
 * Before main runs, Chromium adds `--ozone-platform`: "wayland" when XDG_SESSION_TYPE is "wayland",
 * else "x11" (`ui::SetOzonePlatformForLinuxIfNeeded`). A platform that the user or the restart below
 * puts on the command line stays.
 */
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

/**
 * The interface names of the compositor's globals: `wl_display.get_registry`, then `wl_display.sync`.
 * The callback's `done` comes after every `wl_registry.global` of the first burst.
 */
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
        // wl_registry.global(name: uint, interface: string, version: uint). A string is a length that
        // counts its NUL, then the bytes.
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
    // An AppImage mounts itself for each start, and the mount of this process goes away with it.
    const executable = environment.APPIMAGE || process.execPath;
    // A terminal start keeps the output. The desktop app does not read its input.
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

/**
 * Why this process started on XWayland, or null when no restart below started it. Agents do not inherit
 * the marker. A relaunch takes the arguments of `argv`, so the restart argument goes out of it: the next
 * start decides again.
 */
export function takeXWaylandRestartMarker(
  environment: NodeJS.ProcessEnv,
  argv: string[],
): XWaylandRestartReason | null {
  const marker = environment[RESTART_MARKER];
  delete environment[RESTART_MARKER];
  if (marker === undefined) return null;
  const index = argv.lastIndexOf(X11_ARGUMENT);
  if (index > 0) argv.splice(index, 1);
  return marker === "above-apps" ? "above-apps" : "monitor";
}

/**
 * The Ozone platform of this process, for an OpenBot child process such as a local server. On XWayland,
 * the child must not wait for a monitor on Wayland. Elsewhere it is the platform that the child chooses.
 */
export function ozonePlatformArguments(): string[] {
  if (process.platform !== "linux") return [];
  const platform = app.commandLine.getSwitchValue("ozone-platform");
  return platform ? [`--ozone-platform=${platform}`] : [];
}

/** True when this Linux process draws its windows with X11: on an X server, or on XWayland. */
export function usesX11Windows(): boolean {
  return process.platform === "linux" && app.commandLine.getSwitchValue("ozone-platform") !== "wayland";
}

/**
 * The window of the agent dock and the Dynamic Island: a macOS panel, a Windows tool window or an X11
 * dock window. Null where they do not show: on Wayland windows, and on a server. A server has no user at
 * its screen. On its virtual display the island and the dock would draw in software for nobody, and a
 * computer-use agent would see them in its screenshots.
 */
export function aboveAppsWindowKind(server: boolean): "panel" | "tool" | "x11" | null {
  if (server) return null;
  if (process.platform === "darwin") return "panel";
  if (process.platform === "win32") return "tool";
  return usesX11Windows() ? "x11" : null;
}

/**
 * Whether the agent dock and the Dynamic Island can show above other apps. Missing: they can. On Wayland, only after a restart on
 * XWayland, which needs a packaged app and an X11 display. A development build only quits on a restart.
 */
export function aboveAppsScreenSupport(): AboveAppsSupport | undefined {
  if (process.platform !== "linux" || usesX11Windows()) return undefined;
  // An explicit `--ozone-platform=wayland` stays on each start, so a restart would come back to Wayland.
  return app.isPackaged && process.env.DISPLAY && chromiumChoosesWayland() ? "restart" : "unsupported";
}

/** True when this process draws its windows on XWayland in a Wayland session. */
function onXWayland(): boolean {
  return usesX11Windows() && Boolean(process.env.WAYLAND_DISPLAY?.trim() || process.env.XDG_SESSION_TYPE === "wayland");
}

/**
 * Keeps the start on XWayland for a feature that the user turned on again on XWayland, after a turn-off
 * removed the restart file. Elsewhere it changes nothing and does not restart.
 */
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

/**
 * On: each start on Wayland goes to XWayland, and OpenBot starts again now. Already on XWayland, it only
 * keeps that for the next start. Off: when the other feature does not need it, the next start uses
 * Wayland again. The window stays on XWayland until then.
 */
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
  // An AppImage mounts itself for each start, and the mount of this process goes away with it.
  const execPath = process.env.APPIMAGE;
  app.relaunch(execPath ? { execPath, args: process.argv.slice(1) } : { args: process.argv.slice(1) });
  app.quit();
});

/**
 * True when the user put the agent dock or the Dynamic Island above other apps on Wayland, a new OpenBot process on XWayland
 * has started, and this one must exit before Chromium connects to Wayland. Run it before the
 * single-instance lock, with the final `userData` path.
 */
export const restartOnXWaylandForAboveApps = Effect.fn("restartOnXWaylandForAboveApps")(function* (
  environment: NodeJS.ProcessEnv,
  userDataPath: string,
) {
  if (process.platform !== "linux" || !chromiumChoosesWayland() || !environment.DISPLAY) return false;
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

/**
 * True when a new OpenBot process on XWayland has started, and this one must exit before Chromium
 * connects to Wayland. Run it before the single-instance lock, so that the new process can take it.
 * The new process has `--ozone-platform=x11`, so it does not start again.
 */
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
