// The programs that agents left running on this computer. See `../background-processes.ts`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BackgroundProcessListInput, BackgroundProcessStopInput } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type BackgroundProcessAgent, listBackgroundProcesses, stopBackgroundProcess } from "../background-processes";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject, optionalPayload, requireString } from "./validation";

export interface BackgroundProcessIpcDependencies {
  platform: NodeJS.Platform;
  /** The local agents, read at each call, to name the agent that started a program. */
  agents: () => readonly BackgroundProcessAgent[];
}

function listInput(value: unknown): BackgroundProcessListInput {
  if (!isObject(value)) throw new Error("Invalid background process request.");
  return { agentId: requireString(value.agentId, "agentId", INPUT_LIMITS.identifier) };
}

function stopInput(value: unknown): BackgroundProcessStopInput {
  if (!isObject(value)) throw new Error("Invalid background process request.");
  const agentId = value.agentId;
  return {
    id: requireString(value.id, "id", INPUT_LIMITS.identifier),
    agentId: agentId === null ? null : requireString(agentId, "agentId", INPUT_LIMITS.identifier),
  };
}

export function backgroundProcessIpcHandlers({
  platform,
  agents,
}: BackgroundProcessIpcDependencies): Pick<IpcGroupHandlers, "backgroundProcesses"> {
  return {
    backgroundProcesses: {
      // Without a payload the settings page asks for every agent's programs.
      list: payloadHandler(optionalPayload(listInput), (input) =>
        runCauseEffect(listBackgroundProcesses(platform, agents(), input?.agentId)),
      ),
      stop: payloadHandler(stopInput, (input) => runCauseEffect(stopBackgroundProcess(platform, input, agents()))),
    },
  };
}
