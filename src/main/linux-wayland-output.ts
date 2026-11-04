// A Linux host with its only monitor off did not start, also after an update restart. Chromium 152
// (Electron 44) connects to Wayland in `WaylandConnection::Initialize` and loops on
// `while (!WlGlobalsReady())` until the compositor reports a `wl_output`. GNOME reports none while no
// monitor is on, so the main thread sends `wl_display.sync` for ever and no window or agent starts.
//
// Electron runs the ESM main script, top-level awaits included, before Chromium connects. Here main
// asks the compositor for its globals. With no `wl_output` and an X11 display (XWayland), it starts
// OpenBot again with `--ozone-platform=x11` and exits: the X11 platform does not wait for a monitor.
// When the monitor is on again, the window shows through XWayland. The next start uses Wayland again.

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { endianness } from "node:os";
import { isAbsolute, join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";
import { app } from "electron";

const logger = createOpenBotLogger("main");

/** Set on the new process only, so that it logs why it uses X11 and never starts again itself. */
const RESTART_MARKER = "OPENBOT_XWAYLAND_RESTART";
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

function startOnX11(environment: NodeJS.ProcessEnv): Effect.Effect<void, WaylandProbeFailure> {
  return Effect.callback<void, WaylandProbeFailure>((resume) => {
    // An AppImage mounts itself for each start, and the mount of this process goes away with it.
    const executable = environment.APPIMAGE || process.execPath;
    // A terminal start keeps the output. The desktop app does not read its input.
    const child = spawn(executable, [...process.argv.slice(1), X11_ARGUMENT], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...environment, [RESTART_MARKER]: "1" },
    });
    child.once("error", (cause) => resume(Effect.fail(new WaylandProbeFailure({ cause }))));
    child.once("spawn", () => {
      child.unref();
      resume(Effect.void);
    });
  });
}

/**
 * True in the process that the restart below started. Agents do not inherit the marker. A relaunch
 * takes the arguments of `argv`, so the restart argument goes out of it: the next start probes again.
 */
export function takeXWaylandRestartMarker(environment: NodeJS.ProcessEnv, argv: string[]): boolean {
  const restarted = environment[RESTART_MARKER] !== undefined;
  delete environment[RESTART_MARKER];
  const index = argv.lastIndexOf(X11_ARGUMENT);
  if (restarted && index > 0) argv.splice(index, 1);
  return restarted;
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
  return yield* startOnX11(environment).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not start OpenBot on XWayland:", toLogValue(error.cause));
        return false;
      }),
    ),
  );
});
