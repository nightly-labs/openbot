import type { BrowserWindow } from "electron";

const TOPMOST_CHECK_MS = 2000;

export class WindowsTopmostKeeper {
  readonly #windows = new Set<BrowserWindow>();
  #timer: ReturnType<typeof setInterval> | undefined;

  keep(window: BrowserWindow): void {
    if (this.#windows.has(window)) return;
    this.#windows.add(window);
    window.on("show", this.#schedule);
    window.on("hide", this.#schedule);
    window.once("closed", () => {
      this.#windows.delete(window);
      this.#schedule();
    });
    this.#schedule();
  }

  readonly #check = (): void => {
    for (const window of this.#windows) {
      if (!window.isDestroyed() && window.isVisible() && !window.isAlwaysOnTop()) window.setAlwaysOnTop(true, "normal");
    }
  };

  readonly #schedule = (): void => {
    const active = [...this.#windows].some((window) => !window.isDestroyed() && window.isVisible());
    if (active && this.#timer === undefined) this.#timer = setInterval(this.#check, TOPMOST_CHECK_MS);
    if (!active && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  };
}
