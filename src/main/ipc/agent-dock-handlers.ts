import type { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type AgentDockWindowController, requireAgentDockSender } from "../agent-dock-window";
import {
  parseAgentDockAction,
  parseAgentDockDragPhase,
  parseAgentDockExtent,
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
    | "setExtent"
    | "listDisplays"
    | "drag"
  >;
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
      setExtent: authorizedHandler(fromDockRenderer, parseAgentDockExtent, (event, extent) =>
        agentDock.setExtent(event.sender.id, extent),
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
