// The window buttons that the page draws in its top row where the window has no system title bar.

import type { WindowControlsState } from "@openbot/contracts/ipc";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { windowControlsState } from "../window-buttons";
import { eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface WindowControlsIpcDependencies {
  /** The main window and the chat windows: the windows whose page draws the window buttons. */
  isAppWindow: (window: BrowserWindow) => boolean;
}

const RESTORED: WindowControlsState = { maximized: false, fullScreen: false };

/**
 * Each request acts on the window of the page that sends it, so a page can minimize, maximize or close
 * only its own window. Every app window shares one origin, so the Dynamic Island, the docks and the
 * overlays could send these too; their windows are not app windows, and nothing happens to them.
 */
export function windowControlsIpcHandlers({
  isAppWindow,
}: WindowControlsIpcDependencies): Pick<IpcGroupHandlers, "windowControls"> {
  const senderWindow = (event: IpcMainInvokeEvent): BrowserWindow | null => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && !window.isDestroyed() && isAppWindow(window) ? window : null;
  };
  return {
    windowControls: {
      getState: eventHandler((event) => {
        const window = senderWindow(event);
        return window ? windowControlsState(window) : RESTORED;
      }),
      minimize: eventHandler((event) => {
        senderWindow(event)?.minimize();
      }),
      toggleMaximize: eventHandler((event) => {
        const window = senderWindow(event);
        if (!window) return;
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
      }),
      // The same as the system close button: the main window's `close` handler decides whether the
      // app hides to the tray or quits.
      close: eventHandler((event) => {
        senderWindow(event)?.close();
      }),
    },
  };
}
