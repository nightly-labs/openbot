// Windows only. A click-through window that forwards the pointer moves to its page, as the agent dock and
// the Dynamic Island do, makes Electron hook each mouse move of the computer (`WH_MOUSE_LL`) into the main
// thread, and Windows moves the cursor only after that thread answers. While many agents work, the main
// process is busy, so the pointer of the whole computer lagged (#6517). The gate keeps the forward on only
// while the cursor is in the zone of a window. Elsewhere there is no hook, and a busy main process delays
// only the moves that go to the window.

import type { BrowserWindow, Point, Rectangle } from "electron";

/** How often the gate reads the cursor. The forward starts at most this late after the cursor comes in. */
const CURSOR_POLL_MS = 50;
/**
 * The polls in a row that find the cursor out of the zone before the forward stops. Then the page has the
 * move that took the cursor out: a stop drops a move that Electron has not given to the page yet.
 */
const POLLS_TO_STOP = 2;

/**
 * Lets the pointer through the window to the apps under it, or not, and keeps the pointer moves going to
 * its page: through the gate on Windows, and with a plain forward on the other systems.
 */
export function letPointerThrough(
  gate: PointerForwardingGate | null | undefined,
  window: BrowserWindow,
  through: boolean,
): void {
  if (gate) gate.setIgnoring(window, through);
  else window.setIgnoreMouseEvents(through, { forward: true });
}

interface GatedWindow {
  /** The window lets the pointer through to the apps under it. */
  ignoring: boolean;
  forwarding: boolean;
  /** The polls in a row that found the cursor out of the zone. */
  outside: number;
  /** The parts of the window, in window px, where its page needs the pointer moves. Null: all of it. */
  zone: readonly Rectangle[] | null;
}

export class PointerForwardingGate {
  readonly #readCursor: () => Point;
  readonly #windows = new Map<BrowserWindow, GatedWindow>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(readCursor: () => Point) {
    this.#readCursor = readCursor;
  }

  /** In place of `setIgnoreMouseEvents(ignoring, { forward: true })`. */
  setIgnoring(window: BrowserWindow, ignoring: boolean): void {
    let entry = this.#windows.get(window);
    if (!entry) {
      entry = { ignoring, forwarding: false, outside: 0, zone: null };
      this.#windows.set(window, entry);
      window.on("show", this.#poll);
      window.on("hide", this.#poll);
      window.once("closed", () => {
        this.#windows.delete(window);
        this.#schedule();
      });
    }
    entry.ignoring = ignoring;
    entry.outside = 0;
    entry.forwarding = ignoring && this.#inZone(window, entry, this.#readCursor());
    window.setIgnoreMouseEvents(ignoring, { forward: entry.forwarding });
    this.#schedule();
  }

  /** The parts of the window, in window px, where its page needs the pointer moves. Null: all of it. */
  setZone(window: BrowserWindow, zone: readonly Rectangle[] | null): void {
    const entry = this.#windows.get(window);
    if (entry) entry.zone = zone;
  }

  readonly #poll = (): void => {
    const cursor = this.#readCursor();
    for (const [window, entry] of this.#windows) {
      if (window.isDestroyed()) {
        this.#windows.delete(window);
        continue;
      }
      if (!entry.ignoring) continue;
      if (this.#inZone(window, entry, cursor)) {
        entry.outside = 0;
        if (!entry.forwarding) {
          this.#forward(window, entry, true);
          // Electron forwards only the moves after this. A cursor that stopped in the zone, as after a
          // flick to the screen edge, would give the page no move, so the page gets the one it missed.
          const bounds = window.getBounds();
          window.webContents.sendInputEvent({ type: "mouseMove", x: cursor.x - bounds.x, y: cursor.y - bounds.y });
        }
        continue;
      }
      entry.outside += 1;
      if (entry.forwarding && (entry.outside >= POLLS_TO_STOP || !window.isVisible())) {
        this.#forward(window, entry, false);
      }
    }
    this.#schedule();
  };

  #forward(window: BrowserWindow, entry: GatedWindow, forward: boolean): void {
    entry.forwarding = forward;
    window.setIgnoreMouseEvents(true, { forward });
  }

  /** The cursor is read only while a shown window lets the pointer through. A closed window stops it. */
  #schedule(): void {
    const active = [...this.#windows].some(
      ([window, entry]) => entry.ignoring && !window.isDestroyed() && window.isVisible(),
    );
    if (active && this.#timer === undefined) this.#timer = setInterval(this.#poll, CURSOR_POLL_MS);
    if (!active && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  #inZone(window: BrowserWindow, entry: GatedWindow, cursor: Point): boolean {
    if (!window.isVisible()) return false;
    const bounds = window.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    const parts = entry.zone ?? [{ x: 0, y: 0, width: bounds.width, height: bounds.height }];
    return parts.some((part) => x >= part.x && y >= part.y && x < part.x + part.width && y < part.y + part.height);
  }
}
