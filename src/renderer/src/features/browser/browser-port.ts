import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface BrowserPort {
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "activate"
    | "close"
    | "dockPictureInPicture"
    | "dockWindow"
    | "getControlState"
    | "getDisplayState"
    | "getWindowModel"
    | "hidePictureInPicture"
    | "onDisplayState"
    | "onLiveViewEvent"
    | "onWindowModel"
    | "sendLiveViewInput"
    | "sendWindowAction"
    | "setVisible"
    | "startLiveView"
    | "stopLiveView"
  >;
}

export function browserPort(): BrowserPort {
  return window.openbot;
}
