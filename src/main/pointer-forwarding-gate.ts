import type { BrowserWindow, Point, Rectangle } from "electron";

const CURSOR_POLL_MS = 50;
const FAR_CURSOR_POLL_MS = 250;
const CURSOR_REACH_PX_PER_MS = 4;
const POLLS_TO_STOP = 2;

export function letPointerThrough(
  gate: PointerForwardingGate | null | undefined,
  window: BrowserWindow,
  through: boolean,
): void {
  if (gate) gate.setIgnoring(window, through);
  else window.setIgnoreMouseEvents(through, { forward: true });
}

interface GatedWindow {
  ignoring: boolean;
  forwarding: boolean;
  outside: number;
}

export class PointerForwardingGate {
  readonly #readCursor: () => Point;
  readonly #windows = new Map<BrowserWindow, GatedWindow>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readCursor: () => Point) {
    this.#readCursor = readCursor;
  }

  setIgnoring(window: BrowserWindow, ignoring: boolean): void {
    let entry = this.#windows.get(window);
    if (!entry) {
      entry = { ignoring, forwarding: false, outside: 0 };
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
    entry.forwarding = ignoring && this.#inWindow(window, this.#readCursor());
    window.setIgnoreMouseEvents(ignoring, { forward: entry.forwarding });
    this.#stopTimer();
    this.#schedule(CURSOR_POLL_MS);
  }

  readonly #poll = (): void => {
    this.#stopTimer();
    const cursor = this.#readCursor();
    let nearestPx = Number.POSITIVE_INFINITY;
    for (const [window, entry] of this.#windows) {
      if (window.isDestroyed()) {
        this.#windows.delete(window);
        continue;
      }
      if (!entry.ignoring) continue;
      if (this.#inWindow(window, cursor)) {
        entry.outside = 0;
        nearestPx = 0;
        if (!entry.forwarding) {
          this.#forward(window, entry, true);
          const bounds = window.getBounds();
          window.webContents.sendInputEvent({ type: "mouseMove", x: cursor.x - bounds.x, y: cursor.y - bounds.y });
        }
        continue;
      }
      entry.outside += 1;
      if (entry.forwarding && (entry.outside >= POLLS_TO_STOP || !window.isVisible())) {
        this.#forward(window, entry, false);
      }
      if (entry.forwarding) nearestPx = 0;
      else if (window.isVisible()) nearestPx = Math.min(nearestPx, distanceTo(window.getBounds(), cursor));
    }
    this.#schedule(pollDelay(nearestPx));
  };

  #forward(window: BrowserWindow, entry: GatedWindow, forward: boolean): void {
    entry.forwarding = forward;
    window.setIgnoreMouseEvents(true, { forward });
  }

  #schedule(delayMs = CURSOR_POLL_MS): void {
    const active = [...this.#windows].some(
      ([window, entry]) => entry.ignoring && !window.isDestroyed() && window.isVisible(),
    );
    if (!active) this.#stopTimer();
    else if (this.#timer === undefined) this.#timer = setTimeout(this.#poll, delayMs);
  }

  #stopTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #inWindow(window: BrowserWindow, cursor: Point): boolean {
    if (!window.isVisible()) return false;
    const bounds = window.getBounds();
    return (
      cursor.x >= bounds.x &&
      cursor.y >= bounds.y &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y < bounds.y + bounds.height
    );
  }
}

function pollDelay(nearestPx: number): number {
  return Math.min(FAR_CURSOR_POLL_MS, Math.max(CURSOR_POLL_MS, Math.floor(nearestPx / CURSOR_REACH_PX_PER_MS)));
}

function distanceTo(bounds: Rectangle, cursor: Point): number {
  const dx = Math.max(bounds.x - cursor.x, 0, cursor.x - (bounds.x + bounds.width));
  const dy = Math.max(bounds.y - cursor.y, 0, cursor.y - (bounds.y + bounds.height));
  return Math.max(dx, dy);
}
