import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface BrowserPort {
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "activate"
    | "answerPermission"
    | "answerHttpSignIn"
    | "close"
    | "dockPictureInPicture"
    | "dockWindow"
    | "getControlState"
    | "getDisplayState"
    | "getWindowModel"
    | "hidePictureInPicture"
    | "navigate"
    | "onDisplayState"
    | "onLiveViewEvent"
    | "onWindowEvent"
    | "onWindowModel"
    | "open"
    | "publishWindowModel"
    | "reload"
    | "sendLiveViewInput"
    | "sendWindowAction"
    | "setVisible"
    | "startLiveView"
    | "stop"
    | "stopLiveView"
  >;
}

export function browserPort(): BrowserPort {
  return window.openbot;
}
