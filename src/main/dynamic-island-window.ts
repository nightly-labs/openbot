import { isDeepStrictEqual } from "node:util";
import type {
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
import { readDynamicIslandPreference, writeDynamicIslandPreference } from "./dynamic-island-preference-store";
import { sendToRenderer } from "./renderer-ipc";

const logger = createOpenBotLogger("dynamic-island-window");

const DYNAMIC_ISLAND_WINDOW_SIZE = { width: 614, height: 380 } as const;
const DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT = 50;
// Room below the compact island for its hover growth and hit band, which the window must not clip.
const DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM = 18;
// Leaving interaction starts a collapse the renderer animates for roughly 600ms: the panel fades,
// then the shell springs back down to the notch. The window is the only thing clipping it, so
// dropping to the compact height on the same tick guillotines the still-tall island - the lower
// half disappears at once while the top morphs. Hold the tall window until the shell has landed.
export const DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS = 700;

const MACBOOK_NOTCH_REFERENCE = {
  displayWidth: 1512,
  displayHeight: 982,
  notchWidth: 185,
  notchHeight: 32,
} as const;
const MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE = 0.01;

/** A Dynamic Island operation that failed. The cause is what the renderer reads. */
export class DynamicIslandFailed extends Schema.TaggedError<DynamicIslandFailed>()("DynamicIslandFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toDynamicIslandFailed } = causeHelpers(DynamicIslandFailed);

type CriticalAction = Extract<DynamicIslandAction, { type: "answer-prompt" | "respond-approval" }>;

export interface DynamicIslandWindowControllerOptions {
  platform: NodeJS.Platform;
  preferencePath: string;
  createWindow: (bounds: Rectangle, display: Display) => BrowserWindow;
  loadWindow: (window: BrowserWindow, display: Display) => Promise<void>;
  getDisplays: () => Display[];
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  performHaptic: () => void;
  performCriticalAction: (action: CriticalAction) => Effect.Effect<void, DynamicIslandFailed>;
  logger?: Logger;
}

export class DynamicIslandWindowController {
  readonly #options: DynamicIslandWindowControllerOptions;
  #preference: DynamicIslandPreference = { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  #presentation = IDLE_DYNAMIC_ISLAND_PRESENTATION;
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #interactiveDisplays = new Set<number>();
  /** One run per critical action, shared by the overlays and IPC retries that send it again. */
  readonly #criticalActions = new Map<string, Deferred.Deferred<void, DynamicIslandFailed>>();
  readonly #notchSizes = new Map<number, { width: number; height: number }>();
  readonly #collapseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly #preferenceMutation = Semaphore.makeUnsafe(1);
  readonly #windowReconciliation = Semaphore.makeUnsafe(1);
  #destroyed = false;

  constructor(options: DynamicIslandWindowControllerOptions) {
    this.#options = options;
  }

  readonly initialize = Effect.fn("DynamicIsland.initialize")(function* (this: DynamicIslandWindowController) {
    this.#preference = yield* readDynamicIslandPreference(this.#options.preferencePath);
    yield* this.reconcileWindow();
  }).bind(this);

  get preference(): DynamicIslandPreference {
    return { ...this.#preference };
  }

  get presentation(): DynamicIslandPresentation {
    return this.#presentation;
  }

  /** The notch of the built-in display, or null when there is no built-in display or it has no notch. */
  get builtInDisplayGeometry(): DynamicIslandNotchSize | null {
    const builtIn = this.#options.getDisplays().find((display) => display.internal);
    return (builtIn && dynamicIslandNotchSizeForDisplay(builtIn)) ?? null;
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

  /** Writes run in the order of the calls; each one reconciles the windows before the next. */
  setPreference(preference: DynamicIslandPreference): Effect.Effect<DynamicIslandPreference, DynamicIslandFailed> {
    return this.#preferenceMutation.withPermit(
      Effect.gen({ self: this }, function* () {
        const savedPreference = yield* writeDynamicIslandPreference(this.#options.preferencePath, preference).pipe(
          toDynamicIslandFailed,
        );
        this.#preference = savedPreference;
        yield* this.reconcileWindow();
        this.publishPreference();
        return { ...savedPreference };
      }),
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

  setInteractive(rendererId: number, interactive: boolean): void {
    const entry = [...this.#windows].find(
      ([, candidate]) => !candidate.isDestroyed() && candidate.webContents.id === rendererId,
    );
    if (!entry) return;
    const [displayId, window] = entry;
    if (interactive) this.#interactiveDisplays.add(displayId);
    else this.#interactiveDisplays.delete(displayId);
    const display = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
    const bounds = display ? dynamicIslandWindowBounds(display) : undefined;
    this.#cancelCollapse(displayId);
    if (interactive && bounds) window.setBounds(bounds, false);
    // On macOS, focusability also allows the panel to become a main window in AltTab.
    // Keep it non-focusable; mouse interaction does not require keyboard focus.
    window.setIgnoreMouseEvents(!interactive, { forward: true });
    if (interactive || !bounds) return;
    this.#collapseTimers.set(
      displayId,
      setTimeout(() => {
        this.#collapseTimers.delete(displayId);
        if (this.#interactiveDisplays.has(displayId) || window.isDestroyed()) return;
        // The display can be rearranged while the island animates shut, and reconciliation will
        // have moved the still-tall window to the new geometry. Ask where the window belongs now
        // rather than replaying the rectangle captured when the pointer left.
        const current = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
        if (!current) return;
        window.setBounds(this.#windowBounds(current, dynamicIslandWindowBounds(current), false), false);
      }, DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS),
    );
  }

  #windowBounds(display: Pick<Display, "bounds" | "internal">, bounds: Rectangle, interactive: boolean): Rectangle {
    if (interactive) return bounds;
    const compactHeight = dynamicIslandCompactHeight(
      notchSizeForDisplay(display)?.height,
      this.#preference.heightPercent,
    );
    return {
      ...bounds,
      height: Math.max(DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT, compactHeight + DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM),
    };
  }

  #cancelCollapse(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  performAction(action: DynamicIslandAction): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.suspend(() => {
      if (action.type === "answer-prompt" || action.type === "respond-approval") {
        return this.#performCriticalAction(action);
      }
      return Effect.gen({ self: this }, function* () {
        const window = yield* this.#ensureMainWindow();
        // A dismissal changes only the island, so the main window stays where it is.
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
      const window = yield* this.#ensureMainWindow();
      yield* this.#options.performCriticalAction(action);
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action);
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

  /** Reconciliations run one at a time, in the order of the calls. A window that fails to load is logged. */
  reconcileWindow(): Effect.Effect<void> {
    return this.#windowReconciliation.withPermit(this.#reconcileWindows());
  }

  readonly #reconcileWindows = Effect.fn("DynamicIsland.reconcileWindows")(function* (
    this: DynamicIslandWindowController,
  ) {
    if (this.#destroyed || this.#options.platform !== "darwin" || !this.#preference.enabled) {
      this.destroyWindows();
      return;
    }

    const displays = this.#options
      .getDisplays()
      .filter((display) => this.#preference.additionalDisplaysEnabled || display.internal);
    const displayIds = new Set(displays.map((display) => display.id));
    for (const [displayId, window] of this.#windows) {
      if (displayIds.has(displayId) && !window.isDestroyed()) continue;
      this.#windows.delete(displayId);
      this.#interactiveDisplays.delete(displayId);
      this.#notchSizes.delete(displayId);
      this.#cancelCollapse(displayId);
      if (!window.isDestroyed()) window.destroy();
    }

    for (const display of displays) {
      if (this.#destroyed) return;
      const bounds = dynamicIslandWindowBounds(display);
      const notchSize = notchSizeForDisplay(display);
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
        current.showInactive();
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

  /** A window that cannot be created or loaded fails here, so that the other displays still get theirs. */
  #createDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    return Effect.try({
      try: () => this.#openDisplayWindow(display, bounds),
      catch: (cause) => new DynamicIslandFailed({ cause }),
    }).pipe(Effect.flatten);
  }

  /** Creates the window now and returns its load. */
  #openDisplayWindow(display: Display, bounds: Rectangle): Effect.Effect<void, DynamicIslandFailed> {
    const window = this.#options.createWindow(this.#windowBounds(display, bounds, false), display);
    window.excludedFromShownWindowsMenu = true;
    this.#windows.set(display.id, window);
    window.setHasShadow(false);
    window.setWindowButtonVisibility(false);
    window.setAlwaysOnTop(true, "status");
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setHiddenInMissionControl(true);
    window.setFocusable(false);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.on("did-finish-load", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      const currentDisplay = this.#options.getDisplays().find((candidate) => candidate.id === display.id) ?? display;
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, this.#presentation);
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
      const notchSize = notchSizeForDisplay(currentDisplay);
      if (sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
        this.#rememberNotchSize(display.id, notchSize);
      }
    });
    window.once("ready-to-show", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      window.showInactive();
    });
    window.on("blur", () => this.setInteractive(window.webContents.id, false));
    window.on("closed", () => {
      if (this.#windows.get(display.id) === window) {
        this.#windows.delete(display.id);
        this.#interactiveDisplays.delete(display.id);
        this.#notchSizes.delete(display.id);
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
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

export function dynamicIslandNotchSizeForDisplay(
  display: Pick<Display, "bounds" | "internal">,
): DynamicIslandNotchSize | undefined {
  if (!display.internal || !isRecognizedNotchedMacBookDisplay(display)) return undefined;
  return dynamicIslandNotchSize(display);
}

function isRecognizedNotchedMacBookDisplay(display: Pick<Display, "bounds">): boolean {
  const { width, height } = display.bounds;
  if (width <= 0 || height <= 0) return false;
  const referenceAspectRatio = MACBOOK_NOTCH_REFERENCE.displayWidth / MACBOOK_NOTCH_REFERENCE.displayHeight;
  return Math.abs(width / height - referenceAspectRatio) <= MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE;
}

function notchSizeForDisplay(display: Pick<Display, "bounds" | "internal">): DynamicIslandNotchSize | undefined {
  return dynamicIslandNotchSizeForDisplay(display);
}

function notchSizeChanged(
  previous: { width: number; height: number } | undefined,
  next: { width: number; height: number } | undefined,
): boolean {
  return previous?.width !== next?.width || previous?.height !== next?.height;
}

function criticalActionKey(action: CriticalAction): string {
  return [action.type, action.serverId, action.agentId, String(action.requestId)].join("\u0000");
}

function dynamicIslandWindowBounds(display: Pick<Display, "bounds">): Rectangle {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - DYNAMIC_ISLAND_WINDOW_SIZE.width) / 2),
    y: display.bounds.y,
    ...DYNAMIC_ISLAND_WINDOW_SIZE,
  };
}

/**
 * Returns the notch size in Electron's display points.
 *
 * Apple keeps the camera housing proportional across notched MacBooks, while
 * the selected display scale changes the logical display width. Scaling the
 * measured 14-inch reference therefore covers the 13-inch Air, 14-inch Pro,
 * 15-inch Air, and 16-inch Pro without a model-name lookup.
 */
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
