import type {
  ComputerUseCoveredArea,
  ComputerUseCursorPoint,
  ComputerUseHighlightPlacement,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import type { BrowserWindow, Rectangle } from "electron";
import type { ComputerUseHighlightTarget } from "./computer-use-target-window";

const logger = createOpenBotLogger("computer-use-highlight");

/**
 * How often the driver is asked where the agent is working.
 *
 * An overlay covers its whole display and never moves, so a placement is a message and a repaint.
 * What one tick costs is the two reads, and those go over a connection that stays open: about a
 * millisecond each. Thirty a second keeps the rim on a window the user drags without the driver
 * spending a measurable part of a core on answering.
 */
const DEFAULT_POLL_INTERVAL_MS = 33;
/** The corner radius of a standard macOS window, which is what the rim follows by default. */
const DEFAULT_CORNER_RADIUS = 12;

/**
 * The part of a window the controller uses. A real `BrowserWindow` answers all of it, and naming
 * only this much lets a test pass a double without an assertion that hides a type error.
 */
export interface HighlightOverlayWindow {
  setBounds(bounds: Rectangle, animate: boolean): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
}

/** One display, as the overlay needs it: something to tell it by, and the rectangle it covers. */
export interface HighlightDisplay {
  id: number;
  bounds: Rectangle;
}

export interface ComputerUseHighlightControllerOptions<W extends HighlightOverlayWindow = BrowserWindow> {
  createWindow: (bounds: Rectangle) => W;
  loadWindow: (window: W) => Promise<void>;
  /** Sends the rim's place inside the overlay. One-way: the overlay asks for nothing. */
  place: (window: W, placement: ComputerUseHighlightPlacement) => void;
  /**
   * The window an agent is working in, or `null` when no agent holds the desktop. The window the
   * rim is on now is passed back, because the choice holds on to it rather than following the
   * front of the desktop into whatever the user clicks next.
   */
  readTarget: (previous: ComputerUseHighlightTarget | null) => Promise<ComputerUseHighlightTarget | null>;
  /**
   * Where the agent last aimed the pointer, on the desktop, or `null` when nothing is to be drawn.
   *
   * Read after the target and never instead of it: the cursor is drawn inside the same overlay and
   * only while an agent holds the desktop, so no point is asked for while the rim is down.
   */
  readPointer?: () => ComputerUseCursorPoint | null;
  /**
   * Every display the desktop is made of, each with the rectangle it covers.
   *
   * One overlay is built for each of them. macOS gives every display its own Space, and a window
   * that reaches across two displays is drawn on one of them only, so a single overlay the size of
   * the desktop would leave the rim and the cursor invisible on every other display.
   */
  displays: () => readonly HighlightDisplay[];
  cornerRadius?: number;
  pollIntervalMs?: number;
  logger?: Logger;
}

/**
 * Keeps one transparent overlay over the window an agent is working in.
 *
 * The overlay is OpenBot's own. A cursor says where one click lands and says nothing about which
 * window the next twenty actions belong to, so this marks the target window while the agent holds
 * the desktop and hides the moment it lets go. It also carries the agent cursor itself wherever the
 * driver draws none, which is every desktop of more than one display.
 *
 * There is one overlay for each display, because macOS draws a window on one display only. Each
 * covers its own display and stays there, and only the rim inside it moves, so following a window
 * the user drags costs a repaint rather than a window move on every frame. A window that reaches
 * across two displays is marked by both overlays, each drawing the part that falls on it.
 *
 * It floats over every other window. macOS keeps no window of one application between two windows
 * of another - `moveAbove` and `moveTop` both return without an error and change nothing - and a
 * rim the user cannot see says nothing about where the agent works, so the rim stays in sight even
 * while the window it marks is covered.
 *
 * Everything the controller touches is injected, so the placement rules are tested without a
 * desktop: the driver read, the window factory, the load and the send are all the caller's.
 */
export class ComputerUseHighlightController<W extends HighlightOverlayWindow = BrowserWindow> {
  readonly #options: ComputerUseHighlightControllerOptions<W>;
  readonly #logger: Logger;
  readonly #overlays = new Map<number, Overlay<W>>();
  #target: ComputerUseHighlightTarget | null = null;
  #loggedWindowId: number | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #tick: Promise<void> | null = null;
  #destroyed = false;
  /**
   * Which run of the controller a placement belongs to. A tick reads the driver and loads a window,
   * and `stop()` may land between either of those and the placement that follows it. Hiding alone
   * would not hold: the tick would go on to show the overlay again, with no timer left to take it
   * down, and the rim would stay over a desktop no agent is working on.
   */
  #generation = 0;

  constructor(options: ComputerUseHighlightControllerOptions<W>) {
    this.#options = options;
    this.#logger = options.logger ?? logger;
  }

  /** Whether the rim is on screen, on any display. For the test and the diagnostic log only. */
  get visible(): boolean {
    for (const overlay of this.#overlays.values()) {
      if (!overlay.window.isDestroyed() && overlay.window.isVisible()) return true;
    }
    return false;
  }

  start(): void {
    if (this.#destroyed || this.#timer) return;
    const interval = this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#timer = setInterval(() => void this.refresh(), interval);
    // A timer that keeps the process alive would hold a quit open for a whole interval.
    this.#timer.unref?.();
    void this.refresh();
  }

  stop(): void {
    this.#generation += 1;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#hide();
  }

  /**
   * One placement. Ticks never overlap: a driver read that takes longer than the interval would
   * otherwise queue reads behind each other and place the rim from an answer that is already old.
   */
  async refresh(): Promise<void> {
    if (this.#destroyed) return;
    if (this.#tick) return this.#tick;
    this.#tick = this.#refresh().catch((error) => {
      this.#logger.debug("Computer Use highlight could not be placed", { error: toLogValue(error) });
      this.#hide();
    });
    try {
      await this.#tick;
    } finally {
      this.#tick = null;
    }
  }

  destroy(): void {
    this.#destroyed = true;
    this.stop();
    for (const id of [...this.#overlays.keys()]) this.#retire(id);
  }

  async #refresh(): Promise<void> {
    const generation = this.#generation;
    const stale = () => this.#destroyed || this.#generation !== generation;
    const target = await this.#options.readTarget(this.#target);
    if (stale()) return;
    this.#target = target;
    // Only the move from one window to another, not every tick, and never the title: a window
    // title carries the user's own work.
    if ((target?.windowId ?? null) !== this.#loggedWindowId) {
      this.#loggedWindowId = target?.windowId ?? null;
      this.#logger.debug("Computer Use highlight moved", { window: toLogValue(this.#loggedWindowId) });
    }
    if (!target) {
      this.#hide();
      return;
    }
    const displays = this.#options.displays();
    const pointer = this.#options.readPointer?.() ?? null;
    for (const id of [...this.#overlays.keys()]) {
      if (!displays.some((display) => display.id === id)) this.#retire(id);
    }
    for (const display of displays) {
      let overlay = this.#overlays.get(display.id);
      if (!overlay || overlay.window.isDestroyed()) {
        overlay = { window: this.#options.createWindow(display.bounds), loaded: false, bounds: display.bounds };
        this.#overlays.set(display.id, overlay);
      }
      if (!overlay.loaded) {
        overlay.loaded = true;
        await this.#options.loadWindow(overlay.window);
        if (stale() || overlay.window.isDestroyed()) return;
      }
      // Only when the display is resized or moved. Every other tick leaves the window alone, which
      // is the whole point of an overlay the size of the display it sits on.
      if (!sameRectangle(overlay.bounds, display.bounds)) {
        overlay.bounds = display.bounds;
        overlay.window.setBounds(display.bounds, false);
      }
      this.#place(overlay.window, target, display.bounds, pointer);
    }
  }

  /** The rim and the cursor in one display's own pixels, which is what that overlay draws in. */
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
    // Never `show()`: that would take the key window away from the application the agent is
    // typing into, and the overlay can accept no input anyway.
    if (!window.isVisible()) window.showInactive();
  }

  #hide(): void {
    this.#target = null;
    for (const overlay of this.#overlays.values()) {
      if (!overlay.window.isDestroyed() && overlay.window.isVisible()) overlay.window.hide();
    }
  }

  /** Drops the overlay of a display that is gone, so no window is left on a desktop without it. */
  #retire(id: number): void {
    const overlay = this.#overlays.get(id);
    this.#overlays.delete(id);
    if (overlay && !overlay.window.isDestroyed()) overlay.window.destroy();
  }
}

/**
 * The cursor's place inside one overlay, or `null` when there is none or it is on another display.
 *
 * A point outside the overlay is dropped rather than clamped to an edge: a cursor pinned to the
 * side of the screen would claim the agent works there, which is the mistake this whole cursor
 * exists to correct.
 */
function cursorIn(point: ComputerUseCursorPoint | null, display: Rectangle): ComputerUseCursorPoint | null {
  if (!point) return null;
  const x = point.x - display.x;
  const y = point.y - display.y;
  if (x < 0 || y < 0 || x > display.width || y > display.height) return null;
  return { x, y };
}

/** One display's overlay: the window, whether its surface is loaded, and the display it covers. */
interface Overlay<W> {
  window: W;
  loaded: boolean;
  bounds: Rectangle;
}

/** One rectangle of the desktop in one display's own pixels, which is what that overlay draws in. */
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
