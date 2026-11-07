// The agent dock windows: transparent panels at the left or right edge of a display, above the other
// apps. One display has the dock, or each display has one. The user drags a dock up or down its edge. The main renderer publishes what the docks show. The
// dock windows send their actions here: main sends the messages typed in a dock and gives the other
// actions to the main renderer.

import { isDeepStrictEqual } from "node:util";
import type {
  AgentDockAction,
  AgentDockDisplayInfo,
  AgentDockDragPhase,
  AgentDockEdge,
  AgentDockPresentation,
  SetAgentDockInteractiveInput,
} from "@openbot/contracts/ipc";
import { AGENT_DOCK_LIMITS, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import type { BrowserWindow, Display, Rectangle, Screen } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import { sendToRenderer } from "./renderer-ipc";

const logger = createOpenBotLogger("agent-dock-window");

/**
 * The open chat panel, the neck and the dock (462 × 560), and the 40px of liquid that the goo filter
 * spreads above, below and left of them.
 */
const AGENT_DOCK_WINDOW_SIZE = { width: 502, height: 640 } as const;

export type AgentDockSendAction = Extract<AgentDockAction, { type: "send" }>;

/** An agent dock operation that failed. The cause is what the dock window reads. */
export class AgentDockFailed extends Schema.TaggedError<AgentDockFailed>()("AgentDockFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toAgentDockFailed } = causeHelpers(AgentDockFailed);

export interface AgentDockWindowControllerOptions {
  platform: NodeJS.Platform;
  createWindow: (bounds: Rectangle) => BrowserWindow;
  loadWindow: (window: BrowserWindow) => Promise<void>;
  /** The displays that can hold the dock. */
  screen: Pick<Screen, "getAllDisplays" | "getPrimaryDisplay" | "getDisplayMatching" | "getCursorScreenPoint">;
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  sendMessage: (action: AgentDockSendAction) => Effect.Effect<void, AgentDockFailed>;
  logger?: Logger;
}

/** A dock window and the display that it is on. */
interface DockWindow {
  window: BrowserWindow;
  rendererId: number;
  displayId: number;
}

export class AgentDockWindowController {
  readonly #options: AgentDockWindowControllerOptions;
  #presentation: AgentDockPresentation | null = null;
  #windows: DockWindow[] = [];
  /**
   * The dock window that has the open chat. Only one chat is open: a dock that closes its chat after
   * another dock opened one does not close that chat.
   */
  #chatOwner: number | null = null;
  /** One send per draft, shared by the retries that send it again. */
  readonly #sends = new Map<string, Deferred.Deferred<void, AgentDockFailed>>();
  readonly #reconciliation = Semaphore.makeUnsafe(1);
  /** The saved position of the dock on each display, from the presentation and the current drag. */
  #offsets = new Map<number, number>();
  /** The drag in progress: the dock window, and the pointer and window y when it started. */
  #drag: { rendererId: number; pointerY: number; windowY: number } | null = null;
  /** The main windows whose moves the dock follows. A new main window is added when it publishes. */
  readonly #followedWindows = new WeakSet<BrowserWindow>();
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

  /** Null hides the dock, for example when no server is active. */
  publish(presentation: AgentDockPresentation | null): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#followMainWindow();
      if (isDeepStrictEqual(this.#presentation, presentation)) return Effect.void;
      const previous = this.#presentation;
      this.#presentation = presentation;
      for (const { window } of this.#liveWindows()) {
        sendToRenderer(window, IPC_ENDPOINTS.agentDock.presentation, presentation);
      }
      // The dragged dock keeps the position of the drag until the drag ends.
      const dragged = this.#draggedDisplayId();
      const dragOffset = dragged === null ? undefined : this.#offsets.get(dragged);
      this.#offsets = new Map((presentation?.offsets ?? []).map(({ displayId, offset }) => [displayId, offset]));
      if (dragged !== null && dragOffset !== undefined) this.#offsets.set(dragged, dragOffset);
      const moved =
        (previous === null) !== (presentation === null) ||
        !isDeepStrictEqual(previous?.display, presentation?.display) ||
        previous?.edge !== presentation?.edge ||
        !isDeepStrictEqual(previous?.offsets, presentation?.offsets);
      return moved ? this.reconcileWindow() : Effect.void;
    });
  }

  /** The connected displays, for the display setting. */
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

  /**
   * The displays that the user chose: each display, or one. The main window's display when the choice
   * is the main window, or when the chosen display is not connected; the primary display when there is
   * no main window.
   */
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

  /** The dock goes with the main window to another display. macOS sends "moved" when a drag ends. */
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
    // A new main renderer has no open dock chat, so the dock that shows one closes it.
    main.webContents.on("did-finish-load", () => {
      const owner = this.#liveWindows().find((entry) => entry.rendererId === this.#chatOwner);
      this.#chatOwner = null;
      if (owner) sendToRenderer(owner.window, IPC_ENDPOINTS.agentDock.closeChat);
    });
  }

  /**
   * Outside the dock shapes, the pointer goes to the apps under the window. The window takes key input
   * only while the chat composer needs it: a panel becomes key without activating the app.
   */
  setInteractive(rendererId: number, input: SetAgentDockInteractiveInput): void {
    const window = this.#liveWindows().find((entry) => entry.rendererId === rendererId)?.window;
    if (!window) return;
    window.setIgnoreMouseEvents(!input.interactive, { forward: true });
    const keyboard = input.keyboard === true;
    window.setFocusable(keyboard);
    if (keyboard && !window.isFocused()) window.focus();
  }

  /**
   * Moves the dock window up or down its edge with the pointer, inside the work area of its display. At
   * the end, the main renderer gets the position to save.
   */
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
      const room = area.height - agentDockWindowHeight(display);
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
      sendToRenderer(main, IPC_ENDPOINTS.agentDock.moved, { displayId: entry.displayId, offset });
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
    return agentDockWindowBounds(display, this.#presentation?.edge ?? "right", this.#offsets.get(display.id) ?? 0.5);
  }

  /** `rendererId` is the dock window that sends the action. */
  performAction(rendererId: number, action: AgentDockAction): Effect.Effect<void, AgentDockFailed> {
    return Effect.suspend(() => {
      if (action.type === "send") return this.#send(action);
      if (action.type === "open-chat") {
        if (action.agentId === null && this.#chatOwner !== rendererId) return Effect.void;
        const previous = this.#liveWindows().find((entry) => entry.rendererId === this.#chatOwner);
        if (previous && previous.rendererId !== rendererId) {
          sendToRenderer(previous.window, IPC_ENDPOINTS.agentDock.closeChat);
        }
        this.#chatOwner = action.agentId === null ? null : rendererId;
      }
      return Effect.gen({ self: this }, function* () {
        const window = yield* this.#ensureMainWindow();
        if (action.type === "open-agent" || action.type === "open-settings") this.#options.presentMainWindow(window);
        if (!sendToRenderer(window, IPC_ENDPOINTS.agentDock.action, action)) {
          return yield* new AgentDockFailed({
            cause: new Error(sourceText("error.backend.windowTemporarilyUnavailable")),
          });
        }
      });
    });
  }

  #send(action: AgentDockSendAction): Effect.Effect<void, AgentDockFailed> {
    const key = [action.serverId, action.agentId, action.clientMessageId].join("\u0000");
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

  /** Creates, moves or hides the window. Runs one at a time; a window that fails to load is logged. */
  reconcileWindow(): Effect.Effect<void> {
    return this.#reconciliation
      .withPermit(
        Effect.suspend(() => {
          if (this.#destroyed || this.#options.platform !== "darwin") {
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
          // A window stays on its display. A window whose display is no longer a choice moves to a display
          // that has no window, or closes.
          const spare = this.#windows.filter((entry) => !targetIds.has(entry.displayId));
          const opens: Display[] = [];
          for (const display of targets) {
            const current = this.#windows.find((entry) => entry.displayId === display.id) ?? spare.shift();
            if (!current) {
              opens.push(display);
              continue;
            }
            current.displayId = display.id;
            const bounds = this.#boundsFor(display);
            if (!isDeepStrictEqual(current.window.getBounds(), bounds)) current.window.setBounds(bounds, false);
            if (!current.window.isVisible()) current.window.showInactive();
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
        window.excludedFromShownWindowsMenu = true;
        window.setHasShadow(false);
        window.setWindowButtonVisibility(false);
        window.setAlwaysOnTop(true, "floating");
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        window.setHiddenInMissionControl(true);
        window.setFocusable(false);
        window.setIgnoreMouseEvents(true, { forward: true });
        window.webContents.on("did-finish-load", () => {
          if (!owned()) return;
          // A reloaded dock renderer has no open chat and no drag.
          this.#release(entry);
          sendToRenderer(window, IPC_ENDPOINTS.agentDock.presentation, this.#presentation);
        });
        window.webContents.on("render-process-gone", () => {
          if (owned()) this.#release(entry);
        });
        window.once("ready-to-show", () => {
          if (!owned() || this.#presentation === null) return;
          window.showInactive();
        });
        // macOS can move a window off a display that goes away. Put the dock back at its place on its edge.
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

  /**
   * A dock window that closes, reloads or crashes with its chat open closes the chat, so the main
   * renderer stops reading it. Its drag ends too.
   */
  #release(entry: DockWindow): void {
    if (this.#drag?.rendererId === entry.rendererId) this.#drag = null;
    if (this.#chatOwner !== entry.rendererId) return;
    this.#chatOwner = null;
    const main = this.#options.getMainWindow();
    const serverId = this.#presentation?.serverId;
    if (main && !main.isDestroyed() && serverId !== undefined) {
      sendToRenderer(main, IPC_ENDPOINTS.agentDock.action, { type: "open-chat", serverId, agentId: null });
    }
  }
}

function agentDockWindowHeight(display: Pick<Display, "workArea">): number {
  return Math.min(AGENT_DOCK_WINDOW_SIZE.height, display.workArea.height);
}

/**
 * At an edge of the work area, so the macOS Dock at that edge does not cover it. `offset` is the place
 * in height: 0 is the top, 1 the bottom.
 */
function agentDockWindowBounds(display: Pick<Display, "workArea">, edge: AgentDockEdge, offset: number): Rectangle {
  const area = display.workArea;
  const height = agentDockWindowHeight(display);
  return {
    x: edge === "left" ? area.x : area.x + area.width - AGENT_DOCK_WINDOW_SIZE.width,
    y: Math.round(area.y + (area.height - height) * offset),
    width: AGENT_DOCK_WINDOW_SIZE.width,
    height,
  };
}

export function requireAgentDockSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) {
    throw new Error(`Rejected agent dock IPC request outside the ${name}.`);
  }
}
