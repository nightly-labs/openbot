// The agent dock window: the main renderer publishes what it shows, and the dock window reads it,
// sends its actions back, and says when it takes the pointer and the keyboard.

import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type AgentDockWindowController, requireAgentDockSender } from "../agent-dock-window";
import {
  parseAgentDockAction,
  parseAgentDockDragPhase,
  parseAgentDockInteractive,
  parseAgentDockPresentation,
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
    | "listDisplays"
    | "drag"
  >;
}

export function agentDockIpcHandlers({ agentDock }: AgentDockIpcDependencies): Pick<IpcGroupHandlers, "agentDock"> {
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
      drag: authorizedHandler(fromDockRenderer, parseAgentDockDragPhase, (event, phase) =>
        agentDock.drag(event.sender.id, phase),
      ),
      listDisplays: eventHandler((event) => {
        fromMainRenderer(event);
        return agentDock.listDisplays();
      }),
    },
  };
}
