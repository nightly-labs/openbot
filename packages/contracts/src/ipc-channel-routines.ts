import { INPUT_LIMITS } from "./input-limits";
import {
  isRoutineFields,
  isRoutineRunFields,
  type RoutineFields,
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
}

export interface UpdateChannelRoutineInput {
  channelId: string;
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
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
