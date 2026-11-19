import { INPUT_LIMITS } from "./input-limits";
import type { ChannelMessage, ChannelTask } from "./ipc-chat-channels";
import {
  isRoutineFields,
  isRoutineRunFields,
  type RoutineFields,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineRunFields,
  type RoutineRunStatus,
  type RoutineSchedule,
} from "./ipc-routines";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export type ChannelRoutineRunStatus = Exclude<RoutineRunStatus, "interrupted">;

export const CHANNEL_ROUTINE_RUN_STATUSES = [
  "queued",
  "running",
  "needs-attention",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export interface ChannelRoutine extends RoutineFields {
  channelId: string;
}

export interface ChannelRoutineRun extends Omit<RoutineRunFields, "status"> {
  channelId: string;
  requestMessageId: string | null;
  status: ChannelRoutineRunStatus;
}

export function isChannelRoutine(value: unknown): value is ChannelRoutine {
  return isDynamicRecord(value) && isRoutineFields(value) && isOwnerId(value.channelId);
}

export function isChannelRoutineRun(value: unknown): value is ChannelRoutineRun {
  return (
    isDynamicRecord(value) &&
    isRoutineRunFields(value) &&
    isOwnerId(value.channelId) &&
    (value.requestMessageId === null || isOwnerId(value.requestMessageId)) &&
    isOneOf(CHANNEL_ROUTINE_RUN_STATUSES, value.status)
  );
}

function isOwnerId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= INPUT_LIMITS.identifier;
}

export function decodeChannelRoutines(value: unknown): ChannelRoutine[] {
  if (!Array.isArray(value) || !value.every(isChannelRoutine)) throw new Error("Invalid channel routine response.");
  return value;
}

export function decodeChannelRoutineRuns(value: unknown): ChannelRoutineRun[] {
  if (!Array.isArray(value) || !value.every(isChannelRoutineRun))
    throw new Error("Invalid channel routine run response.");
  return value;
}

export function decodeChannelRoutine(value: unknown): ChannelRoutine {
  if (!isChannelRoutine(value)) throw new Error("Invalid channel routine response.");
  return value;
}

export function decodeChannelRoutineRun(value: unknown): ChannelRoutineRun {
  if (!isChannelRoutineRun(value)) throw new Error("Invalid channel routine run response.");
  return value;
}

export interface CreateChannelRoutineInput {
  channelId: string;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
}

export interface UpdateChannelRoutineInput {
  channelId: string;
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
}

export interface DeleteChannelRoutineInput {
  channelId: string;
  routineId: string;
}

export interface TestChannelRoutineInput {
  channelId: string;
  routineId: string;
}

export interface ListChannelRoutineRunsInput {
  channelId: string;
  routineId: string;
  limit?: number;
}

function stoppedBlocker(
  tasks: readonly ChannelTask[],
  task: ChannelTask,
  seen = new Set<string>(),
): ChannelTask | null {
  for (const id of task.dependencies) {
    if (seen.has(id)) continue;
    seen.add(id);
    const dependency = tasks.find((item) => item.id === id);
    if (!dependency) continue;
    if (dependency.state === "failed" || dependency.state === "paused") return dependency;
    const deeper = stoppedBlocker(tasks, dependency, seen);
    if (deeper) return deeper;
  }
  return null;
}

export function channelRunStatusForTasks(
  tasks: readonly ChannelTask[],
  hasAssignment: boolean,
): { status: ChannelRoutineRunStatus; error: string | null } {
  if (!tasks.length) return { status: "cancelled", error: null };
  if (tasks.some((task) => task.state === "running")) return { status: "running", error: null };
  const open = tasks.filter((task) => task.state === "queued" || task.state === "waiting");
  if (open.length) {
    const blocked = open.map((task) => stoppedBlocker(tasks, task));
    const free = blocked.some((blocker) => !blocker);
    if (free) return { status: hasAssignment ? "running" : "queued", error: null };
    const blocker = blocked.find((task) => task?.state === "failed") ?? blocked[0];
    if (blocker)
      return blocker.state === "failed"
        ? { status: "failed", error: blocker.error }
        : { status: "needs-attention", error: blocker.error };
  }
  const failed = tasks.find((task) => task.state === "failed");
  if (failed) return { status: "failed", error: failed.error };
  const paused = tasks.find((task) => task.state === "paused");
  if (paused) return { status: "needs-attention", error: paused.error };
  if (tasks.some((task) => task.parentTaskId === null && task.state === "cancelled"))
    return { status: "cancelled", error: null };
  const reported = tasks.find((task) => task.state === "completed" && task.error);
  if (reported) return { status: "failed", error: reported.error };
  return { status: "succeeded", error: null };
}

const CHANNEL_ROUTINE_AUTHOR_PREFIX = "routine:";

export function channelRoutineRequest(
  entry: ChannelMessage,
  tasks: readonly ChannelTask[],
): { routineId: string; runId: string; routineName: string; status: ChannelRoutineRunStatus } | null {
  if (entry.author.kind !== "member" || !entry.author.id.startsWith(CHANNEL_ROUTINE_AUTHOR_PREFIX)) return null;
  const owned = tasks.filter((task) => task.requestMessageId === entry.id);
  const known = owned.length > 0 || tasks.some((task) => task.id === entry.taskId);
  return {
    routineId: entry.author.id.slice(CHANNEL_ROUTINE_AUTHOR_PREFIX.length),
    runId: entry.id,
    routineName: entry.author.name,
    status: known ? channelRunStatusForTasks(owned, false).status : "queued",
  };
}
