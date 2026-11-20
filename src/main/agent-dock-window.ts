import { isDeepStrictEqual } from "node:util";
import type {
  AgentDockAction,
  AgentDockDisplayInfo,
  AgentDockDragPhase,
  AgentDockEdge,
  AgentDockInputRect,
  AgentDockPresentation,
  SetAgentDockInteractiveInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_DOCK_LIMITS,
  AGENT_DOCK_SIZE_LIMITS,
  IPC_ENDPOINTS,
  sameAgentDockDisplayBounds,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import type { BrowserWindow, Display, Rectangle, Screen } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import { forceActivateX11Window } from "./linux-x11-activation";
import { letPointerThrough, type PointerForwardingGate } from "./pointer-forwarding-gate";
import { sendToRenderer } from "./renderer-ipc";
import type { WindowsTopmostKeeper } from "./windows-topmost-keeper";

const logger = createOpenBotLogger("agent-dock-window");

const AGENT_DOCK_WINDOW_SIZE = { width: 502, height: 640 } as const;

const DOCK_REOPEN_MAX = 3;
const DOCK_REOPEN_WINDOW_MS = 60_000;

export type AgentDockSendAction = Extract<AgentDockAction, { type: "send" }>;

export class AgentDockFailed extends Schema.TaggedError<AgentDockFailed>()("AgentDockFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toAgentDockFailed } = causeHelpers(AgentDockFailed);

type AgentDockWindowKind = "panel" | "tool" | "x11";

export interface AgentDockWindowControllerOptions {
  windowKind: AgentDockWindowKind | null;
  createWindow: (bounds: Rectangle) => BrowserWindow;
  loadWindow: (window: BrowserWindow) => Promise<void>;
  screen: Pick<Screen, "getAllDisplays" | "getPrimaryDisplay" | "getDisplayMatching" | "getCursorScreenPoint">;
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  sendMessage: (action: AgentDockSendAction) => Effect.Effect<void, AgentDockFailed>;
  pointerForwarding?: PointerForwardingGate | null;
  topmost?: WindowsTopmostKeeper | null;
  logger?: Logger;
}

interface DockWindow {
  window: BrowserWindow;
  rendererId: number;
  displayId: number;
  shape?: AgentDockInputRect[];
  interactive?: boolean;
  keyboard?: boolean;
}

export class AgentDockWindowController {
  readonly #options: AgentDockWindowControllerOptions;
  #presentation: AgentDockPresentation | null = null;
  #windows: DockWindow[] = [];
  #chatOwner: number | null = null;
  readonly #sends = new Map<string, Deferred.Deferred<void, AgentDockFailed>>();
  readonly #reconciliation = Semaphore.makeUnsafe(1);
  #offsets = new Map<number, number>();
  #drag: { rendererId: number; pointerY: number; windowY: number } | null = null;
  readonly #followedWindows = new WeakSet<BrowserWindow>();
  #reopens: number[] = [];
  #destroyed = false;

  constructor(options: AgentDockWindowControllerOptions) {
    this.#options = options;
  }

  get presentation(): AgentDockPresentation | null {
    return this.#presentation;
  }

  get mainRendererIds(): ReadonlySet<number> {
    const window = this.#options.getMainWindow();
    return new Set(window && !window.isDestroyed() ? [window.webContents.id] : []);
  }

  get dockRendererIds(): ReadonlySet<number> {
    return new Set(this.#liveWindows().map(({ rendererId }) => rendererId));
  }

  #liveWindows(): DockWindow[] {
    return this.#windows.filter(({ window }) => !window.isDestroyed());
  }

  publish(presentation: AgentDockPresentation | null): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#followMainWindow();
      if (isDeepStrictEqual(this.#presentation, presentation)) return Effect.void;
      const previous = this.#presentation;
      this.#presentation = presentation;
      for (const { window } of this.#liveWindows()) {
        sendToRenderer(window, IPC_ENDPOINTS.agentDock.presentation, presentation);
      }
      const dragged = this.#draggedDisplayId();
      const dragOffset = dragged === null ? undefined : this.#offsets.get(dragged);
      this.#offsets = new Map((presentation?.offsets ?? []).map(({ displayId, offset }) => [displayId, offset]));
      if (dragged !== null && dragOffset !== undefined) this.#offsets.set(dragged, dragOffset);
      const moved =
        (previous === null) !== (presentation === null) ||
        !isDeepStrictEqual(previous?.display, presentation?.display) ||
        previous?.edge !== presentation?.edge ||
        previous?.sizePercent !== presentation?.sizePercent ||
        !isDeepStrictEqual(previous?.offsets, presentation?.offsets);
      return moved ? this.reconcileWindow() : Effect.void;
    });
  }

  listDisplays(): AgentDockDisplayInfo[] {
    const primary = this.#options.screen.getPrimaryDisplay();
    return this.#options.screen
      .getAllDisplays()
      .slice(0, AGENT_DOCK_LIMITS.displays)
      .map((display) => ({
        id: display.id,
        label: display.label.slice(0, AGENT_DOCK_LIMITS.displayLabel),
        primary: display.id === primary.id,
        internal: display.internal,
      }));
  }

  #targetDisplays(): Display[] {
    const { screen } = this.#options;
    const choice = this.#presentation?.display;
    if (choice?.kind === "all") return screen.getAllDisplays().slice(0, AGENT_DOCK_LIMITS.displays);
    if (choice?.kind === "primary") return [screen.getPrimaryDisplay()];
    if (choice?.kind === "display") {
      const chosen = screen.getAllDisplays().find((display) => display.id === choice.id);
      if (chosen) return [chosen];
    }
    const main = this.#options.getMainWindow();
    return [main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay()];
  }

  #followMainWindow(): void {
    const main = this.#options.getMainWindow();
    if (!main || main.isDestroyed() || this.#followedWindows.has(main)) return;
    this.#followedWindows.add(main);
    const follow = () => {
      if (this.#windows.length === 0 || this.#presentation?.display.kind !== "window") return;
      void Effect.runPromise(this.reconcileWindow());
    };
    main.on("moved", follow);
    main.on("resized", follow);
    main.on("enter-full-screen", follow);
    main.on("leave-full-screen", follow);
    main.webContents.on("did-finish-load", () => {
      const owner = this.#liveWindows().find((entry) => entry.rendererId === this.#chatOwner);
      this.#chatOwner = null;
      if (owner) sendToRenderer(owner.window, IPC_ENDPOINTS.agentDock.closeChat);
    });
  }

  setInteractive(rendererId: number, input: SetAgentDockInteractiveInput): void {
    const entry = this.#liveWindows().find((item) => item.rendererId === rendererId);
    if (!entry) return;
    const { window } = entry;
    entry.interactive = input.interactive;
    if (this.#options.windowKind !== "x11") this.#letPointerThrough(entry);
    const keyboard = input.keyboard === true;
    window.setFocusable(keyboard);
    if (keyboard && !entry.keyboard && !window.isFocused()) {
      window.focus();
      if (this.#options.windowKind === "x11") forceActivateX11Window(window);
    }
    entry.keyboard = keyboard;
  }

  setInputRegion(rendererId: number, rects: AgentDockInputRect[]): void {
    const entry = this.#liveWindows().find((item) => item.rendererId === rendererId);
    if (!entry) return;
    entry.shape = rects;
    this.#applyShape(entry);
  }

  #applyShape(entry: DockWindow): void {
    if (!entry.shape) return;
    const rects = entry.shape.map((rect) => zoomedRect(rect, this.#zoom()));
    if (this.#options.windowKind === "x11") entry.window.setShape(rects);
    if (this.#options.windowKind !== "tool") return;
    if (rects.length > 0) entry.window.setShape(rects);
    this.#letPointerThrough(entry);
    if (rects.length === 0) entry.window.setShape([]);
  }

  #letPointerThrough(entry: DockWindow): void {
    const fixedRegion = this.#options.windowKind === "tool" && (entry.shape?.length ?? 0) > 0;
    letPointerThrough(this.#options.pointerForwarding, entry.window, !fixedRegion && entry.interactive !== true);
  }

  drag(rendererId: number, phase: AgentDockDragPhase): void {
    const entry = this.#liveWindows().find((item) => item.rendererId === rendererId);
    if (!entry) return;
    const pointerY = this.#options.screen.getCursorScreenPoint().y;
    if (phase === "start") {
      this.#drag = { rendererId, pointerY, windowY: entry.window.getBounds().y };
      return;
    }
    const drag = this.#drag;
    if (drag?.rendererId !== rendererId) return;
    const display = this.#displayOf(entry);
    if (display) {
      const area = display.workArea;
      const room = area.height - agentDockWindowHeight(display, this.#zoom());
      const y = drag.windowY + pointerY - drag.pointerY;
      const offset = room > 0 ? Math.min(1, Math.max(0, (y - area.y) / room)) : 0.5;
      this.#offsets.set(entry.displayId, offset);
      const bounds = this.#boundsFor(display);
      if (!isDeepStrictEqual(entry.window.getBounds(), bounds)) entry.window.setBounds(bounds, false);
    }
    if (phase !== "end") return;
    this.#drag = null;
    const offset = this.#offsets.get(entry.displayId);
    const main = this.#options.getMainWindow();
    if (offset !== undefined && main && !main.isDestroyed()) {
      sendToRenderer(main, IPC_ENDPOINTS.agentDock.moved, {
        displayId: entry.displayId,
        offset,
        ...(display && { bounds: display.bounds }),
      });
    }
  }

  #draggedDisplayId(): number | null {
    const drag = this.#drag;
    if (!drag) return null;
    return this.#liveWindows().find((item) => item.rendererId === drag.rendererId)?.displayId ?? null;
  }

  #displayOf(entry: DockWindow): Display | undefined {
    return this.#options.screen.getAllDisplays().find((display) => display.id === entry.displayId);
  }

  #boundsFor(display: Display): Rectangle {
    return agentDockWindowBounds(display, this.#presentation?.edge ?? "right", this.#offsetFor(display), this.#zoom());
  }

  #offsetFor(display: Display): number {
    const saved = this.#offsets.get(display.id);
    if (saved !== undefined) return saved;
    const connected = new Set(this.#options.screen.getAllDisplays().map(({ id }) => id));
    const renamed = (this.#presentation?.offsets ?? []).findLast(
      (item) => !connected.has(item.displayId) && sameAgentDockDisplayBounds(item.bounds, display.bounds),
    );
    return renamed?.offset ?? 0.5;
  }

  #zoom(): number {
    return (this.#presentation?.sizePercent ?? AGENT_DOCK_SIZE_LIMITS.default) / 100;
  }

  #applyZoom(entry: DockWindow): void {
    const zoom = this.#zoom();
    if (entry.window.webContents.getZoomFactor() === zoom) return;
    entry.window.webContents.setZoomFactor(zoom);
    this.#applyShape(entry);
  }

  performAction(rendererId: number, action: AgentDockAction): Effect.Effect<void, AgentDockFailed> {
    return Effect.suspend(() => {
      if (action.type === "send") return this.#send(action);
      if (action.type === "open-chat") {
        if (action.seat === null && this.#chatOwner !== rendererId) return Effect.void;
        const previous = this.#liveWindows().find((entry) => entry.rendererId === this.#chatOwner);
        if (previous && previous.rendererId !== rendererId) {
          sendToRenderer(previous.window, IPC_ENDPOINTS.agentDock.closeChat);
        }
        this.#chatOwner = action.seat === null ? null : rendererId;
      }
      return Effect.gen({ self: this }, function* () {
        const window = yield* this.#ensureMainWindow();
        if (action.type === "open-agent" || action.type === "open-channel" || action.type === "open-settings") {
          this.#options.presentMainWindow(window);
        }
        if (!sendToRenderer(window, IPC_ENDPOINTS.agentDock.action, action)) {
          return yield* new AgentDockFailed({
            cause: new Error(sourceText("error.backend.windowTemporarilyUnavailable")),
          });
        }
      });
    });
  }

  #send(action: AgentDockSendAction): Effect.Effect<void, AgentDockFailed> {
    const key = [action.serverId, action.seat.kind, action.seat.id, action.clientMessageId].join("\u0000");
    const existing = this.#sends.get(key);
    if (existing) return Deferred.await(existing);
    const done = Deferred.makeUnsafe<void, AgentDockFailed>();
    this.#sends.set(key, done);
    return this.#options.sendMessage(action).pipe(
      Effect.onExit((exit) => {
        if (this.#sends.get(key) === done) this.#sends.delete(key);
        return Deferred.done(done, exit);
      }),
    );
  }

  #ensureMainWindow(): Effect.Effect<BrowserWindow, AgentDockFailed> {
    return Effect.gen({ self: this }, function* () {
      const current = this.#options.getMainWindow();
      if (current && !current.isDestroyed()) return current;
      const ensureMainWindow = this.#options.ensureMainWindow;
      const created = ensureMainWindow
        ? yield* Effect.tryPromise({
            try: () => ensureMainWindow(),
            catch: (cause) => new AgentDockFailed({ cause }),
          })
        : undefined;
      if (!created || created.isDestroyed()) {
        return yield* new AgentDockFailed({ cause: new Error(sourceText("error.backend.windowUnavailable")) });
      }
      return created;
    });
  }

  reconcileWindow(): Effect.Effect<void> {
    return this.#reconciliation
      .withPermit(
        Effect.suspend(() => {
          if (this.#destroyed || this.#options.windowKind === null) {
            this.#destroyWindow();
            return Effect.void;
          }
          this.#windows = this.#liveWindows();
          if (this.#presentation === null) {
            for (const { window } of this.#windows) window.hide();
            return Effect.void;
          }
          const targets = this.#targetDisplays();
          const targetIds = new Set(targets.map((display) => display.id));
          const spare = this.#windows.filter((entry) => !targetIds.has(entry.displayId));
          const opens: Display[] = [];
          for (const display of targets) {
            const current = this.#windows.find((entry) => entry.displayId === display.id) ?? spare.shift();
            if (!current) {
              opens.push(display);
              continue;
            }
            current.displayId = display.id;
            this.#applyZoom(current);
            const bounds = this.#boundsFor(display);
            if (!isDeepStrictEqual(current.window.getBounds(), bounds)) current.window.setBounds(bounds, false);
            if (!current.window.isVisible()) this.#show(current.window);
          }
          for (const entry of spare) this.#closeWindow(entry.window);
          return Effect.forEach(opens, (display) =>
            this.#openWindow(display).pipe(
              Effect.catch((error) =>
                Effect.sync(() =>
                  (this.#options.logger ?? logger).error("Unable to load the agent dock:", toLogValue(error.cause)),
                ),
              ),
            ),
          );
        }),
      )
      .pipe(Effect.asVoid);
  }

  #openWindow(display: Display): Effect.Effect<void, AgentDockFailed> {
    return Effect.try({
      try: () => {
        const window = this.#options.createWindow(this.#boundsFor(display));
        const entry: DockWindow = { window, rendererId: window.webContents.id, displayId: display.id };
        this.#windows.push(entry);
        const owned = () => this.#windows.includes(entry) && !window.isDestroyed();
        window.setHasShadow(false);
        window.setAlwaysOnTop(true, this.#options.windowKind === "panel" ? "floating" : "normal");
        this.#options.topmost?.keep(window);
        if (this.#options.windowKind === "panel") {
          window.excludedFromShownWindowsMenu = true;
          window.setWindowButtonVisibility(false);
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
          window.setHiddenInMissionControl(true);
        }
        if (this.#options.windowKind === "x11") {
          window.setShape([]);
        } else {
          letPointerThrough(this.#options.pointerForwarding, window, true);
        }
        window.setFocusable(false);
        window.webContents.on("did-navigate", () => {
          if (owned()) this.#applyZoom(entry);
        });
        window.webContents.on("did-finish-load", () => {
          if (!owned()) return;
          this.#release(entry);
          sendToRenderer(window, IPC_ENDPOINTS.agentDock.presentation, this.#presentation);
        });
        window.webContents.on("render-process-gone", () => {
          if (!owned()) return;
          this.#closeWindow(window);
          if (this.#mayReopen()) void Effect.runPromise(this.reconcileWindow());
        });
        window.once("ready-to-show", () => {
          if (!owned() || this.#presentation === null) return;
          this.#show(window);
        });
        window.on("move", () => {
          if (!owned()) return;
          const display = this.#displayOf(entry);
          if (!display) return;
          const expected = this.#boundsFor(display);
          const { x, y } = window.getBounds();
          if (x !== expected.x || y !== expected.y) window.setBounds(expected, false);
        });
        window.on("closed", () => {
          this.#forget(window);
        });
        return window;
      },
      catch: (cause) => new AgentDockFailed({ cause }),
    }).pipe(
      Effect.flatMap((window) =>
        Effect.tryPromise({
          try: () => this.#options.loadWindow(window),
          catch: (cause) => new AgentDockFailed({ cause }),
        }).pipe(Effect.tapError(() => Effect.sync(() => this.#closeWindow(window)))),
      ),
    );
  }

  #mayReopen(): boolean {
    const now = Date.now();
    this.#reopens = this.#reopens.filter((time) => now - time < DOCK_REOPEN_WINDOW_MS);
    if (this.#reopens.length >= DOCK_REOPEN_MAX) return false;
    this.#reopens.push(now);
    return true;
  }

  #show(window: BrowserWindow): void {
    window.showInactive();
    if (this.#options.windowKind === "x11") window.setVisibleOnAllWorkspaces(true);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#destroyWindow();
  }

  #destroyWindow(): void {
    for (const { window } of this.#windows) this.#closeWindow(window);
  }

  #closeWindow(window: BrowserWindow): void {
    this.#forget(window);
    if (!window.isDestroyed()) window.destroy();
  }

  #forget(window: BrowserWindow): void {
    const entry = this.#windows.find((item) => item.window === window);
    if (!entry) return;
    this.#windows = this.#windows.filter((item) => item !== entry);
    this.#release(entry);
  }

  #release(entry: DockWindow): void {
    entry.keyboard = false;
    if (this.#drag?.rendererId === entry.rendererId) this.#drag = null;
    if (this.#chatOwner !== entry.rendererId) return;
    this.#chatOwner = null;
    const main = this.#options.getMainWindow();
    const serverId = this.#presentation?.serverId;
    if (main && !main.isDestroyed() && serverId !== undefined) {
      sendToRenderer(main, IPC_ENDPOINTS.agentDock.action, { type: "open-chat", serverId, seat: null });
    }
  }
}

function agentDockWindowHeight(display: Pick<Display, "workArea">, zoom: number): number {
  return Math.min(Math.round(AGENT_DOCK_WINDOW_SIZE.height * zoom), display.workArea.height);
}

function agentDockWindowBounds(
  display: Pick<Display, "workArea">,
  edge: AgentDockEdge,
  offset: number,
  zoom: number,
): Rectangle {
  const area = display.workArea;
  const width = Math.round((AGENT_DOCK_WINDOW_SIZE.width * AGENT_DOCK_SIZE_LIMITS.max) / 100);
  const height = agentDockWindowHeight(display, zoom);
  return {
    x: edge === "left" ? area.x : area.x + area.width - width,
    y: Math.round(area.y + (area.height - height) * offset),
    width,
    height,
  };
}

function zoomedRect(rect: AgentDockInputRect, zoom: number): AgentDockInputRect {
  const x = Math.floor(rect.x * zoom);
  const y = Math.floor(rect.y * zoom);
  return {
    x,
    y,
    width: Math.ceil((rect.x + rect.width) * zoom) - x,
    height: Math.ceil((rect.y + rect.height) * zoom) - y,
  };
}

export function requireAgentDockSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) {
    throw new Error(`Rejected agent dock IPC request outside the ${name}.`);
  }
}
