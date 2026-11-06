// The programs that OpenBot started for an agent, as main lists them.

import { type BackgroundTask, isBackgroundTask } from "@openbot/contracts/ipc";

function decodeBackgroundTask(value: unknown): BackgroundTask {
  if (!isBackgroundTask(value)) throw new Error("Invalid background task.");
  const { id, agentId, command, title, pid, startedAt, endedAt, exitCode, status, lastLine, logPath } = value;
  return { id, agentId, command, title, pid, startedAt, endedAt, exitCode, status, lastLine, logPath };
}

export function decodeBackgroundTasks(value: unknown): BackgroundTask[] {
  if (!Array.isArray(value)) throw new Error("Invalid background tasks.");
  return value.map(decodeBackgroundTask);
}

export function decodeBackgroundTaskTail(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid background task output.");
  return value;
}
