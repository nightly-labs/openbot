// The Linux desktop, the real pointer and keyboard, the screen recorder and the CPU count that
// `scripts/linux-agent-dock-e2e.ts` and `scripts/linux-dynamic-island-e2e.ts` share. Each driver runs
// one Electron harness that answers JSON commands on stdin with `@@{...}` lines on stdout.
//
// Without DISPLAY a session starts Xvfb, openbox and picom, and drives them with xdotool. In a GNOME
// session (XDG_CURRENT_DESKTOP=GNOME, DISPLAY of its XWayland) it sends the pointer and the keys through
// GNOME Shell, which needs `unsafe_mode` for `Eval`. Block notification banners in that setup: the banner
// that tells of unsafe mode covers the top centre of the screen, where the island is.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { Schema } from "effect";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

export const ROOT = resolve(import.meta.dirname, "..");
export const GNOME = (process.env.XDG_CURRENT_DESKTOP ?? "").split(":").includes("GNOME");
/** The modes of `startHarness` in which the app opens no window above the apps. Native Wayland needs GNOME. */
export const NO_WINDOW_MODES: readonly ("server" | "wayland")[] = GNOME ? ["server", "wayland"] : ["server"];
/** The time in which such an app could open its window after the start. */
export const NO_WINDOW_WAIT_MS = 3_000;
export const STATE_TIMEOUT_MS = 20_000;
export const SCREEN = { width: 1600, height: 1000 };
/**
 * The screen scale of a HiDPI desktop, such as `2` or `1.25` (`OPENBOT_E2E_SCALE`). Electron takes it as the
 * scale that GNOME or KDE give it. `SCREEN` stays in screen pixels; `Desktop.move` takes DIP.
 */
export const SCALE = Number(process.env.OPENBOT_E2E_SCALE ?? "1");

/** The point in DIP, as Electron gives positions, of a point in screen pixels. */
export function fromPixels(x: number, y: number): { x: number; y: number } {
  return { x: x / SCALE, y: y / SCALE };
}
const CLOCK_TICKS = 100;

export const RectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type Rect = typeof RectSchema.Type;
export const decodeNumber = Schema.decodeUnknownSync(Schema.Number);
export const decodeBoolean = Schema.decodeUnknownSync(Schema.Boolean);

/** True when no CSS motion with an end runs in the page. A motion that repeats with no end does not count. */
export const MOTION_DONE =
  "document.getAnimations().every((motion) => motion.playState !== 'running' || !Number.isFinite(motion.effect?.getComputedTiming().endTime ?? Infinity))";

/** A script that resolves after the renderer draws two frames. */
export const TWO_FRAMES = "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))";
export const decodeBox = Schema.decodeUnknownSync(Schema.NullOr(RectSchema));
export const decodePage = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String, html: Schema.String }));
const decodeAnswer = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.Number,
      ok: Schema.Boolean,
      value: Schema.optional(Schema.Unknown),
      error: Schema.optional(Schema.String),
    }),
  ),
);

export interface Session {
  /** `.openbot-build/<name>/<desktop>`: the report, the screenshots, the video and the logs. */
  out: string;
  /** A temporary folder for the profile and the window manager configuration. */
  root: string;
  environment: NodeJS.ProcessEnv;
  children: ChildProcess[];
  recorder?: ChildProcess | undefined;
}

/** Makes an empty output folder and a temporary folder. Linux only: other systems skip. */
export async function openSession(name: string): Promise<Session> {
  if (process.platform !== "linux") {
    process.stdout.write("SKIP: Linux only\n");
    process.exit(0);
  }
  const out = join(
    ROOT,
    ".openbot-build",
    name,
    `${GNOME ? "gnome-xwayland" : "x11"}${SCALE === 1 ? "" : `-scale-${SCALE}`}`,
  );
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  return {
    out,
    root: await mkdtemp(join(tmpdir(), `openbot-${name}-`)),
    environment: { ...withoutElectronRuntimeFlags(process.env) },
    children: [],
  };
}

/** Stops the recorder and the processes of the session, in the reverse order of their start. */
export async function closeSession(session: Session): Promise<void> {
  const recorder = session.recorder;
  if (recorder?.exitCode === null) {
    recorder.stdin?.end("q");
    await Promise.race([once(recorder), sleep(5_000)]);
  }
  for (const child of session.children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child), sleep(3_000)]);
    }
  }
  await rm(session.root, { recursive: true, force: true });
}

/** Bundles a harness to `out/<name>/harness.cjs`, next to `out/preload` and `out/renderer` of the build. */
export function buildHarness(source: string, name: string): string {
  assert.ok(existsSync(join(ROOT, "out", "renderer", "helper.html")), "build the app first: bun run build");
  assert.ok(existsSync(join(ROOT, "out", "preload", "index.cjs")), "build the app first: bun run build");
  const bundle = join(ROOT, "out", name, "harness.cjs");
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", source),
    "--target=node",
    "--format=cjs",
    "--external=electron",
    // Bun writes the source folder for `__dirname`. The window finds `out/preload` from the bundle's folder.
    "--define=__dirname=__bundleDirectory",
    '--banner=var __bundleDirectory = require("node:path").dirname(__filename);',
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);
  return bundle;
}

/** Starts the desktop when there is none, and the recorder on X11. */
export async function startDesktopAndRecorder(session: Session): Promise<Desktop> {
  if (!session.environment.DISPLAY) await startDesktop(session);
  if (!GNOME) session.recorder = startRecorder(session);
  return GNOME ? gnomeDesktop(session) : x11Desktop(session);
}

export interface Harness<Command extends { op: string }> {
  ready: Promise<void>;
  /** Sends one command and decodes its answer. */
  send: <A>(command: Command, decode: (value: unknown) => A) => Promise<A>;
  quit: () => Promise<void>;
}

/**
 * Starts the Electron side of a test, with a profile and a log for each mode. `server` plays a self-hosted or
 * hosted server (`OPENBOT_E2E_SERVER=1`). `wayland` draws native Wayland windows: it needs a Wayland desktop.
 */
export function startHarness<Command extends { op: string }>(
  session: Session,
  bundle: string,
  mode: "app" | "server" | "wayland" = "app",
): Harness<Command> {
  const electronPath = process.env.ELECTRON_OVERRIDE_DIST_PATH
    ? join(process.env.ELECTRON_OVERRIDE_DIST_PATH, "electron")
    : join(
        ROOT,
        "node_modules",
        "electron",
        "dist",
        readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
      );
  const log = openSync(join(session.out, `electron-${mode}.log`), "w");
  const child = spawn(
    electronPath,
    [
      bundle,
      `--user-data-dir=${join(session.root, `user-data-${mode}`)}`,
      "--no-sandbox",
      `--ozone-platform=${mode === "wayland" ? "wayland" : "x11"}`,
      ...(SCALE === 1 ? [] : [`--force-device-scale-factor=${SCALE}`]),
    ],
    {
      env: mode === "server" ? { ...session.environment, OPENBOT_E2E_SERVER: "1" } : session.environment,
      stdio: ["pipe", "pipe", log],
    },
  );
  closeSync(log);
  session.children.push(child);
  const waiting = new Map<number, { done: (value: unknown) => void; fail: (cause: Error) => void }>();
  let next = 0;
  let ready: () => void = () => undefined;
  let failStart: (cause: Error) => void = () => undefined;
  const exited = once(child);
  const readyPromise = new Promise<void>((done, fail) => {
    ready = done;
    failStart = fail;
    void exited.then((code) => fail(new Error(`Electron stopped before it was ready (${code}): see ${session.out}`)));
    setTimeout(() => fail(new Error("Electron was not ready in time.")), STATE_TIMEOUT_MS).unref();
  });
  assert.ok(child.stdout, "Electron has a stdout pipe");
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line === "@@ready") return ready();
    if (line.startsWith("@@failed")) return failStart(new Error(line.slice(9)));
    if (!line.startsWith("@@")) return;
    const message = decodeAnswer(line.slice(2));
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.ok) entry?.done(message.value);
    else entry?.fail(new Error(message.error));
  });
  const send: Harness<Command>["send"] = (command, decode) =>
    new Promise((done, fail) => {
      next += 1;
      const id = next;
      const timer = setTimeout(() => {
        waiting.delete(id);
        fail(new Error(`No answer to ${command.op}.`));
      }, STATE_TIMEOUT_MS);
      waiting.set(id, {
        done: (value) => {
          clearTimeout(timer);
          try {
            done(decode(value));
          } catch (cause) {
            fail(cause instanceof Error ? cause : new Error(String(cause)));
          }
        },
        fail: (cause) => {
          clearTimeout(timer);
          fail(cause);
        },
      });
      child.stdin?.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  return {
    ready: readyPromise,
    send,
    quit: async () => {
      child.stdin?.end();
      await exited;
    },
  };
}

async function startDesktop(session: Session): Promise<void> {
  const { environment, children } = session;
  environment.DISPLAY = ":99";
  environment.XDG_SESSION_TYPE = "x11";
  delete environment.WAYLAND_DISPLAY;
  const xvfb = spawn("Xvfb", [":99", "-screen", "0", `${SCREEN.width}x${SCREEN.height}x24`, "-nolisten", "tcp"], {
    stdio: "ignore",
  });
  children.push(xvfb);
  await until(() => spawnSync("xdpyinfo", [], { env: environment }).status === 0, "the X server");
  // Two workspaces, as most desktops have.
  const config = join(session.root, "openbox-rc.xml");
  await writeFile(
    config,
    "<?xml version='1.0'?><openbox_config xmlns='http://openbox.org/3.4/rc'><desktops><number>2</number></desktops></openbox_config>",
  );
  children.push(spawn("openbox", ["--config-file", config], { env: environment, stdio: "ignore" }));
  await until(() => spawnSync("wmctrl", ["-m"], { env: environment }).status === 0, "the window manager");
  // A compositor, as on a real desktop: without one the window has no transparent pixels.
  if (spawnSync("which", ["picom"]).status === 0) {
    children.push(spawn("picom", ["--backend", "xrender"], { env: environment, stdio: "ignore" }));
  }
}

function startRecorder(session: Session): ChildProcess | undefined {
  if (spawnSync("which", ["ffmpeg"]).status !== 0) return undefined;
  const log = openSync(join(session.out, "ffmpeg.log"), "w");
  const child = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "x11grab",
      "-framerate",
      "15",
      "-video_size",
      `${SCREEN.width}x${SCREEN.height}`,
      "-draw_mouse",
      "1",
      "-i",
      session.environment.DISPLAY ?? ":0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      join(session.out, "video.mp4"),
    ],
    { env: session.environment, stdio: ["pipe", log, log] },
  );
  closeSync(log);
  return child;
}

export function run(session: Session, command: string, args: string[]): string {
  const result = spawnSync(command, args, { env: session.environment, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

export interface Desktop {
  /** Moves the pointer to a point in DIP, as Electron and the renderer give positions. */
  move: (x: number, y: number) => void;
  button: (pressed: boolean) => void;
  click: () => void;
  type: (text: string) => Promise<void>;
  key: (name: "Return" | "Escape") => void;
  workspace: (index: number) => void;
  /** For a failure report: where the pointer is and what is under it. */
  pointer: () => string;
}

function x11Desktop(session: Session): Desktop {
  return {
    move: (x, y) =>
      run(session, "xdotool", ["mousemove", String(Math.round(x * SCALE)), String(Math.round(y * SCALE))]),
    button: (pressed) => run(session, "xdotool", [pressed ? "mousedown" : "mouseup", "1"]),
    click: () => run(session, "xdotool", ["click", "1"]),
    type: async (text) => void run(session, "xdotool", ["type", "--delay", "40", text]),
    key: (name) => run(session, "xdotool", ["key", name]),
    workspace: (index) => run(session, "wmctrl", ["-s", String(index)]),
    pointer: () => run(session, "xdotool", ["getmouselocation"]),
  };
}

/** GNOME Shell's own virtual pointer and keyboard: the events take the path of real input through mutter. */
function gnomeDesktop(session: Session): Desktop {
  const devices =
    "const C = imports.gi.Clutter; const seat = C.get_default_backend().get_default_seat();" +
    "global.e2ePointer ??= seat.create_virtual_device(C.InputDeviceType.POINTER_DEVICE);" +
    "global.e2eKeyboard ??= seat.create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);" +
    "const now = imports.gi.GLib.get_monotonic_time();";
  const input = (body: string) => shell(session, `(() => { ${devices} ${body}; return 'ok'; })()`);
  const button = (pressed: boolean) =>
    input(`global.e2ePointer.notify_button(now, C.BUTTON_PRIMARY, C.ButtonState.${pressed ? "PRESSED" : "RELEASED"})`);
  // A new virtual device can lose the y of a motion, also after its first one: each move sends the
  // motion again until GNOME Shell has the pointer at the point.
  input("");
  const pointerAt = (x: number, y: number) =>
    shell(
      session,
      `(() => { const [x, y] = global.get_pointer(); return x === ${x} && y === ${y} ? 'yes' : 'no'; })()`,
    ).includes("yes");
  const move = (x: number, y: number) => {
    const point = { x: Math.round(x * SCALE), y: Math.round(y * SCALE) };
    for (let attempt = 0; attempt < 50; attempt += 1) {
      input(`global.e2ePointer.notify_absolute_motion(now, ${point.x}, ${point.y})`);
      if (pointerAt(point.x, point.y)) return;
    }
    throw new Error(`GNOME Shell did not move the pointer to ${point.x},${point.y}.`);
  };
  const keyval = (value: string) =>
    input(
      `global.e2eKeyboard.notify_keyval(now, ${value}, C.KeyState.PRESSED); global.e2eKeyboard.notify_keyval(now + 1, ${value}, C.KeyState.RELEASED)`,
    );
  return {
    move,
    button,
    click: () => {
      button(true);
      button(false);
    },
    type: async (text) => {
      for (const character of text) {
        keyval(`C.unicode_to_keysym(${character.codePointAt(0)})`);
        await sleep(40);
      }
    },
    key: (name) => keyval(`C.KEY_${name}`),
    workspace: (index) =>
      shell(
        session,
        `global.workspace_manager.get_workspace_by_index(${index}).activate(global.get_current_time()); 'ok'`,
      ),
    pointer: () =>
      shell(
        session,
        "(() => { const [x, y] = global.get_pointer(); const actor = global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.REACTIVE, x, y); " +
          "const windows = global.display.list_all_windows().map((w) => { const r = w.get_frame_rect(); return [w.get_title(), w.get_window_type(), w.has_focus(), w.is_hidden(), r.x, r.y, r.width, r.height]; }); " +
          "return JSON.stringify({ x, y, actor: String(actor), grab: String(global.stage.get_grab_actor?.()), windows }); })()",
      ),
  };
}

function shell(session: Session, js: string): string {
  const out = run(session, "gdbus", [
    "call",
    "--session",
    "--dest",
    "org.gnome.Shell",
    "--object-path",
    "/org/gnome/Shell",
    "--method",
    "org.gnome.Shell.Eval",
    js,
  ]);
  assert.match(out, /^\(true,/u, `GNOME Shell could not run the input: ${out}`);
  return out;
}

export function screenshot(session: Session, name: string): void {
  const file = join(session.out, `${name}.png`);
  if (GNOME) {
    spawnSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.gnome.Shell.Screenshot",
        "--object-path",
        "/org/gnome/Shell/Screenshot",
        "--method",
        "org.gnome.Shell.Screenshot.Screenshot",
        "false",
        "false",
        file,
      ],
      { env: session.environment },
    );
    return;
  }
  spawnSync("import", ["-window", "root", file], { env: session.environment });
}

/** True when the window manager put the window above the others and on all workspaces. */
function placedByWindowManager(properties: string): boolean {
  return (
    /_NET_WM_WINDOW_TYPE_DOCK/u.test(properties) &&
    /_NET_WM_STATE_ABOVE/u.test(properties) &&
    (/_NET_WM_STATE_STICKY/u.test(properties) || /_NET_WM_DESKTOP\(CARDINAL\) = 4294967295/u.test(properties))
  );
}

/**
 * The window type, state and workspace that the window manager reads. The window manager sets the state
 * some time after the window shows, so this waits for it until the deadline.
 */
export async function windowManagerProperties(session: Session, xid: number): Promise<string> {
  const read = () =>
    run(session, "xprop", ["-id", String(xid), "_NET_WM_WINDOW_TYPE", "_NET_WM_STATE", "_NET_WM_DESKTOP"]);
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  let properties = read();
  while (!placedByWindowManager(properties) && Date.now() < deadline) {
    await sleep(100);
    properties = read();
  }
  assert.match(properties, /_NET_WM_WINDOW_TYPE_DOCK/u, "the window is a DOCK window");
  assert.match(properties, /_NET_WM_STATE_ABOVE/u, "the window is above other windows");
  assert.ok(
    /_NET_WM_STATE_STICKY/u.test(properties) || /_NET_WM_DESKTOP\(CARDINAL\) = 4294967295/u.test(properties),
    "the window is on all workspaces",
  );
  return properties;
}

/** Shows the second workspace and checks that the window still shows there, then goes back. */
export async function checkOtherWorkspace(
  session: Session,
  desktop: Desktop,
  xid: number,
  name: string,
): Promise<void> {
  desktop.workspace(1);
  await sleep(300);
  assert.match(
    run(session, "xwininfo", ["-id", String(xid)]),
    /Map State: IsViewable/u,
    "the window shows on workspace 2",
  );
  screenshot(session, name);
  desktop.workspace(0);
}

/** A point in the window, at least 10 px from each rect of the shape. */
export function pointOutside(bounds: Rect, region: readonly Rect[]): { x: number; y: number } {
  for (let y = 10; y < bounds.height - 10; y += 10) {
    for (let x = 10; x < bounds.width - 10; x += 10) {
      const near = region.some(
        (rect) => x > rect.x - 10 && x < rect.x + rect.width + 10 && y > rect.y - 10 && y < rect.y + rect.height + 10,
      );
      if (!near) return { x: bounds.x + x, y: bounds.y + y };
    }
  }
  throw new Error("The shape covers the whole window.");
}

/** The CPU time of the app and its child processes over `seconds`, as a percent of one core. */
export async function cpuOf(
  pid: number,
  seconds: number,
): Promise<{ percent: number; seconds: number; byType: Record<string, number>; perSecond: number[] }> {
  const before = ticksByProcess(pid);
  // One sample for each second shows if the use is steady or comes in short peaks.
  const perSecond: number[] = [];
  let previous = before;
  for (let second = 0; second < seconds; second += 1) {
    await sleep(1_000);
    const current = ticksByProcess(pid);
    let used = 0;
    for (const [process, { ticks }] of current) used += ticks - (previous.get(process)?.ticks ?? 0);
    perSecond.push(Math.round((used / CLOCK_TICKS) * 1_000) / 10);
    previous = current;
  }
  const byType: Record<string, number> = {};
  let total = 0;
  for (const [process, { ticks, type }] of previous) {
    const used = ticks - (before.get(process)?.ticks ?? 0);
    total += used;
    byType[type] = (byType[type] ?? 0) + (used / CLOCK_TICKS / seconds) * 100;
  }
  return { percent: (total / CLOCK_TICKS / seconds) * 100, seconds, byType, perSecond };
}

function ticksByProcess(rootPid: number): Map<number, { ticks: number; type: string }> {
  const parents = new Map<number, number>();
  const ticks = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      parents.set(pid, Number(fields[1]));
      ticks.set(pid, Number(fields[11]) + Number(fields[12]));
    } catch {}
  }
  const result = new Map<number, { ticks: number; type: string }>();
  for (const pid of ticks.keys()) {
    let parent: number | undefined = pid;
    while (parent !== undefined && parent !== rootPid && parent > 1) parent = parents.get(parent);
    if (parent !== rootPid) continue;
    let type = "main";
    try {
      type = /--type=([a-z-]+)/u.exec(readFileSync(`/proc/${pid}/cmdline`, "utf8"))?.[1] ?? "main";
    } catch {}
    result.set(pid, { ticks: ticks.get(pid) ?? 0, type });
  }
  return result;
}

/**
 * Clicks at `point` until the window under the test window counts a click. This shows that the pointer
 * of the test reaches that window. A desktop that has just started can lose the first click.
 */
export async function firstClick(
  desktop: Desktop,
  point: { x: number; y: number },
  clicks: () => Promise<number>,
): Promise<void> {
  desktop.move(point.x, point.y);
  try {
    await until(async () => {
      if ((await clicks()) > 0) return true;
      desktop.click();
      return false;
    }, "a click on the window under the test window");
  } catch (cause) {
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}; pointer: ${desktop.pointer()}`);
  }
}

export function once(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((done) => child.once("exit", (code) => done(code)));
}

export async function until<T>(
  read: () => T | undefined | false | Promise<T | undefined | false>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(100);
  }
}
