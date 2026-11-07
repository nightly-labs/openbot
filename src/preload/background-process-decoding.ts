// The programs that agents left running, as main lists them.

import {
  type BackgroundProcess,
  type BackgroundProcessStopResult,
  isBackgroundProcess,
  isBackgroundProcessStopResult,
} from "@openbot/contracts/ipc";

function decodeBackgroundProcess(value: unknown): BackgroundProcess {
  if (!isBackgroundProcess(value)) throw new Error("Invalid background process.");
  const { id, pid, command, startedAt, ports, agentId, verified, stoppable } = value;
  return { id, pid, command, startedAt, ports: [...ports], agentId, verified, stoppable };
}

export function decodeBackgroundProcesses(value: unknown): BackgroundProcess[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("Invalid background processes.");
  // One program that main writes in an unexpected shape must not hide every other one.
  const processes: BackgroundProcess[] = [];
  for (const item of value) {
    try {
      processes.push(decodeBackgroundProcess(item));
    } catch {
      // The next poll can return the row again.
    }
  }
  return processes;
}

export function decodeBackgroundProcessStopResult(value: unknown): BackgroundProcessStopResult {
  if (!isBackgroundProcessStopResult(value)) throw new Error("Invalid background process stop result.");
  return { stopped: value.stopped, ...(value.reason === undefined ? {} : { reason: value.reason }) };
}
