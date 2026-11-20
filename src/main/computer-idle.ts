import { app, BrowserWindow, powerMonitor, type WebContents } from "electron";

export interface ComputerIdle {
  seconds(): number;
}

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
