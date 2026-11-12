// The always-on-top island window: its preference, its presentation, and the actions and
// haptics it sends back.

import { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type DynamicIslandWindowController, requireDynamicIslandSender } from "../dynamic-island-window";
import {
  parseDynamicIslandAction,
  parseDynamicIslandInputRegion,
  parseDynamicIslandInteractive,
  parseDynamicIslandPreference,
  parseDynamicIslandPresentation,
  parseDynamicIslandXWayland,
} from "./app-inputs";
import { authorizedHandler, eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface DynamicIslandIpcDependencies {
  dynamicIsland: Pick<
    DynamicIslandWindowController,
    | "mainRendererIds"
    | "overlayRendererIds"
    | "preference"
    | "presentation"
    | "builtInDisplayGeometry"
    | "setPreference"
    | "publish"
    | "performAction"
    | "performHaptic"
    | "setInteractive"
    | "setInputRegion"
  >;
  /** On Wayland, starts OpenBot again on XWayland at each start, or stops that. */
  setXWayland: (enabled: boolean) => Effect.Effect<void, { readonly cause: unknown }>;
  /** Already on XWayland in a Wayland session: keeps that for the next start. Does not restart. */
  keepXWayland: () => Effect.Effect<void, { readonly cause: unknown }>;
}

export function dynamicIslandIpcHandlers({
  dynamicIsland,
  setXWayland,
  keepXWayland,
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
      setPreference: authorizedHandler(fromMainRenderer, parseDynamicIslandPreference, (_event, preference) => {
        const wasEnabled = dynamicIsland.preference.enabled;
        return runCauseEffect(
          dynamicIsland.setPreference(preference).pipe(
            // Linux: an island that is off does not need XWayland, so the next start on a Wayland
            // session uses Wayland again. An island that the user turns on again on XWayland keeps it;
            // another change does not, so a start on XWayland for another reason stays a single start.
            Effect.tap((saved) =>
              saved.enabled
                ? wasEnabled
                  ? Effect.void
                  : keepXWayland().pipe(Effect.ignore)
                : setXWayland(false).pipe(Effect.ignore),
            ),
          ),
        );
      }),
      publishPresentation: authorizedHandler(fromMainRenderer, parseDynamicIslandPresentation, (_event, presentation) =>
        dynamicIsland.publish(presentation),
      ),
      getBuiltInDisplayGeometry: eventHandler((event) => {
        fromMainRenderer(event);
        return dynamicIsland.builtInDisplayGeometry;
      }),
      getPresentation: eventHandler((event) => {
        fromOverlayRenderer(event);
        return dynamicIsland.presentation;
      }),
      performAction: authorizedHandler(fromOverlayRenderer, parseDynamicIslandAction, (_event, action) =>
        runCauseEffect(dynamicIsland.performAction(action)),
      ),
      performHaptic: eventHandler((event) => {
        fromOverlayRenderer(event);
        dynamicIsland.performHaptic();
      }),
      setInteractive: authorizedHandler(fromOverlayRenderer, parseDynamicIslandInteractive, (event, state) =>
        dynamicIsland.setInteractive(event.sender.id, state.interactive, state.keyboard),
      ),
      setInputRegion: authorizedHandler(fromOverlayRenderer, parseDynamicIslandInputRegion, (event, rects) =>
        dynamicIsland.setInputRegion(event.sender.id, rects),
      ),
      setXWayland: authorizedHandler(fromMainRenderer, parseDynamicIslandXWayland, (_event, input) =>
        runCauseEffect(setXWayland(input.enabled)),
      ),
    },
  };
}
