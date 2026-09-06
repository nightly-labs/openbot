// The always-on-top island window: its preference, its presentation, and the actions and
// haptics it sends back.

import type { IpcMainInvokeEvent } from "electron";
import { type DynamicIslandWindowController, requireDynamicIslandSender } from "../dynamic-island-window";
import {
  parseDynamicIslandAction,
  parseDynamicIslandInteractive,
  parseDynamicIslandPreference,
  parseDynamicIslandPresentation,
} from "./app-inputs";
import { authorizedHandler, eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface DynamicIslandIpcDependencies {
  dynamicIsland: DynamicIslandWindowController;
}

export function dynamicIslandIpcHandlers({
  dynamicIsland,
}: DynamicIslandIpcDependencies): Pick<IpcGroupHandlers, "dynamicIsland"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) =>
    requireDynamicIslandSender(event.sender.id, dynamicIsland.mainRendererIds, "main renderer");
  const fromOverlayRenderer = (event: IpcMainInvokeEvent) =>
    requireDynamicIslandSender(event.sender.id, dynamicIsland.overlayRendererIds, "Dynamic Island renderer");

  return {
    dynamicIsland: {
      getPreference: eventHandler((event) => {
        requireDynamicIslandSender(
          event.sender.id,
          new Set([...dynamicIsland.mainRendererIds, ...dynamicIsland.overlayRendererIds]),
          "main or Dynamic Island renderer",
        );
        return dynamicIsland.preference;
      }),
      setPreference: authorizedHandler(fromMainRenderer, parseDynamicIslandPreference, (_event, preference) =>
        dynamicIsland.setPreference(preference),
      ),
      publishPresentation: authorizedHandler(fromMainRenderer, parseDynamicIslandPresentation, (_event, presentation) =>
        dynamicIsland.publish(presentation),
      ),
      getPresentation: eventHandler((event) => {
        fromOverlayRenderer(event);
        return dynamicIsland.presentation;
      }),
      performAction: authorizedHandler(fromOverlayRenderer, parseDynamicIslandAction, (_event, action) =>
        dynamicIsland.performAction(action),
      ),
      performHaptic: eventHandler((event) => {
        fromOverlayRenderer(event);
        dynamicIsland.performHaptic();
      }),
      setInteractive: authorizedHandler(fromOverlayRenderer, parseDynamicIslandInteractive, (event, state) =>
        dynamicIsland.setInteractive(event.sender.id, state.interactive),
      ),
    },
  };
}
