// The programs that agents left running on this computer. See `../background-processes.ts`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type BackgroundProcessAgent, listBackgroundProcesses, stopBackgroundProcess } from "../background-processes";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { requireString } from "./validation";

export interface BackgroundProcessIpcDependencies {
  platform: NodeJS.Platform;
  /** The local agents, read at each call, to name the agent that started a program. */
  agents: () => readonly BackgroundProcessAgent[];
}

export function backgroundProcessIpcHandlers({
  platform,
  agents,
}: BackgroundProcessIpcDependencies): Pick<IpcGroupHandlers, "backgroundProcesses"> {
  return {
    backgroundProcesses: {
      list: handler(() => runCauseEffect(listBackgroundProcesses(platform, agents()))),
      stop: payloadHandler(
        (value) => requireString(value, "id", INPUT_LIMITS.identifier),
        (id) => runCauseEffect(stopBackgroundProcess(platform, id)),
      ),
    },
  };
}
