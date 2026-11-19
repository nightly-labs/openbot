import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface BrowserPort {
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "activate"
    | "close"
    | "dockPictureInPicture"
    | "getControlState"
    | "getDisplayState"
    | "hidePictureInPicture"
    | "onDisplayState"
    | "onLiveViewEvent"
    | "sendLiveViewInput"
    | "setVisible"
    | "startLiveView"
    | "stopLiveView"
  >;
}

export function browserPort(): BrowserPort {
  return window.openbot;
}
