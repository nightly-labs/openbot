// The Dynamic Island and the agent dock as Wayland layers on Hyprland.
//
// On Linux the island and the dock are X11 windows above other apps (`linux-wayland-output.ts`).
// Hyprland ignores the X11 "above" and "sticky" hints and X11 window shapes, so there they are
// ordinary windows: under other apps and panels, on one workspace, black outside their shape, and
// caught by window rules and by programs that act on windows.
//
// Where Quickshell is installed, OpenBot renders the same island and dock pages offscreen (Electron
// offscreen rendering) and a small Quickshell instance shows their frames as layers on the Overlay
// layer (`resources/linux-layer-overlay/shell.qml`): above every window and panel, on every workspace,
// and never a window. Quickshell sends the pointer and the keys back, and OpenBot gives them to the
// page as input events.
//
// The window controllers stay the owners of the behaviour: they choose the displays, the places, the
// shapes and the presentations, as on X11. Each window they make has its own layer on the output of its
// display, so the island and the dock behave as on the other platforms.

import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { delimiter, join } from "node:path";
import type { AgentDockInputRect, AgentDockPresentation } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { BrowserWindow, type Rectangle, screen } from "electron";
import { isTrustedRendererUrl } from "./trusted-renderer";

const logger = createOpenBotLogger("main");

/** Set to "0" to keep the X11 windows on Hyprland. */
export const LAYER_OVERLAY_SWITCH = "OPENBOT_LAYER_OVERLAY";
const MAX_LINE = 256 * 1024;
const MAX_RESTARTS = 5;
/** Frames per second while nobody looks at a surface, and while the pointer is on it. */
const IDLE_FPS = 30;
const HOVER_FPS = 60;
const SURFACE_ID = /^(island|dock)-\d{1,9}$/;
// The environment of an AppImage or a development shell, which Quickshell must not inherit.
const NOT_FOR_QUICKSHELL = [
  "LD_LIBRARY_PATH",
  "QT_QPA_PLATFORM",
  "QT_PLUGIN_PATH",
  "QML2_IMPORT_PATH",
  "QML_IMPORT_PATH",
  "APPDIR",
  "APPIMAGE",
] as const;

type SurfaceKind = "island" | "dock";
type InputEvent = Parameters<Electron.WebContents["sendInputEvent"]>[0];

export interface LayerOverlayLocation {
  quickshell: string;
  shellQml: string;
}

/** The display of a window, for Quickshell to find the output with the same name or place. */
interface LayerOutput {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line from Quickshell, checked. Anything else is ignored. `screenY`: the pointer's height on the output. */
export interface LayerOverlayInput {
  surface: string;
  event: InputEvent;
  screenY: number | null;
}

/** A line from OpenBot to Quickshell. */
type LayerOverlayMessage =
  | { type: "surface"; surface: string; kind: SurfaceKind; output: LayerOutput }
  | { type: "frame"; surface: string; file: string; seq: number; width: number; height: number }
  | { type: "mask"; surface: string; rects: AgentDockInputRect[] }
  | { type: "cursor"; surface: string; shape: string }
  | { type: "remove"; surface: string }
  | { type: "edge"; edge: "left" | "right" }
  /** Where the dock sits on its output, from its top, as the dock controller places it. */
  | { type: "place"; surface: string; y: number };

function findQuickshell(env: NodeJS.ProcessEnv): string | null {
  const directories = [
    ...(env.PATH ?? "").split(delimiter),
    env.USER ? `/etc/profiles/per-user/${env.USER}/bin` : "",
    env.HOME ? join(env.HOME, ".nix-profile", "bin") : "",
    "/run/current-system/sw/bin",
  ].filter((directory) => directory.length > 0);
  for (const directory of directories) {
    for (const name of ["quickshell", "qs"]) {
      const file = join(directory, name);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * Where to show the island and the dock as layers, or null to keep the X11 windows: not on Linux, not
 * on Hyprland, on a server, switched off, or without Quickshell or the shell file.
 */
export function layerOverlayLocation(
  env: NodeJS.ProcessEnv,
  resourcesPath: string,
  server: boolean,
): LayerOverlayLocation | null {
  if (server || process.platform !== "linux") return null;
  if (!env.HYPRLAND_INSTANCE_SIGNATURE || !env.WAYLAND_DISPLAY || env[LAYER_OVERLAY_SWITCH] === "0") return null;
  const shellQml = join(resourcesPath, "linux-layer-overlay", "shell.qml");
  if (!existsSync(shellQml)) return null;
  const quickshell = findQuickshell(env);
  return quickshell ? { quickshell, shellQml } : null;
}

/** True where the island and the dock show as layers, so they need no restart on XWayland. */
export function layerOverlayAvailable(env: NodeJS.ProcessEnv, resourcesPath: string): boolean {
  return layerOverlayLocation(env, resourcesPath, false) !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const MODIFIERS: ReadonlySet<string> = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "leftButtonDown",
  "middleButtonDown",
  "rightButtonDown",
]);
const BUTTONS = ["left", "middle", "right"] as const;

function modifiersOf(value: DynamicRecord): Electron.InputEvent["modifiers"] {
  if (!("modifiers" in value) || !Array.isArray(value.modifiers)) return [];
  return value.modifiers.filter(
    (modifier): modifier is NonNullable<Electron.InputEvent["modifiers"]>[number] =>
      typeof modifier === "string" && MODIFIERS.has(modifier),
  );
}

/** Rebuilds an input event from the fields that Electron reads, each one checked. */
function inputEvent(value: DynamicRecord): InputEvent | null {
  const type = "type" in value ? value.type : undefined;
  const modifiers = modifiersOf(value);
  if (type === "keyDown" || type === "keyUp" || type === "char") {
    const keyCode = "keyCode" in value ? value.keyCode : undefined;
    if (typeof keyCode !== "string" || keyCode.length === 0 || keyCode.length > 32) return null;
    return { type, keyCode, modifiers };
  }
  const x = "x" in value ? value.x : undefined;
  const y = "y" in value ? value.y : undefined;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const point = { x: Math.round(x), y: Math.round(y), modifiers };
  if (type === "mouseWheel") {
    const deltaX = "deltaX" in value && isFiniteNumber(value.deltaX) ? value.deltaX : 0;
    const deltaY = "deltaY" in value && isFiniteNumber(value.deltaY) ? value.deltaY : 0;
    return { type, ...point, deltaX, deltaY, canScroll: true };
  }
  if (type === "mouseMove" || type === "mouseEnter" || type === "mouseLeave") return { type, ...point };
  if (type === "mouseDown" || type === "mouseUp") {
    const requested = "button" in value ? value.button : "left";
    const button = BUTTONS.find((candidate) => candidate === requested) ?? "left";
    const clickCount =
      "clickCount" in value && isFiniteNumber(value.clickCount)
        ? Math.min(3, Math.max(1, Math.round(value.clickCount)))
        : 1;
    return { type, ...point, button, clickCount };
  }
  return null;
}

/** Checks a line from Quickshell. The input events are the ones of `webContents.sendInputEvent`. */
function parseLayerOverlayInput(line: string): LayerOverlayInput | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDynamicRecord(message) || message.type !== "input") return null;
  const surface = "surface" in message ? message.surface : undefined;
  const event = "event" in message ? message.event : undefined;
  if (typeof surface !== "string" || !SURFACE_ID.test(surface) || !isDynamicRecord(event)) return null;
  const input = inputEvent(event);
  if (!input) return null;
  const screenY = "screenY" in message && isFiniteNumber(message.screenY) ? Math.round(message.screenY) : null;
  return { surface, event: input, screenY };
}

interface Surface {
  id: string;
  kind: SurfaceKind;
  window: BrowserWindow;
  output: LayerOutput;
  seq: number;
  last: Extract<LayerOverlayMessage, { type: "frame" }> | null;
  rects: AgentDockInputRect[];
  /** The shape that the page reports, also while the controller opens the whole window to the pointer. */
  pageRects: AgentDockInputRect[] | null;
  cursor: string;
  /** The dock's height on its output. */
  place: number | null;
}

export class LinuxLayerOverlay {
  readonly #location: LayerOverlayLocation;
  readonly #socketPath: string;
  readonly #frameDir: string;
  readonly #server: Server;
  readonly #surfaces = new Map<string, Surface>();
  #nextId = 1;
  #client: Socket | null = null;
  #child: ChildProcess | null = null;
  #restarts = 0;
  #stopped = false;
  #dockEdge: "left" | "right" | null = null;
  /** The pointer's height on the output of the surface that had the last pointer event. */
  #pointer: { surface: string; y: number } | null = null;

  constructor(location: LayerOverlayLocation, runtimeDirectory: string) {
    this.#location = location;
    this.#socketPath = join(runtimeDirectory, `openbot-layer-${process.pid}.sock`);
    this.#frameDir = join(runtimeDirectory, `openbot-layer-${process.pid}`);
    rmSync(this.#socketPath, { force: true });
    rmSync(this.#frameDir, { recursive: true, force: true });
    mkdirSync(this.#frameDir, { mode: 0o700 });
    this.#server = createServer((socket) => this.#accept(socket));
    this.#server.on("error", (error) => logger.warn("The layer overlay socket failed:", toLogValue(error)));
  }

  start(): void {
    this.#server.listen(this.#socketPath, () => {
      try {
        chmodSync(this.#socketPath, 0o600);
      } catch (error) {
        logger.warn("Could not limit the layer overlay socket to this user:", toLogValue(error));
      }
      this.#spawn();
    });
    logger.info("The Dynamic Island and the agent dock render offscreen and show as Wayland layers (Quickshell).");
  }

  stop(): void {
    this.#stopped = true;
    this.#child?.kill();
    this.#client?.destroy();
    this.#server.close();
    rmSync(this.#socketPath, { force: true });
    rmSync(this.#frameDir, { recursive: true, force: true });
  }

  /**
   * The pointer for the dock's drag, or null to read it from the screen. Over a layer, X11 does not see
   * the pointer, so the drag takes its height from the pointer events of the dock's layer.
   */
  dragPointer(): Electron.Point | null {
    const pointer = this.#pointer;
    const surface = pointer ? this.#surfaces.get(pointer.surface) : undefined;
    if (!pointer || surface?.kind !== "dock" || surface.window.isDestroyed()) return null;
    const display = screen.getDisplayMatching(surface.window.getBounds());
    return { x: display.bounds.x, y: display.bounds.y + pointer.y };
  }

  /** An island window: the same page as `createDynamicIslandWindow`, rendered offscreen. */
  readonly createIslandWindow = (bounds: Rectangle): BrowserWindow => this.#offscreenWindow("island", bounds);
  /** A dock window: the same page as `createAgentDockWindow`, rendered offscreen. */
  readonly createDockWindow = (bounds: Rectangle): BrowserWindow => this.#offscreenWindow("dock", bounds);

  /** The dock's presentation changed: its edge goes to Quickshell. */
  dockPresentationChanged(presentation: AgentDockPresentation | null): void {
    if (!presentation) return;
    this.#dockEdge = presentation.edge;
    this.#write({ type: "edge", edge: presentation.edge });
  }

  /** The page's own shape, which the click area follows while the controller opens the whole window. */
  inputRegionChanged(rendererId: number, rects: AgentDockInputRect[]): void {
    for (const surface of this.#surfaces.values()) {
      if (!surface.window.isDestroyed() && surface.window.webContents.id === rendererId) {
        surface.pageRects = rects.map((rect) => ({ ...rect }));
      }
    }
  }

  #offscreenWindow(kind: SurfaceKind, bounds: Rectangle): BrowserWindow {
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        devTools: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        offscreen: true,
      },
    });
    window.webContents.setZoomMode("isolated");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    this.#adopt(kind, window, bounds);
    return window;
  }

  #outputOf(bounds: Rectangle): LayerOutput {
    const display = screen.getDisplayMatching(bounds);
    return { name: display.label, ...display.bounds };
  }

  #announce(surface: Surface): void {
    this.#write({ type: "surface", surface: surface.id, kind: surface.kind, output: surface.output });
  }

  #adopt(kind: SurfaceKind, window: BrowserWindow, bounds: Rectangle): void {
    const surface: Surface = {
      id: `${kind}-${this.#nextId++}`,
      kind,
      window,
      output: this.#outputOf(bounds),
      seq: 0,
      last: null,
      rects: [],
      pageRects: null,
      cursor: "default",
      place: null,
    };
    this.#surfaces.set(surface.id, surface);
    this.#announce(surface);
    window.webContents.setFrameRate(IDLE_FPS);
    window.webContents.on("paint", (_event, _dirty, image) => {
      if (image.isEmpty()) return;
      const size = image.getSize();
      const file = join(this.#frameDir, `${surface.id}-${surface.seq % 3}.png`);
      try {
        writeFileSync(file, image.toPNG());
      } catch {
        return;
      }
      surface.last = {
        type: "frame",
        surface: surface.id,
        file,
        seq: surface.seq++,
        width: size.width,
        height: size.height,
      };
      this.#write(surface.last);
    });
    window.webContents.on("cursor-changed", (_event, type) => {
      surface.cursor = type;
      this.#write({ type: "cursor", surface: surface.id, shape: type });
    });
    // The window controllers place and shape the window as on X11. Here the shape is the click area of
    // the layer. While the controller opens the whole window to the pointer, the page's own shape counts.
    window.setShape = (rects: Rectangle[]) => {
      const [width = 0, height = 0] = window.getSize();
      const first = rects[0];
      const whole =
        rects.length === 1 && first?.x === 0 && first.y === 0 && first.width >= width && first.height >= height;
      surface.rects = whole && surface.pageRects ? surface.pageRects : rects.map((rect) => ({ ...rect }));
      this.#write({ type: "mask", surface: surface.id, rects: surface.rects });
    };
    // The offscreen window is never on screen, so it can move: its bounds stay the ones that the
    // controller set, and the layer follows them.
    const setBounds = window.setBounds.bind(window);
    window.setBounds = (next: Partial<Rectangle>) => {
      setBounds(next, false);
      this.#follow(surface);
    };
    const setPosition = window.setPosition.bind(window);
    window.setPosition = (x: number, y: number) => {
      setPosition(x, y, false);
      this.#follow(surface);
    };
    this.#follow(surface);
    // A layer shows itself, above every window and on every workspace: nothing here shows a window.
    const nothing = () => undefined;
    window.show = nothing;
    window.showInactive = nothing;
    window.setIgnoreMouseEvents = nothing;
    window.setVisibleOnAllWorkspaces = nothing;
    window.setAlwaysOnTop = nothing;
    window.moveTop = nothing;
    window.on("closed", () => {
      this.#surfaces.delete(surface.id);
      if (this.#pointer?.surface === surface.id) this.#pointer = null;
      this.#write({ type: "remove", surface: surface.id });
    });
  }

  /** The window moved: the layer goes to the output of its display, and the dock to its height there. */
  #follow(surface: Surface): void {
    if (surface.window.isDestroyed()) return;
    const bounds = surface.window.getBounds();
    const output = this.#outputOf(bounds);
    if (
      output.name !== surface.output.name ||
      output.x !== surface.output.x ||
      output.y !== surface.output.y ||
      output.width !== surface.output.width ||
      output.height !== surface.output.height
    ) {
      surface.output = output;
      this.#announce(surface);
    }
    if (surface.kind !== "dock") return;
    const place = Math.max(0, Math.round(bounds.y - output.y));
    if (place === surface.place) return;
    surface.place = place;
    this.#write({ type: "place", surface: surface.id, y: place });
  }

  #spawn(): void {
    if (this.#stopped) return;
    const env: NodeJS.ProcessEnv = { ...process.env, OPENBOT_LAYER_SOCKET: this.#socketPath };
    for (const key of NOT_FOR_QUICKSHELL) delete env[key];
    const child = spawn(this.#location.quickshell, ["-p", this.#location.shellQml], { env, stdio: "ignore" });
    this.#child = child;
    child.on("error", (error) => logger.warn("Quickshell did not start:", toLogValue(error)));
    child.on("exit", (code) => {
      if (this.#child === child) this.#child = null;
      if (this.#stopped) return;
      if (this.#restarts >= MAX_RESTARTS) {
        logger.warn(`Quickshell ended (${code}) ${MAX_RESTARTS} times; the island and the dock stay hidden.`);
        return;
      }
      this.#restarts += 1;
      setTimeout(() => this.#spawn(), 2_000 * this.#restarts);
    });
  }

  #accept(socket: Socket): void {
    this.#client?.destroy();
    this.#client = socket;
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      pending += chunk;
      if (pending.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let end = pending.indexOf("\n");
      while (end >= 0) {
        this.#read(pending.slice(0, end));
        pending = pending.slice(end + 1);
        end = pending.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (this.#client === socket) this.#client = null;
    });
    socket.on("error", () => socket.destroy());
    if (this.#dockEdge) this.#write({ type: "edge", edge: this.#dockEdge });
    for (const surface of this.#surfaces.values()) {
      this.#announce(surface);
      if (surface.last) this.#write(surface.last);
      this.#write({ type: "mask", surface: surface.id, rects: surface.rects });
      this.#write({ type: "cursor", surface: surface.id, shape: surface.cursor });
      if (surface.place !== null) this.#write({ type: "place", surface: surface.id, y: surface.place });
    }
  }

  #read(line: string): void {
    const message = parseLayerOverlayInput(line);
    if (!message) return;
    const surface = this.#surfaces.get(message.surface);
    if (!surface || surface.window.isDestroyed()) return;
    const contents = surface.window.webContents;
    if (message.screenY !== null) this.#pointer = { surface: surface.id, y: message.screenY };
    if (message.event.type === "mouseEnter") contents.setFrameRate(HOVER_FPS);
    else if (message.event.type === "mouseLeave") contents.setFrameRate(IDLE_FPS);
    else if (message.event.type === "mouseDown") contents.focus();
    try {
      contents.sendInputEvent(message.event);
    } catch (error) {
      logger.warn("An input event did not reach the layer overlay page:", toLogValue(error));
    }
  }

  #write(message: LayerOverlayMessage): void {
    const client = this.#client;
    if (client && !client.destroyed) client.write(`${JSON.stringify(message)}\n`);
  }
}
