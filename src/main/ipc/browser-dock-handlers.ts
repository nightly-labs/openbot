// The dock over a local page: the main renderer publishes it, and the overlay view above the page shows
// it, sends its actions back, and reports the space it needs.

import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type BrowserDockOverlay, requireBrowserDockSender } from "../browser-dock-overlay";
import { parseBrowserDockAction, parseBrowserDockFrame, parseBrowserDockPresentation } from "./app-inputs";
import { authorizedHandler, eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface BrowserDockIpcDependencies {
  browserDock: Pick<
    BrowserDockOverlay,
    "mainRendererIds" | "overlayRendererIds" | "presentation" | "publish" | "performAction" | "setFrame"
  >;
}

export function browserDockIpcHandlers({
  browserDock,
}: BrowserDockIpcDependencies): Pick<IpcGroupHandlers, "browserDock"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) =>
    requireBrowserDockSender(event.sender.id, browserDock.mainRendererIds, "main renderer");
  const fromOverlayRenderer = (event: IpcMainInvokeEvent) =>
    requireBrowserDockSender(event.sender.id, browserDock.overlayRendererIds, "browser dock overlay");

  return {
    browserDock: {
      publishPresentation: authorizedHandler(fromMainRenderer, parseBrowserDockPresentation, (_event, presentation) =>
        runCauseEffect(browserDock.publish(presentation)),
      ),
      getPresentation: eventHandler((event) => {
        fromOverlayRenderer(event);
        return browserDock.presentation;
      }),
      performAction: authorizedHandler(fromOverlayRenderer, parseBrowserDockAction, (_event, action) =>
        browserDock.performAction(action),
      ),
      setFrame: authorizedHandler(fromOverlayRenderer, parseBrowserDockFrame, (_event, frame) =>
        browserDock.setFrame(frame),
      ),
    },
  };
}
