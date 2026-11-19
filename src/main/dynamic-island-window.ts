import { isDeepStrictEqual } from "node:util";
import type {
  AgentDockInputRect,
  DynamicIslandAction,
  DynamicIslandNotchSize,
  DynamicIslandPreference,
  DynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  dynamicIslandCompactHeight,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import type { BrowserWindow, Display, Rectangle } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import type { CriticalAction } from "./dynamic-island-actions";
import { readDynamicIslandPreference, writeDynamicIslandPreference } from "./dynamic-island-preference-store";
import { forceActivateX11Window } from "./linux-x11-activation";
import { letPointerThrough, type PointerForwardingGate } from "./pointer-forwarding-gate";
import { sendToRenderer } from "./renderer-ipc";
import type { WindowsTopmostKeeper } from "./windows-topmost-keeper";

const logger = createOpenBotLogger("dynamic-island-window");

const DYNAMIC_ISLAND_WINDOW_SIZE = { width: 614, height: 380 } as const;
const DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT = 50;
const DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM = 18;
const DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS = 700;

const MACBOOK_NOTCH_REFERENCE = {
  displayWidth: 1512,
  displayHeight: 982,
  notchWidth: 185,
  notchHeight: 32,
} as const;
const MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE = 0.01;

export class DynamicIslandFailed extends Schema.TaggedError<DynamicIslandFailed>()("DynamicIslandFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toDynamicIslandFailed } = causeHelpers(DynamicIslandFailed);

type DynamicIslandWindowKind = "panel" | "tool" | "x11";

export interface DynamicIslandWindowControllerOptions {
  windowKind: DynamicIslandWindowKind | null;
  preferencePath: string;
  defaultPreference?: DynamicIslandPreference;
  createWindow: (bounds: Rectangle, display: Display) => BrowserWindow;
  loadWindow: (window: BrowserWindow, display: Display) => Promise<void>;
  getDisplays: () => Display[];
  getPrimaryDisplay: () => Display;
  getMainWindow: () => BrowserWindow | null;
  getFocusedWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  performHaptic: () => void;
  performCriticalAction: (action: CriticalAction) => Effect.Effect<void, DynamicIslandFailed>;
  showContextMenu?: (window: BrowserWindow) => void;
  pointerForwarding?: PointerForwardingGate | null;
  topmost?: WindowsTopmostKeeper | null;
  logger?: Logger;
}

export class DynamicIslandWindowController {
  readonly #options: DynamicIslandWindowControllerOptions;
  #preference: DynamicIslandPreference;
  #presentation = IDLE_DYNAMIC_ISLAND_PRESENTATION;
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #interactiveDisplays = new Set<number>();
  readonly #criticalActions = new Map<string, Deferred.Deferred<void, DynamicIslandFailed>>();
  readonly #notchSizes = new Map<number, { width: number; height: number }>();
  readonly #collapseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly #inputRegions = new Map<number, AgentDockInputRect[]>();
  readonly #appliedShapes = new WeakMap<BrowserWindow, string>();
  readonly #keyboardReturn = new Map<number, BrowserWindow | null>();
  readonly #preferenceMutation = Semaphore.makeUnsafe(1);
  readonly #windowReconciliation = Semaphore.makeUnsafe(1);
  #destroyed = false;

  constructor(options: DynamicIslandWindowControllerOptions) {
    this.#options = options;
    this.#preference = { ...(options.defaultPreference ?? DEFAULT_DYNAMIC_ISLAND_PREFERENCE) };
  }

  readonly initialize = Effect.fn("DynamicIsland.initialize")(function* (this: DynamicIslandWindowController) {
    this.#preference = yield* readDynamicIslandPreference(
      this.#options.preferencePath,
      this.#options.defaultPreference,
    );
  }).bind(this);

  get preference(): DynamicIslandPreference {
    return { ...this.#preference };
  }

  get presentation(): DynamicIslandPresentation {
    return this.#presentation;
  }

  get builtInDisplayGeometry(): DynamicIslandNotchSize | null {
    const builtIn = this.#options.getDisplays().find((display) => display.internal);
    return (builtIn && this.#notchSize(builtIn)) ?? null;
  }

  get mainRendererIds(): ReadonlySet<number> {
    const window = this.#options.getMainWindow();
    return new Set(window && !window.isDestroyed() ? [window.webContents.id] : []);
  }

  get overlayRendererIds(): ReadonlySet<number> {
    return new Set(
      [...this.#windows.values()].filter((window) => !window.isDestroyed()).map((window) => window.webContents.id),
    );
  }

  setPreference(preference: DynamicIslandPreference): Effect.Effect<DynamicIslandPreference, DynamicIslandFailed> {
    return this.#updatePreference(() => preference);
  }

  #updatePreference(
    change: (current: DynamicIslandPreference) => DynamicIslandPreference,
  ): Effect.Effect<DynamicIslandPreference, DynamicIslandFailed> {
    return this.#preferenceMutation.withPermit(
      Effect.gen({ self: this }, function* () {
        const savedPreference = yield* writeDynamicIslandPreference(
          this.#options.preferencePath,
          change(this.#preference),
        ).pipe(toDynamicIslandFailed);
        this.#preference = savedPreference;
        yield* this.reconcileWindow();
        this.publishPreference();
        return { ...savedPreference };
      }),
    );
  }

  hide(): Effect.Effect<DynamicIslandPreference, DynamicIslandFailed> {
    return this.#updatePreference((current) => ({ ...current, enabled: false })).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => sendToRenderer(this.#options.getMainWindow(), IPC_ENDPOINTS.dynamicIsland.preference, saved)),
      ),
    );
  }

  performHaptic(): void {
    if (!this.#preference.enabled || !this.#preference.hapticsEnabled) return;
    this.#options.performHaptic();
  }

  publish(presentation: DynamicIslandPresentation): void {
    if (isDeepStrictEqual(this.#presentation, presentation)) return;
    this.#presentation = presentation;
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, presentation);
    }
  }

  setInteractive(rendererId: number, interactive: boolean, keyboard = false): void {
    const entry = [...this.#windows].find(
      ([, candidate]) => !candidate.isDestroyed() && candidate.webContents.id === rendererId,
    );
    if (!entry) return;
    const [displayId, window] = entry;
    if (interactive) this.#interactiveDisplays.add(displayId);
    else this.#interactiveDisplays.delete(displayId);
    const display = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
    const bounds = display ? this.#islandBounds(display) : undefined;
    this.#cancelCollapse(displayId);
    if (interactive && bounds) window.setBounds(bounds, false);
    if (this.#options.windowKind === "x11") this.#applyShape(displayId, window);
    else letPointerThrough(this.#options.pointerForwarding, window, !interactive);
    const wantsKeyboard = interactive && keyboard;
    if (wantsKeyboard && this.#options.windowKind === "panel" && !this.#keyboardReturn.has(displayId)) {
      const focused = this.#options.getFocusedWindow();
      const island = [...this.#windows].find(([, candidate]) => candidate === focused);
      this.#keyboardReturn.set(displayId, island ? (this.#keyboardReturn.get(island[0]) ?? null) : focused);
    }
    const keyboardReturn = interactive ? undefined : this.#keyboardReturn.get(displayId);
    if (!interactive) this.#keyboardReturn.delete(displayId);
    window.setFocusable(wantsKeyboard);
    if (wantsKeyboard && !window.isFocused()) {
      window.focus();
      if (this.#options.windowKind === "x11") forceActivateX11Window(window);
    }
    if (!interactive && bounds) this.#scheduleCollapse(displayId, window);
    if (
      keyboardReturn &&
      keyboardReturn !== window &&
      !keyboardReturn.isDestroyed() &&
      keyboardReturn.isVisible() &&
      !keyboardReturn.isMinimized() &&
      window.isFocused()
    ) {
      keyboardReturn.focus();
    }
  }

  #scheduleCollapse(displayId: number, window: BrowserWindow): void {
    this.#collapseTimers.set(
      displayId,
      setTimeout(() => {
        this.#collapseTimers.delete(displayId);
        if (this.#interactiveDisplays.has(displayId) || window.isDestroyed()) return;
        const current = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
        if (!current) return;
        window.setBounds(this.#windowBounds(current, this.#islandBounds(current), false), false);
        if (this.#options.windowKind === "x11") this.#applyShape(displayId, window);
      }, DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS),
    );
  }

  setInputRegion(rendererId: number, rects: AgentDockInputRect[]): void {
    if (this.#options.windowKind !== "x11") return;
    const entry = [...this.#windows].find(
      ([, candidate]) => !candidate.isDestroyed() && candidate.webContents.id === rendererId,
    );
    if (!entry) return;
    const [displayId, window] = entry;
    this.#inputRegions.set(displayId, rects);
    this.#applyShape(displayId, window);
  }

  #applyShape(displayId: number, window: BrowserWindow): void {
    const scaleFactor = this.#options.getDisplays().find((candidate) => candidate.id === displayId)?.scaleFactor;
    if (this.#interactiveDisplays.has(displayId) || this.#collapseTimers.has(displayId)) {
      const { width, height } = window.getBounds();
      this.#setShape(window, [{ x: 0, y: 0, width, height }], scaleFactor);
      return;
    }
    this.#setShape(window, this.#inputRegions.get(displayId) ?? [], scaleFactor);
  }

  #setShape(window: BrowserWindow, shape: Rectangle[], scaleFactor: number | undefined): void {
    const key = `${scaleFactor ?? ""}:${JSON.stringify(shape)}`;
    if (this.#appliedShapes.get(window) === key) return;
    window.setShape(shape);
    this.#appliedShapes.set(window, key);
  }

  #islandBounds(display: Pick<Display, "bounds" | "workArea">): Rectangle {
    return dynamicIslandWindowBounds(display, this.#options.windowKind === "panel" ? "screen" : "work-area");
  }

  #windowBounds(display: Pick<Display, "bounds" | "internal">, bounds: Rectangle, interactive: boolean): Rectangle {
    if (interactive || this.#options.windowKind === "x11") return bounds;
    const compactHeight = dynamicIslandCompactHeight(this.#notchSize(display)?.height, this.#preference.heightPercent);
    return {
      ...bounds,
      height: Math.max(DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT, compactHeight + DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM),
    };
  }

  #notchSize(display: Pick<Display, "bounds" | "internal">): DynamicIslandNotchSize | undefined {
    return this.#options.windowKind === "panel" ? dynamicIslandNotchSizeForDisplay(display, "darwin") : undefined;
  }

  #cancelCollapse(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  performAction(action: DynamicIslandAction): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.suspend(() => {
      if (
        action.type === "answer-prompt" ||
        action.type === "respond-approval" ||
        action.type === "send-message" ||
        action.type === "stop-agent"
      ) {
        return this.#performCriticalAction(action);
      }
      return Effect.gen({ self: this }, function* () {
        const window = yield* this.#ensureMainWindow();
        if (action.type !== "dismiss-failure") this.#options.presentMainWindow(window);
        if (action.type !== "open-app" && !sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action)) {
          return yield* new DynamicIslandFailed({
            cause: new Error(sourceText("error.backend.windowTemporarilyUnavailable")),
          });
        }
      });
    });
  }

  #performCriticalAction(action: CriticalAction): Effect.Effect<void, DynamicIslandFailed> {
    const key = criticalActionKey(action);
    const existing = this.#criticalActions.get(key);
    if (existing) return Deferred.await(existing);
    const done = Deferred.makeUnsafe<void, DynamicIslandFailed>();
    this.#criticalActions.set(key, done);
    return Effect.gen({ self: this }, function* () {
      const window =
        action.type === "answer-prompt" || action.type === "respond-approval" ? yield* this.#ensureMainWindow() : null;
      yield* this.#options.performCriticalAction(action);
      if (window) sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action);
    }).pipe(
      Effect.onExit((exit) => {
        if (this.#criticalActions.get(key) === done) this.#criticalActions.delete(key);
        return Deferred.done(done, exit);
      }),
    );
  }

  #ensureMainWindow(): Effect.Effect<BrowserWindow, DynamicIslandFailed> {
    return Effect.gen({ self: this }, function* () {
      const current = this.#options.getMainWindow();
      if (current && !current.isDestroyed()) return current;
      const ensureMainWindow = this.#options.ensureMainWindow;
      const created = ensureMainWindow
        ? yield* Effect.tryPromise({
            try: () => ensureMainWindow(),
            catch: (cause) => new DynamicIslandFailed({ cause }),
          })
        : undefined;
      if (!created || created.isDestroyed()) {
        return yield* new DynamicIslandFailed({ cause: new Error(sourceText("error.backend.windowUnavailable")) });
      }
      return created;
    });
  }

  reconcileWindow(): Effect.Effect<void> {
    return this.#windowReconciliation.withPermit(this.#reconcileWindows());
  }

  readonly #reconcileWindows = Effect.fn("DynamicIsland.reconcileWindows")(function* (
    this: DynamicIslandWindowController,
  ) {
    if (this.#destroyed || this.#options.windowKind === null || !this.#preference.enabled) {
      this.destroyWindows();
      return;
    }

    const allDisplays = this.#options.getDisplays();
    const builtInDisplays = allDisplays.filter((display) => display.internal);
    const displays = this.#preference.additionalDisplaysEnabled
      ? allDisplays
      : builtInDisplays.length > 0
        ? builtInDisplays
        : [this.#options.getPrimaryDisplay()];
    const displayIds = new Set(displays.map((display) => display.id));
    for (const [displayId, window] of this.#windows) {
      if (displayIds.has(displayId) && !window.isDestroyed()) continue;
      this.#windows.delete(displayId);
      this.#interactiveDisplays.delete(displayId);
      this.#notchSizes.delete(displayId);
      this.#inputRegions.delete(displayId);
      this.#keyboardReturn.delete(displayId);
      this.#cancelCollapse(displayId);
      if (!window.isDestroyed()) window.destroy();
    }

    for (const display of displays) {
      if (this.#destroyed) return;
      const bounds = this.#islandBounds(display);
      const notchSize = this.#notchSize(display);
      const current = this.#windows.get(display.id);
      if (current && !current.isDestroyed()) {
        current.setBounds(
          this.#windowBounds(
            display,
            bounds,
            this.#interactiveDisplays.has(display.id) || this.#collapseTimers.has(display.id),
          ),
          false,
        );
        if (notchSizeChanged(this.#notchSizes.get(display.id), notchSize)) {
          if (sendToRenderer(current, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
            this.#rememberNotchSize(display.id, notchSize);
          }
        }
        this.#show(current);
        continue;
      }
      yield* this.#createDisplayWindow(display, bounds).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            (this.#options.logger ?? logger).error(
              `Unable to load Dynamic Island on display ${display.id}:`,
              toLogValue(error.cause),
            ),
          ),
        ),
      );
    }
  }).bind(this);

  #show(window: BrowserWindow): void {
    window.showInactive();
    if (this.#options.windowKind === "x11") window.setVisibleOnAllWorkspaces(true);
  }

  #createDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.try({
      try: () => this.#openDisplayWindow(display, bounds),
      catch: (cause) => new DynamicIslandFailed({ cause }),
    }).pipe(Effect.flatten);
  }

  #openDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    const window = this.#options.createWindow(this.#windowBounds(display, bounds, false), display);
    this.#windows.set(display.id, window);
    window.setHasShadow(false);
    window.setAlwaysOnTop(true, this.#options.windowKind === "panel" ? "status" : "normal");
    this.#options.topmost?.keep(window);
    if (this.#options.windowKind === "panel") {
      window.excludedFromShownWindowsMenu = true;
      window.setWindowButtonVisibility(false);
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      window.setHiddenInMissionControl(true);
    }
    if (this.#options.windowKind === "x11") {
      this.#setShape(window, [], display.scaleFactor);
    } else {
      letPointerThrough(this.#options.pointerForwarding, window, true);
    }
    window.setFocusable(false);
    window.webContents.on("did-finish-load", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      const currentDisplay = this.#options.getDisplays().find((candidate) => candidate.id === display.id) ?? display;
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, this.#presentation);
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
      const notchSize = this.#notchSize(currentDisplay);
      if (sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
        this.#rememberNotchSize(display.id, notchSize);
      }
    });
    window.once("ready-to-show", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      this.#show(window);
    });
    window.on("blur", () => this.setInteractive(window.webContents.id, false));
    window.webContents.on("context-menu", (_event, params) => {
      if (params.isEditable || this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      this.#options.showContextMenu?.(window);
    });
    window.on("move", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      const current = this.#options.getDisplays().find((candidate) => candidate.id === display.id);
      if (!current) return;
      const bounds = this.#islandBounds(current);
      const { x, y } = window.getBounds();
      if (x === bounds.x && y === bounds.y) return;
      const interactive = this.#interactiveDisplays.has(display.id) || this.#collapseTimers.has(display.id);
      window.setBounds(this.#windowBounds(current, bounds, interactive), false);
    });
    window.on("closed", () => {
      if (this.#windows.get(display.id) === window) {
        this.#windows.delete(display.id);
        this.#interactiveDisplays.delete(display.id);
        this.#notchSizes.delete(display.id);
        this.#inputRegions.delete(display.id);
        this.#keyboardReturn.delete(display.id);
        this.#cancelCollapse(display.id);
      }
    });
    return Effect.tryPromise({
      try: () => this.#options.loadWindow(window, display),
      catch: (cause) => new DynamicIslandFailed({ cause }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (this.#windows.get(display.id) === window) this.#windows.delete(display.id);
          this.#notchSizes.delete(display.id);
          if (!window.isDestroyed()) window.destroy();
        }),
      ),
    );
  }

  destroy(): void {
    this.#destroyed = true;
    this.destroyWindows();
  }

  private publishPreference(): void {
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
    }
  }

  #rememberNotchSize(displayId: number, notchSize: DynamicIslandNotchSize | undefined): void {
    if (notchSize) this.#notchSizes.set(displayId, notchSize);
    else this.#notchSizes.delete(displayId);
  }

  private destroyWindows(): void {
    for (const displayId of [...this.#collapseTimers.keys()]) this.#cancelCollapse(displayId);
    const windows = [...this.#windows.values()];
    this.#windows.clear();
    this.#interactiveDisplays.clear();
    this.#notchSizes.clear();
    this.#inputRegions.clear();
    this.#keyboardReturn.clear();
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

export function dynamicIslandNotchSizeForDisplay(
  display: Pick<Display, "bounds" | "internal">,
  platform: NodeJS.Platform,
): DynamicIslandNotchSize | undefined {
  if (platform !== "darwin" || !display.internal || !isRecognizedNotchedMacBookDisplay(display)) return undefined;
  return dynamicIslandNotchSize(display);
}

function isRecognizedNotchedMacBookDisplay(display: Pick<Display, "bounds">): boolean {
  const { width, height } = display.bounds;
  if (width <= 0 || height <= 0) return false;
  const referenceAspectRatio = MACBOOK_NOTCH_REFERENCE.displayWidth / MACBOOK_NOTCH_REFERENCE.displayHeight;
  return Math.abs(width / height - referenceAspectRatio) <= MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE;
}

function notchSizeChanged(
  previous: { width: number; height: number } | undefined,
  next: { width: number; height: number } | undefined,
): boolean {
  return previous?.width !== next?.width || previous?.height !== next?.height;
}

function criticalActionKey(action: CriticalAction): string {
  const id =
    action.type === "send-message"
      ? action.clientMessageId
      : action.type === "stop-agent"
        ? action.turnId
        : String(action.requestId);
  return [action.type, action.serverId, action.agentId, id].join("\u0000");
}

function dynamicIslandWindowBounds(
  display: Pick<Display, "bounds" | "workArea">,
  top: "screen" | "work-area",
): Rectangle {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - DYNAMIC_ISLAND_WINDOW_SIZE.width) / 2),
    y: top === "work-area" ? display.workArea.y : display.bounds.y,
    ...DYNAMIC_ISLAND_WINDOW_SIZE,
  };
}

function dynamicIslandNotchSize(display: Pick<Display, "bounds">): DynamicIslandNotchSize {
  const displayScale = display.bounds.width / MACBOOK_NOTCH_REFERENCE.displayWidth;
  return {
    width: Math.max(16, Math.round(MACBOOK_NOTCH_REFERENCE.notchWidth * displayScale)),
    height: Math.max(32, Math.round(MACBOOK_NOTCH_REFERENCE.notchHeight * displayScale)),
  };
}

export function requireDynamicIslandSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) {
    throw new Error(`Rejected Dynamic Island IPC request outside the ${name}.`);
  }
}
