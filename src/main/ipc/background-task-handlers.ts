// The programs that OpenBot started for an agent. See `../background-tasks.ts`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { BackgroundTasks } from "../background-tasks";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { requireString } from "./validation";

const MAX_TAIL_BYTES = 16 * 1024;
const DEFAULT_TAIL_BYTES = 4 * 1024;

export interface BackgroundTaskIpcDependencies {
  tasks: BackgroundTasks;
}

function requireTailRequest(value: unknown): { id: string; maxBytes: number } {
  const id = requireString(value, "id", INPUT_LIMITS.identifier);
  const raw = isDynamicRecord(value) ? value.maxBytes : undefined;
  const maxBytes =
    typeof raw === "number" && Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_TAIL_BYTES) : DEFAULT_TAIL_BYTES;
  return { id, maxBytes };
}

export function backgroundTaskIpcHandlers({
  tasks,
}: BackgroundTaskIpcDependencies): Pick<IpcGroupHandlers, "backgroundTasks"> {
  return {
    backgroundTasks: {
      list: payloadHandler(
        (value) => requireString(value, "agentId", INPUT_LIMITS.identifier),
        (agentId) => tasks.list(agentId),
      ),
      tail: payloadHandler(requireTailRequest, ({ id, maxBytes }) => tasks.tail(id, maxBytes)),
      stop: payloadHandler(
        (value) => requireString(value, "id", INPUT_LIMITS.identifier),
        (id) => tasks.stop(id),
      ),
    },
  };
}
