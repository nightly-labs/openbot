// Windows only. The agent dock and the Dynamic Island are topmost windows. A user found them under other
// apps with no topmost flag (#7452), and a script that set the flag again at an interval fixed it. Windows
// sends no event when another process clears the flag, so the keeper reads the flag of the shown windows
// at a short interval and sets it again only when it is gone. A window that has the flag is not moved: a
// move to the top at each interval would cover the window's own menus and fight other topmost windows,
// such as a screen snip or a game. The call does not activate the window, so it takes no focus.

import type { BrowserWindow } from "electron";

/** How long a window can stay without its topmost flag before it gets it again. */
const TOPMOST_CHECK_MS = 2000;

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

  readonly #check = (): void => {
    for (const window of this.#windows) {
      // `isAlwaysOnTop` reads the flag of the window, not the last value that OpenBot set. "normal", as
      // "floating" would put the window behind the taskbar on Windows, where it can lose the flag again.
      if (!window.isDestroyed() && window.isVisible() && !window.isAlwaysOnTop()) window.setAlwaysOnTop(true, "normal");
    }
  };

  /** The timer runs only while a window shows. */
  readonly #schedule = (): void => {
    const active = [...this.#windows].some((window) => !window.isDestroyed() && window.isVisible());
    if (active && this.#timer === undefined) this.#timer = setInterval(this.#check, TOPMOST_CHECK_MS);
    if (!active && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  };
}
