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
 * Each request acts only on the window that sends it. Every app window shares one origin, so the Dynamic
 * Island, the docks and the overlays can send these too; they are not app windows, so nothing happens.
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
      // As the system close button: the main window's `close` handler chooses between hide and quit.
      close: eventHandler((event) => {
        senderWindow(event)?.close();
      }),
    },
  };
}
