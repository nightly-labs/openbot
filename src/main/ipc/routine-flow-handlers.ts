// Routine flows: the canvas of one agent's routines and the handoffs between its agents. Only this
// computer's host keeps them, so a remote server is answered with a sentence instead of a request.

import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import { parseAgentId } from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseConnectRoutineFlow,
  parseDisconnectRoutineFlow,
  parseRemoveRoutineFlowPosition,
  parseSaveRoutineFlowPosition,
} from "./routine-flow-inputs";
import { scopedHandler } from "./scoped-handler";

interface RoutineFlowIpcDependencies {
  routineFlows: RoutineFlowsHandle;
}

function remoteUnsupported(): never {
  throw new Error(sourceText("error.backend.routineFlowRemoteUnsupported"));
}

export function routineFlowIpcHandlers({
  routineFlows,
}: RoutineFlowIpcDependencies): Pick<IpcGroupHandlers, "routineFlows"> {
  return {
    routineFlows: {
      canvas: scopedHandler(parseAgentId, {
        local: (agentId) => runCauseEffect(routineFlows.canvas(agentId)),
        remote: remoteUnsupported,
      }),
      savePosition: scopedHandler(parseSaveRoutineFlowPosition, {
        local: (input) => runCauseEffect(routineFlows.savePosition(input)),
        remote: remoteUnsupported,
      }),
      removePosition: scopedHandler(parseRemoveRoutineFlowPosition, {
        local: (input) => runCauseEffect(routineFlows.removePosition(input)),
        remote: remoteUnsupported,
      }),
      connect: scopedHandler(parseConnectRoutineFlow, {
        local: (input) => runCauseEffect(routineFlows.connect(input)),
        remote: remoteUnsupported,
      }),
      disconnect: scopedHandler(parseDisconnectRoutineFlow, {
        local: (input) => runCauseEffect(routineFlows.disconnect(input)),
        remote: remoteUnsupported,
      }),
    },
  };
}
