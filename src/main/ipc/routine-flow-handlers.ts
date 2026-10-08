// Routine flows: the canvas of one agent's routines and the handoffs between its agents. This
// computer's host answers from its own runtime; a joined server answers through `routine-flows-v1`.

import { ROUTINE_FLOWS_CAPABILITY, ROUTINE_FLOWS_ROUTES } from "@openbot/contracts/team-protocol/routine-flows-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import { decodeRemoteRoutineFlowCanvas, decodeRemoteRoutineFlowLink } from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { parseAgentId } from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseConnectRoutineFlow,
  parseDisconnectRoutineFlow,
  parseRemoveRoutineFlowPosition,
  parseSaveRoutineFlowPosition,
  parseUpdateRoutineFlowLink,
} from "./routine-flow-inputs";
import { scopedHandler } from "./scoped-handler";

interface RoutineFlowRemoteServers {
  supportsCapability(serverId: string, capability: typeof ROUTINE_FLOWS_CAPABILITY): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface RoutineFlowIpcDependencies {
  routineFlows: RoutineFlowsHandle;
  remoteServers: RoutineFlowRemoteServers;
}

export function routineFlowIpcHandlers({
  routineFlows,
  remoteServers,
}: RoutineFlowIpcDependencies): Pick<IpcGroupHandlers, "routineFlows"> {
  function remote<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, ROUTINE_FLOWS_CAPABILITY))
      throw new Error(sourceText("error.team.routineFlowsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    routineFlows: {
      canvas: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(routineFlows.canvas(agentId)),
        remote: (agentId, serverId) =>
          remote(serverId, ROUTINE_FLOWS_ROUTES.canvas, decodeRemoteRoutineFlowCanvas, { agentId }),
      }),
      savePosition: scopedHandler(parseSaveRoutineFlowPosition, {
        local: (input) => runCauseEffect(routineFlows.savePosition(input)),
        remote: (input, serverId) => remote(serverId, ROUTINE_FLOWS_ROUTES.savePosition, acceptEmpty, input),
      }),
      removePosition: scopedHandler(parseRemoveRoutineFlowPosition, {
        local: (input) => runCauseEffect(routineFlows.removePosition(input)),
        remote: (input, serverId) => remote(serverId, ROUTINE_FLOWS_ROUTES.removePosition, acceptEmpty, input),
      }),
      connect: scopedHandler(parseConnectRoutineFlow, {
        local: (input) => runCauseEffect(routineFlows.connect(input)),
        remote: (input, serverId) => remote(serverId, ROUTINE_FLOWS_ROUTES.connect, decodeRemoteRoutineFlowLink, input),
      }),
      disconnect: scopedHandler(parseDisconnectRoutineFlow, {
        local: (input) => runCauseEffect(routineFlows.disconnect(input)),
        remote: (input, serverId) => remote(serverId, ROUTINE_FLOWS_ROUTES.disconnect, acceptEmpty, input),
      }),
      updateLink: scopedHandler(parseUpdateRoutineFlowLink, {
        local: (input) => runCauseEffect(routineFlows.updateLink(input)),
        remote: (input, serverId) =>
          remote(serverId, ROUTINE_FLOWS_ROUTES.updateLink, decodeRemoteRoutineFlowLink, input),
      }),
    },
  };
}
