import type {
  ComputerUseCoveredArea,
  ComputerUseCursorPoint,
  ComputerUseHighlightPlacement,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Schema } from "effect";
import type { BrowserWindow, Rectangle } from "electron";
import type { ComputerUseHighlightTarget } from "./computer-use-target-window";
import type { CuaDriverFailure } from "./cua-driver-effects";

const logger = createOpenBotLogger("computer-use-highlight");

const DEFAULT_POLL_INTERVAL_MS = 33;
const SEARCH_POLL_INTERVAL_MS = 250;
const IDLE_OVERLAY_MS = 60_000;
const LOAD_RETRY_MS = 5_000;
const DEFAULT_CORNER_RADIUS = 12;

class HighlightOverlayLoadFailed extends Schema.TaggedError<HighlightOverlayLoadFailed>()(
  "HighlightOverlayLoadFailed",
  { cause: Schema.Defect() },
) {}

export interface HighlightOverlayWindow {
  setBounds(bounds: Rectangle, animate: boolean): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
}

export interface HighlightDisplay {
  id: number;
  bounds: Rectangle;
}

export interface ComputerUseHighlightControllerOptions<W extends HighlightOverlayWindow = BrowserWindow> {
  createWindow: (bounds: Rectangle) => W;
  loadWindow: (window: W) => Promise<void>;
  place: (window: W, placement: ComputerUseHighlightPlacement) => void;
  readTarget: (
    previous: ComputerUseHighlightTarget | null,
  ) => Effect.Effect<ComputerUseHighlightTarget | null, CuaDriverFailure>;
  readPointer?: () => ComputerUseCursorPoint | null;
  displays: () => readonly HighlightDisplay[];
  idle?: () => boolean;
  cornerRadius?: number;
  pollIntervalMs?: number;
  logger?: Logger;
}

export class ComputerUseHighlightController<W extends HighlightOverlayWindow = BrowserWindow> {
  readonly #options: ComputerUseHighlightControllerOptions<W>;
  readonly #logger: Logger;
  readonly #overlays = new Map<number, Overlay<W>>();
  #target: ComputerUseHighlightTarget | null = null;
  #loggedWindowId: number | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #timerInterval = 0;
  #tick: Deferred.Deferred<void> | null = null;
  #destroyed = false;
  #hiddenAt: number | null = null;
  #loadFailedAt: number | null = null;
  #generation = 0;

  constructor(options: ComputerUseHighlightControllerOptions<W>) {
    this.#options = options;
    this.#logger = options.logger ?? logger;
  }

  get visible(): boolean {
    for (const overlay of this.#overlays.values()) {
      if (!overlay.window.isDestroyed() && overlay.window.isVisible()) return true;
    }
    return false;
  }

  start(): void {
    if (this.#destroyed || this.#timer) return;
    this.#poll(this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    Effect.runFork(this.refresh());
  }

  #poll(interval: number): void {
    if (this.#timer && this.#timerInterval === interval) return;
    if (this.#timer) clearInterval(this.#timer);
    this.#timerInterval = interval;
    this.#timer = setInterval(() => Effect.runFork(this.refresh()), interval);
    this.#timer.unref?.();
  }

  stop(): void {
    this.#generation += 1;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#hide();
    this.#retireAll();
  }

  refresh(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#destroyed) return Effect.void;
      if (this.#tick) return Deferred.await(this.#tick);
      const tick = Deferred.makeUnsafe<void>();
      this.#tick = tick;
      const failed = (error: unknown) =>
        Effect.sync(() => {
          this.#logger.debug("Computer Use highlight could not be placed", { error: toLogValue(error) });
          this.#hide();
        });
      return this.#refresh().pipe(
        Effect.catch((error) => failed(error.cause)),
        Effect.catchDefect(failed),
        Effect.ensuring(
          Effect.suspend(() => {
            this.#tick = null;
            return Deferred.done(tick, Exit.void);
          }),
        ),
      );
    });
  }

  destroy(): void {
    this.#destroyed = true;
    this.stop();
  }

  readonly #refresh = Effect.fn("ComputerUseHighlight.refresh")(function* (this: ComputerUseHighlightController<W>) {
    const generation = this.#generation;
    const stale = () => this.#destroyed || this.#generation !== generation;
    const target = yield* this.#options.readTarget(this.#target);
    if (stale()) return;
    this.#target = target;
    if ((target?.windowId ?? null) !== this.#loggedWindowId) {
      this.#loggedWindowId = target?.windowId ?? null;
      this.#logger.debug("Computer Use highlight moved", { window: toLogValue(this.#loggedWindowId) });
    }
    if (!target) {
      this.#hide();
      if (this.#overlays.size === 0 && this.#options.idle?.() && this.#timer) {
        clearInterval(this.#timer);
        this.#timer = null;
      } else if (this.#timer) {
        this.#poll(Math.max(this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, SEARCH_POLL_INTERVAL_MS));
      }
      return;
    }
    if (this.#timer) this.#poll(this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const displays = this.#options.displays();
    const pointer = this.#options.readPointer?.() ?? null;
    for (const id of [...this.#overlays.keys()]) {
      if (!displays.some((display) => display.id === id)) this.#retire(id);
    }
    for (const display of displays) {
      let overlay = this.#overlays.get(display.id);
      if (!overlay || overlay.window.isDestroyed()) {
        if (this.#loadFailedAt !== null && Date.now() - this.#loadFailedAt < LOAD_RETRY_MS) continue;
        overlay = { window: this.#options.createWindow(display.bounds), loaded: false, bounds: display.bounds };
        this.#overlays.set(display.id, overlay);
      }
      if (!overlay.loaded) {
        const window = overlay.window;
        const displayId = display.id;
        yield* Effect.tryPromise({
          try: () => this.#options.loadWindow(window),
          catch: (cause) => new HighlightOverlayLoadFailed({ cause }),
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              if (!stale()) this.#loadFailedAt = Date.now();
              if (this.#overlays.get(displayId)?.window === window) this.#retire(displayId);
            }),
          ),
        );
        if (stale() || overlay.window.isDestroyed()) return;
        overlay.loaded = true;
        this.#loadFailedAt = null;
      }
      if (!sameRectangle(overlay.bounds, display.bounds)) {
        overlay.bounds = display.bounds;
        overlay.window.setBounds(display.bounds, false);
      }
      this.#place(overlay.window, target, display.bounds, pointer);
    }
  }).bind(this);

  #place(window: W, target: ComputerUseHighlightTarget, display: Rectangle, pointer: ComputerUseCursorPoint | null) {
    this.#options.place(window, {
      x: target.bounds.x - display.x,
      y: target.bounds.y - display.y,
      width: target.bounds.width,
      height: target.bounds.height,
      cornerRadius: this.#options.cornerRadius ?? DEFAULT_CORNER_RADIUS,
      windowTitle: target.title,
      cursor: cursorIn(pointer, display),
      covered: target.covered.map((area) => inDisplay(area, display)),
    });
    if (!window.isVisible()) window.showInactive();
    this.#hiddenAt = null;
  }

  #hide(): void {
    this.#target = null;
    this.#hiddenAt ??= Date.now();
    if (Date.now() - this.#hiddenAt >= IDLE_OVERLAY_MS) {
      this.#retireAll();
      return;
    }
    for (const overlay of this.#overlays.values()) {
      if (!overlay.window.isDestroyed() && overlay.window.isVisible()) overlay.window.hide();
    }
  }

  #retireAll(): void {
    for (const id of [...this.#overlays.keys()]) this.#retire(id);
  }

  #retire(id: number): void {
    const overlay = this.#overlays.get(id);
    this.#overlays.delete(id);
    if (overlay && !overlay.window.isDestroyed()) overlay.window.destroy();
  }
}

function cursorIn(point: ComputerUseCursorPoint | null, display: Rectangle): ComputerUseCursorPoint | null {
  if (!point) return null;
  const x = point.x - display.x;
  const y = point.y - display.y;
  if (x < 0 || y < 0 || x > display.width || y > display.height) return null;
  return { x, y };
}

interface Overlay<W> {
  window: W;
  loaded: boolean;
  bounds: Rectangle;
}

function inDisplay(area: Rectangle, display: Rectangle): ComputerUseCoveredArea {
  return { x: area.x - display.x, y: area.y - display.y, width: area.width, height: area.height };
}

function sameRectangle(left: Rectangle | null, right: Rectangle): boolean {
  return (
    left !== null &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
