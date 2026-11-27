import type { WindowFrameState } from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface FramedWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  close(): void;
}

export interface WindowFrameIpcDependencies {
  drawsOwnButtons: boolean;
  appWindowOf: (sender: WebContents) => FramedWindow | null;
  state: (window: FramedWindow) => WindowFrameState;
}

export function windowFrameIpcHandlers({
  drawsOwnButtons,
  appWindowOf,
  state,
}: WindowFrameIpcDependencies): Pick<IpcGroupHandlers, "windowFrame"> {
  const senderWindow = (event: IpcMainInvokeEvent): FramedWindow => {
    const window = appWindowOf(event.sender);
    if (!window) throw new Error("Rejected window frame IPC request outside an app window.");
    return window;
  };
  const buttonWindow = (event: IpcMainInvokeEvent): FramedWindow => {
    const window = senderWindow(event);
    if (!drawsOwnButtons) throw new Error("Rejected window frame IPC request: this window has native buttons.");
    return window;
  };

  return {
    windowFrame: {
      getState: eventHandler((event) => state(senderWindow(event))),
      minimize: eventHandler((event) => {
        buttonWindow(event).minimize();
      }),
      toggleMaximize: eventHandler((event) => {
        const window = buttonWindow(event);
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
      }),
      close: eventHandler((event) => {
        buttonWindow(event).close();
      }),
    },
  };
}
