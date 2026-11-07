// The programs that agents left running, as main lists them.

import { type BackgroundProcess, isBackgroundProcess } from "@openbot/contracts/ipc";

function decodeBackgroundProcess(value: unknown): BackgroundProcess {
  if (!isBackgroundProcess(value)) throw new Error("Invalid background process.");
  const { id, pid, command, startedAt, ports, agentId } = value;
  return { id, pid, command, startedAt, ports: [...ports], agentId };
}

export function decodeBackgroundProcesses(value: unknown): BackgroundProcess[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("Invalid background processes.");
  return value.map(decodeBackgroundProcess);
}
