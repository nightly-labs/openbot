// The payloads of the routine flow endpoints. Only a malformed payload fails here, so the text stays English.

import {
  type ConnectRoutineFlowInput,
  type DisconnectRoutineFlowInput,
  isConnectRoutineFlowInput,
  isDisconnectRoutineFlowInput,
  isRemoveRoutineFlowPositionInput,
  isSaveRoutineFlowPositionInput,
  type RemoveRoutineFlowPositionInput,
  type SaveRoutineFlowPositionInput,
} from "@openbot/contracts/ipc";

export function parseSaveRoutineFlowPosition(value: unknown): SaveRoutineFlowPositionInput {
  if (!isSaveRoutineFlowPositionInput(value)) throw new Error("Invalid routine flow position.");
  return { agentId: value.agentId, nodeKey: value.nodeKey, x: value.x, y: value.y };
}

export function parseRemoveRoutineFlowPosition(value: unknown): RemoveRoutineFlowPositionInput {
  if (!isRemoveRoutineFlowPositionInput(value)) throw new Error("Invalid routine flow position.");
  return { agentId: value.agentId, nodeKey: value.nodeKey };
}

export function parseConnectRoutineFlow(value: unknown): ConnectRoutineFlowInput {
  if (!isConnectRoutineFlowInput(value)) throw new Error("Invalid routine flow link.");
  return {
    routineId: value.routineId,
    fromAgentId: value.fromAgentId,
    toAgentId: value.toAgentId,
    ...(value.instruction === undefined ? {} : { instruction: value.instruction }),
  };
}

export function parseDisconnectRoutineFlow(value: unknown): DisconnectRoutineFlowInput {
  if (!isDisconnectRoutineFlowInput(value)) throw new Error("Invalid routine flow link.");
  return { linkId: value.linkId };
}
