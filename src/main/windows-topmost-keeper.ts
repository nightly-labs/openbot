// Windows only. The agent dock and the Dynamic Island are topmost windows, but other apps can go above
// them: a game or a video player that makes its own window topmost when it is in front, or an app that
// clears the topmost flag of other windows (#7452). Windows sends no event for this. The keeper puts the
// shown windows at the top of the topmost windows again at a short interval, as a user's script that
// fixed it did. The call does not activate the window, so it takes no focus and no key input.

import type { BrowserWindow } from "electron";

/** How long another app can cover a window before it comes back above it. */
const TOPMOST_REFRESH_MS = 2000;

export class WindowsTopmostKeeper {
  readonly #windows = new Set<BrowserWindow>();
  #timer: ReturnType<typeof setInterval> | undefined;

  /** Keeps the window above other apps while it shows, until it closes. */
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

  readonly #refresh = (): void => {
    for (const window of this.#windows) {
      // Electron puts a "floating" window behind the taskbar on Windows, where it can lose the topmost
      // flag. "normal" sets the flag and puts the window at the top of the topmost windows.
      if (!window.isDestroyed() && window.isVisible()) window.setAlwaysOnTop(true, "normal");
    }
  };

  /** The timer runs only while a window shows. */
  readonly #schedule = (): void => {
    const active = [...this.#windows].some((window) => !window.isDestroyed() && window.isVisible());
    if (active && this.#timer === undefined) this.#timer = setInterval(this.#refresh, TOPMOST_REFRESH_MS);
    if (!active && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  };
}
