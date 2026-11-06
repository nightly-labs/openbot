import { app, BrowserWindow, powerMonitor, type WebContents } from "electron";

export interface ComputerIdle {
  /** The seconds since the last keyboard or mouse input on this computer. */
  seconds(): number;
}

/**
 * Chromium reads the idle time of Linux from the X11 screen saver extension. A native Wayland session
 * has none, and Chromium gives 0 there (electron/electron#34826): the owner always looked to be at the
 * computer, so their phones never got a notification. In a Wayland session the time counts from the
 * last input in an OpenBot window, until Chromium gives a time above 0, which shows that it can
 * measure the time of this compositor. `ownWindow` names the windows of the user: an agent sends input
 * to the browser views and hidden windows, and that input is not the user's.
 */
export function createComputerIdle(ownWindow: (contents: WebContents) => boolean): ComputerIdle {
  if (process.platform !== "linux" || app.commandLine.getSwitchValue("ozone-platform") !== "wayland") {
    return { seconds: () => powerMonitor.getSystemIdleTime() };
  }
  let lastInput = Date.now();
  let measured = false;
  const watch = ({ webContents: contents }: BrowserWindow) => {
    contents.on("input-event", () => {
      if (ownWindow(contents)) lastInput = Date.now();
    });
  };
  for (const window of BrowserWindow.getAllWindows()) watch(window);
  app.on("browser-window-created", (_event, window) => watch(window));
  return {
    seconds: () => {
      const system = powerMonitor.getSystemIdleTime();
      if (system > 0) measured = true;
      return measured ? system : Math.floor((Date.now() - lastInput) / 1_000);
    },
  };
}
