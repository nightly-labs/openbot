import type { BrowserWindow, Point } from "electron";

const CURSOR_POLL_MS = 50;
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
  #timer: ReturnType<typeof setInterval> | undefined;

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
    this.#schedule();
  }

  readonly #poll = (): void => {
    const cursor = this.#readCursor();
    for (const [window, entry] of this.#windows) {
      if (window.isDestroyed()) {
        this.#windows.delete(window);
        continue;
      }
      if (!entry.ignoring) continue;
      if (this.#inWindow(window, cursor)) {
        entry.outside = 0;
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
    }
    this.#schedule();
  };

  #forward(window: BrowserWindow, entry: GatedWindow, forward: boolean): void {
    entry.forwarding = forward;
    window.setIgnoreMouseEvents(true, { forward });
  }

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
