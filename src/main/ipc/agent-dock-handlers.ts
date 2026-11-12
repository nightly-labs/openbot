// The agent dock window: the main renderer publishes what it shows, and the dock window reads it,
// sends its actions back, and says when it takes the pointer and the keyboard.

import type { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type AgentDockWindowController, requireAgentDockSender } from "../agent-dock-window";
import {
  parseAgentDockAction,
  parseAgentDockDragPhase,
  parseAgentDockInputRegion,
  parseAgentDockInteractive,
  parseAgentDockPresentation,
  parseAgentDockXWayland,
} from "./app-inputs";
import { authorizedHandler, eventHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface AgentDockIpcDependencies {
  agentDock: Pick<
    AgentDockWindowController,
    | "mainRendererIds"
    | "dockRendererIds"
    | "presentation"
    | "publish"
    | "performAction"
    | "setInteractive"
    | "setInputRegion"
    | "listDisplays"
    | "drag"
  >;
  /** On Wayland, starts OpenBot again on XWayland at each start, or stops that. */
  setXWayland: (enabled: boolean) => Effect.Effect<void, { readonly cause: unknown }>;
}

export function agentDockIpcHandlers({
  agentDock,
  setXWayland,
}: AgentDockIpcDependencies): Pick<IpcGroupHandlers, "agentDock"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) =>
    requireAgentDockSender(event.sender.id, agentDock.mainRendererIds, "main renderer");
  const fromDockRenderer = (event: IpcMainInvokeEvent) =>
    requireAgentDockSender(event.sender.id, agentDock.dockRendererIds, "agent dock window");

  return {
    agentDock: {
      publishPresentation: authorizedHandler(fromMainRenderer, parseAgentDockPresentation, (_event, presentation) =>
        runCauseEffect(agentDock.publish(presentation)),
      ),
      getPresentation: eventHandler((event) => {
        fromDockRenderer(event);
        return agentDock.presentation;
      }),
      performAction: authorizedHandler(fromDockRenderer, parseAgentDockAction, (event, action) =>
        runCauseEffect(agentDock.performAction(event.sender.id, action)),
      ),
      setInteractive: authorizedHandler(fromDockRenderer, parseAgentDockInteractive, (event, input) =>
        agentDock.setInteractive(event.sender.id, input),
      ),
      setInputRegion: authorizedHandler(fromDockRenderer, parseAgentDockInputRegion, (event, rects) =>
        agentDock.setInputRegion(event.sender.id, rects),
      ),
      drag: authorizedHandler(fromDockRenderer, parseAgentDockDragPhase, (event, phase) =>
        agentDock.drag(event.sender.id, phase),
      ),
      setXWayland: authorizedHandler(fromMainRenderer, parseAgentDockXWayland, (_event, input) =>
        runCauseEffect(setXWayland(input.enabled)),
      ),
      listDisplays: eventHandler((event) => {
        fromMainRenderer(event);
        return agentDock.listDisplays();
      }),
    },
  };
}
