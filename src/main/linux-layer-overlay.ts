// The Dynamic Island and the agent dock as Wayland layers on Hyprland.
//
// On Linux the island and the dock are X11 windows above other apps (`linux-wayland-output.ts`).
// Hyprland ignores the X11 "above" and "sticky" hints and X11 window shapes, so there they are
// ordinary windows: under other apps and panels, on one workspace, black outside their shape, and
// caught by window rules and by programs that act on windows (such as snow that settles on them).
//
// Where Quickshell is installed, OpenBot renders the same island and dock pages offscreen (Electron
// offscreen rendering) and a small Quickshell instance shows their frames as layers on the Overlay
// layer (`resources/linux-layer-overlay/shell.qml`): above every window and panel, on every workspace,
// and never a window. Quickshell sends the pointer and the keys back, and OpenBot gives them to the
// page as input events. The pages, their look and their behaviour are the ones of the windows.
//
// Two additions only here, where the island is not a window the user can glance at under the menu
// bar: the island opens for a moment by itself when an agent starts a task or needs the user (a reply,
// a question, an approval, a failure), as if the pointer were on it; and the click area follows the
// page's own shape while the island is open, so the empty part of its surface lets clicks through.

import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { delimiter, join } from "node:path";
import {
  type AgentDockEdge,
  type AgentDockInputRect,
  type AgentDockPresentation,
  type DynamicIslandPresentation,
  IPC_ENDPOINTS,
  isAgentDockPresentation,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { BrowserWindow, type Rectangle, screen } from "electron";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";

const logger = createOpenBotLogger("main");

/** Set to "0" to keep the X11 windows on Hyprland. */
export const LAYER_OVERLAY_SWITCH = "OPENBOT_LAYER_OVERLAY";
const MAX_LINE = 256 * 1024;
const MAX_RESTARTS = 5;
/** Frames per second while nobody looks at a surface, and while the pointer is on it. */
const IDLE_FPS = 30;
const HOVER_FPS = 60;
/** How long the island stays open by itself: a new task, and what needs the user. */
const PEEK_TASK_MS = 3_500;
const PEEK_ATTENTION_MS = 6_000;
/** The page needs a moment to show the new presentation before the pointer comes. */
const PEEK_DELAY_MS = 350;
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

/** A line from Quickshell, checked. Anything else is ignored. */
export type LayerOverlayInput =
  /** `screenY`: the pointer's height on the output, for the dock's drag. */
  | { type: "input"; surface: SurfaceKind; event: InputEvent; screenY: number | null }
  | { type: "placement"; movedAway: boolean; dockEdge: "left" | "right" | null };

/** A line from OpenBot to Quickshell. */
type LayerOverlayMessage =
  | { type: "frame"; surface: SurfaceKind; file: string; seq: number; width: number; height: number }
  | { type: "mask"; surface: SurfaceKind; rects: AgentDockInputRect[] }
  | { type: "cursor"; surface: SurfaceKind; shape: string }
  | { type: "hide"; surface: SurfaceKind }
  | { type: "edge"; surface: "dock"; edge: "left" | "right" }
  /** Where the dock sits on its output, from its top, as the dock controller places it. */
  | { type: "place"; surface: "dock"; y: number };

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
export function parseLayerOverlayInput(line: string): LayerOverlayInput | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null || !("type" in message)) return null;
  if (message.type === "placement") {
    const movedAway = "movedAway" in message && message.movedAway === true;
    const edge = "dockEdge" in message ? message.dockEdge : null;
    return { type: "placement", movedAway, dockEdge: edge === "left" || edge === "right" ? edge : null };
  }
  if (message.type !== "input" || !("surface" in message) || !("event" in message)) return null;
  const surface = message.surface;
  const event = message.event;
  if (surface !== "island" && surface !== "dock") return null;
  if (!isDynamicRecord(event)) return null;
  const input = inputEvent(event);
  if (!input) return null;
  const screenY = "screenY" in message && isFiniteNumber(message.screenY) ? Math.round(message.screenY) : null;
  return { type: "input", surface, event: input, screenY };
}

/** The part of a presentation that, when it changes, makes the island open for a moment. */
function peekKey(presentation: DynamicIslandPresentation): string {
  switch (presentation.mode) {
    case "idle":
      return "idle";
    case "working":
      return `working:${presentation.working.map((item) => `${item.agent.id}/${item.task}`).join("|")}`;
    case "message":
      return `message:${presentation.message.messageId}`;
    case "failed":
      return `failed:${presentation.item.turnId}`;
    default:
      return `${presentation.mode}:${String(presentation.item.requestId)}`;
  }
}

/** Whether the island opens for a moment: a new task, or a new item that needs the user. */
export function shouldPeek(previous: DynamicIslandPresentation, next: DynamicIslandPresentation): boolean {
  if (next.mode === "idle" || peekKey(next) === peekKey(previous)) return false;
  if (next.mode !== "working" || previous.mode !== "working") return true;
  // Working: only a task that was not there before.
  return next.working.some(
    (item) => !previous.working.some((old) => old.agent.id === item.agent.id && old.task === item.task),
  );
}

/** A dock presentation on its way to the page, at the edge of the output where the layer is. Null keeps the user's edge. */
export function dockPresentationAtEdge(
  presentation: AgentDockPresentation,
  edge: AgentDockEdge | null,
): AgentDockPresentation {
  return !edge || presentation.edge === edge ? presentation : { ...presentation, edge };
}

interface SurfaceState {
  windows: BrowserWindow[];
  seq: number;
  last: Extract<LayerOverlayMessage, { type: "frame" }> | null;
  rects: AgentDockInputRect[];
  /** The shape that the page reports, also while the controller opens the whole window to the pointer. */
  pageRects: AgentDockInputRect[] | null;
  cursor: string;
  pointerInside: boolean;
}

export class LinuxLayerOverlay {
  readonly #location: LayerOverlayLocation;
  readonly #socketPath: string;
  readonly #frameDir: string;
  readonly #server: Server;
  readonly #surfaces: Record<SurfaceKind, SurfaceState> = {
    island: { windows: [], seq: 0, last: null, rects: [], pageRects: null, cursor: "default", pointerInside: false },
    dock: { windows: [], seq: 0, last: null, rects: [], pageRects: null, cursor: "default", pointerInside: false },
  };
  #client: Socket | null = null;
  #child: ChildProcess | null = null;
  #restarts = 0;
  #stopped = false;
  #placement: { movedAway: boolean; dockEdge: "left" | "right" | null } = { movedAway: false, dockEdge: null };
  #dockPresentation: AgentDockPresentation | null = null;
  #peekTimer: ReturnType<typeof setTimeout> | null = null;
  /** The pointer's height on the dock's output, from the last pointer event on a surface. */
  #pointerY: number | null = null;
  #dockPlace: number | null = null;
  #peeking = false;

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
    if (this.#peekTimer) clearTimeout(this.#peekTimer);
    this.#child?.kill();
    this.#client?.destroy();
    this.#server.close();
    rmSync(this.#socketPath, { force: true });
    rmSync(this.#frameDir, { recursive: true, force: true });
  }

  /**
   * The pointer for the dock's drag, or null to read it from the screen. Over a layer, X11 does not see
   * the pointer, so the drag takes its height from the pointer events of the layer.
   */
  dragPointer(): Electron.Point | null {
    const dock = this.#active("dock");
    if (this.#pointerY === null || !dock) return null;
    const display = screen.getDisplayMatching(dock.getBounds());
    return { x: display.bounds.x, y: display.bounds.y + this.#pointerY };
  }

  /** The island window: the same page as `createDynamicIslandWindow`, rendered offscreen. */
  readonly createIslandWindow = (bounds: Rectangle): BrowserWindow => this.#offscreenWindow("island", bounds);
  /** The dock window: the same page as `createAgentDockWindow`, rendered offscreen. */
  readonly createDockWindow = (bounds: Rectangle): BrowserWindow => this.#offscreenWindow("dock", bounds);

  /** The island's presentation changed: it opens for a moment for a new task or an item that needs the user. */
  islandPresentationChanged(previous: DynamicIslandPresentation, next: DynamicIslandPresentation): void {
    if (shouldPeek(previous, next)) this.#peek(next.mode === "working" ? PEEK_TASK_MS : PEEK_ATTENTION_MS);
  }

  /**
   * The dock's presentation changed: its edge goes to Quickshell. The controller sends it to the page
   * itself, through `#adopt`'s send, which gives a dock on another output that output's far edge.
   */
  dockPresentationChanged(presentation: AgentDockPresentation | null): void {
    this.#dockPresentation = presentation;
    if (presentation) this.#write({ type: "edge", surface: "dock", edge: presentation.edge });
  }

  /** The page's own shape, which the click area follows while the controller opens the whole window. */
  inputRegionChanged(kind: SurfaceKind, rendererId: number, rects: AgentDockInputRect[]): void {
    const window = this.#active(kind);
    if (window && window.webContents.id === rendererId)
      this.#surfaces[kind].pageRects = rects.map((rect) => ({ ...rect }));
  }

  #active(kind: SurfaceKind): BrowserWindow | null {
    return this.#surfaces[kind].windows.find((window) => !window.isDestroyed()) ?? null;
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
    this.#adopt(kind, window);
    return window;
  }

  #adopt(kind: SurfaceKind, window: BrowserWindow): void {
    const surface = this.#surfaces[kind];
    const shown = () => this.#active(kind) === window;
    surface.windows.push(window);
    // One island and one dock show: another display's window does not paint.
    if (!shown()) {
      window.webContents.once("did-finish-load", () => {
        if (!shown()) window.webContents.stopPainting();
      });
    }
    window.webContents.setFrameRate(IDLE_FPS);
    window.webContents.on("paint", (_event, _dirty, image) => {
      if (!shown() || image.isEmpty()) return;
      const size = image.getSize();
      const file = join(this.#frameDir, `${kind}-${surface.seq % 3}.png`);
      try {
        writeFileSync(file, image.toPNG());
      } catch {
        return;
      }
      surface.last = { type: "frame", surface: kind, file, seq: surface.seq++, width: size.width, height: size.height };
      this.#write(surface.last);
    });
    window.webContents.on("cursor-changed", (_event, type) => {
      if (!shown()) return;
      surface.cursor = type;
      this.#write({ type: "cursor", surface: kind, shape: type });
    });
    // The window controllers place and shape the window as on X11. Here the shape is the click area,
    // only the size counts, and nothing shows a window.
    window.setShape = (rects: Rectangle[]) => {
      if (!shown()) return;
      const [width = 0, height = 0] = window.getSize();
      const whole =
        rects.length === 1 &&
        rects[0]?.x === 0 &&
        rects[0]?.y === 0 &&
        (rects[0]?.width ?? 0) >= width &&
        (rects[0]?.height ?? 0) >= height;
      surface.rects = whole && surface.pageRects ? surface.pageRects : rects.map((rect) => ({ ...rect }));
      this.#write({ type: "mask", surface: kind, rects: surface.rects });
    };
    const setSize = window.setSize.bind(window);
    const getBounds = window.getBounds.bind(window);
    window.setBounds = (bounds: Partial<Rectangle>) => {
      if (kind === "dock" && bounds.y !== undefined) this.#placeDock({ ...getBounds(), ...bounds });
      if (!bounds.width || !bounds.height) return;
      const [width, height] = window.getSize();
      if (width !== bounds.width || height !== bounds.height) setSize(bounds.width, bounds.height, false);
    };
    if (kind === "dock") this.#placeDock(getBounds());
    const nothing = () => undefined;
    window.setPosition = nothing;
    window.show = nothing;
    window.showInactive = nothing;
    window.setIgnoreMouseEvents = nothing;
    window.setVisibleOnAllWorkspaces = nothing;
    window.setAlwaysOnTop = nothing;
    window.moveTop = nothing;
    window.on("closed", () => {
      const wasShown = surface.windows[0] === window;
      surface.windows = surface.windows.filter((other) => other !== window);
      if (!wasShown) return;
      const next = this.#active(kind);
      if (!next) {
        surface.last = null;
        this.#write({ type: "hide", surface: kind });
        return;
      }
      next.webContents.startPainting();
      next.webContents.invalidate();
    });
    if (kind === "dock") {
      // Every presentation that reaches the page, from the controller or from here, takes the edge of
      // the output where the layer is. The controller sends after its hook runs, so a copy sent from
      // the hook alone would be replaced at once by the presentation for the primary output's edge.
      const contents = window.webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        if (channel !== IPC_ENDPOINTS.agentDock.presentation.channel) {
          send(channel, ...args);
          return;
        }
        const edge = this.#placement.movedAway ? this.#placement.dockEdge : null;
        send(
          channel,
          ...args.map((value) => (isAgentDockPresentation(value) ? dockPresentationAtEdge(value, edge) : value)),
        );
      };
      window.webContents.on("did-finish-load", () => setTimeout(() => this.#sendDockPresentation(), 50));
    }
  }

  /** The dock controller placed the dock: the layer takes the same height on its output. */
  #placeDock(bounds: Rectangle): void {
    const display = screen.getDisplayMatching(bounds);
    this.#dockPlace = Math.max(0, Math.round(bounds.y - display.bounds.y));
    this.#write({ type: "place", surface: "dock", y: this.#dockPlace });
  }

  /** Sends the dock's presentation again, when the layers move to another output or back. */
  #sendDockPresentation(): void {
    const presentation = this.#dockPresentation;
    const window = this.#active("dock");
    if (!presentation || !window) return;
    sendToRenderer(window, IPC_ENDPOINTS.agentDock.presentation, presentation);
  }

  #peek(durationMs: number): void {
    const surface = this.#surfaces.island;
    if (surface.pointerInside) return;
    const window = this.#active("island");
    if (!window) return;
    const [width = 0] = window.getSize();
    const rect = surface.pageRects?.[0] ?? { x: Math.round(width / 2) - 100, y: 0, width: 200, height: 40 };
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + Math.min(rect.height, 44) / 2);
    if (this.#peekTimer) clearTimeout(this.#peekTimer);
    this.#peekTimer = setTimeout(() => {
      if (surface.pointerInside || window.isDestroyed()) return;
      this.#peeking = true;
      window.webContents.setFrameRate(HOVER_FPS);
      window.webContents.sendInputEvent({ type: "mouseEnter", x, y });
      window.webContents.sendInputEvent({ type: "mouseMove", x, y });
      this.#peekTimer = setTimeout(() => this.#endPeek(true), durationMs);
    }, PEEK_DELAY_MS);
  }

  #endPeek(leave: boolean): void {
    if (this.#peekTimer) clearTimeout(this.#peekTimer);
    this.#peekTimer = null;
    if (!this.#peeking) return;
    this.#peeking = false;
    const window = this.#active("island");
    if (!leave || !window || this.#surfaces.island.pointerInside) return;
    const [, height = 1] = window.getSize();
    window.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: height - 1 });
    window.webContents.sendInputEvent({ type: "mouseLeave", x: 1, y: height - 1 });
    window.webContents.setFrameRate(IDLE_FPS);
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
    for (const kind of ["island", "dock"] as const) {
      const surface = this.#surfaces[kind];
      if (surface.last) this.#write(surface.last);
      this.#write({ type: "mask", surface: kind, rects: surface.rects });
      this.#write({ type: "cursor", surface: kind, shape: surface.cursor });
    }
    if (this.#dockPresentation) this.#write({ type: "edge", surface: "dock", edge: this.#dockPresentation.edge });
    if (this.#dockPlace !== null) this.#write({ type: "place", surface: "dock", y: this.#dockPlace });
  }

  #read(line: string): void {
    const message = parseLayerOverlayInput(line);
    if (!message) return;
    if (message.type === "placement") {
      this.#placement = { movedAway: message.movedAway, dockEdge: message.dockEdge };
      this.#sendDockPresentation();
      return;
    }
    const window = this.#active(message.surface);
    if (!window) return;
    if (message.screenY !== null) this.#pointerY = message.screenY;
    const surface = this.#surfaces[message.surface];
    if (message.event.type === "mouseEnter") {
      surface.pointerInside = true;
      window.webContents.setFrameRate(HOVER_FPS);
      if (message.surface === "island") this.#endPeek(false);
    } else if (message.event.type === "mouseLeave") {
      surface.pointerInside = false;
      window.webContents.setFrameRate(IDLE_FPS);
    } else if (message.event.type === "mouseDown") {
      window.webContents.focus();
    }
    try {
      window.webContents.sendInputEvent(message.event);
    } catch (error) {
      logger.warn("An input event did not reach the layer overlay page:", toLogValue(error));
    }
  }

  #write(message: LayerOverlayMessage): void {
    const client = this.#client;
    if (client && !client.destroyed) client.write(`${JSON.stringify(message)}\n`);
  }
}
