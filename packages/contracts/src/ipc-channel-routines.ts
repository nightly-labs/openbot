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

/**
 * `interrupted` is not reachable for a channel run. `ChannelService.complete` maps an interrupted
 * turn to a task in `paused`, which the run reads as `needs-attention` instead.
 */
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

/** `requestMessageId` is the join key: every task a fire produced carries it. */
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
  /** `wait` when absent. */
  limitPolicy?: RoutineLimitPolicy;
  /** `skip` when absent. */
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

/**
 * The task that holds this one, if there is one: the first dependency of the branch below it that
 * failed or that a human has to unblock. A dependency of a dependency counts, because the branch
 * moves again only from its own root.
 */
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

/**
 * Reads the run's status out of the tasks its request produced. Pure, because that is what makes a
 * restart free: the status is a function of durable rows, so a fresh scheduler over the same
 * database reaches the same answer with no in-memory state.
 *
 * `hasAssignment` separates "nobody has picked this up yet" from "a member is on it": an assignment
 * is a durable row, so the difference survives a restart too.
 */
export function channelRunStatusForTasks(
  tasks: readonly ChannelTask[],
  hasAssignment: boolean,
): { status: ChannelRoutineRunStatus; error: string | null } {
  // A later human message can absorb the routine's open task and take its request id with it, and a
  // deleted channel takes every task. Neither is a failure of the routine.
  if (!tasks.length) return { status: "cancelled", error: null };
  if (tasks.some((task) => task.state === "running")) return { status: "running", error: null };
  const open = tasks.filter((task) => task.state === "queued" || task.state === "waiting");
  if (open.length) {
    // A task starts only when every task it delegated is completed, so an open task behind one
    // that stopped is not work in progress: nothing but a human moves it again. Reporting it as
    // queued would hide the reason in the run history while the run cannot advance.
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
  // In a channel, `paused` always means a human has to act: a routing question, an unavailable
  // owner, the assignment limit, an unconfirmed turn, or an explicit Stop.
  const paused = tasks.find((task) => task.state === "paused");
  if (paused) return { status: "needs-attention", error: paused.error };
  // A person cancelled the run from its stopped task: it did not succeed.
  if (tasks.some((task) => task.parentTaskId === null && task.state === "cancelled"))
    return { status: "cancelled", error: null };
  // A completed task has an error only when its owner reported that the run failed (#6667).
  const reported = tasks.find((task) => task.state === "completed" && task.error);
  if (reported) return { status: "failed", error: reported.error };
  // Every task is completed or cancelled. This includes the lead judging that no work was needed.
  return { status: "succeeded", error: null };
}

/** The author id prefix of the request that a channel routine posts (`ChannelService`). */
const CHANNEL_ROUTINE_AUTHOR_PREFIX = "routine:";

/**
 * The run of a channel routine request, for a view that shows the request as a routine marker, as an
 * agent chat does. Its text is the routine instruction, and for a webhook the event data (#11686).
 * The status is the one the host keeps in the run history, from the tasks of the request. A page has
 * no assignments, so a task that waits for its first turn shows as queued. A person's message that
 * continues the request's task takes the task to its own request: the task stays on the page, and
 * the run is cancelled, as the host says. A remote page sends only the tasks of open runs and of its
 * first messages (`pageTasks`), and an older page adds none, so a request whose task is not on the
 * page shows as invoked, as a routine message with no run state does in an agent chat.
 */
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
