import { INPUT_LIMITS } from "./input-limits";
import { integerInRange } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export type RoutineIntervalUnit = "minutes" | "hours" | "days";

/** Minimum polling frequency for interval, advanced-every, and custom routine schedules. */
export const ROUTINE_MINIMUM_INTERVAL_MINUTES = 3;
export type RoutineDaySelection =
  | { kind: "every-day" }
  | { kind: "days-of-week"; days: number[] }
  | { kind: "days-of-month"; days: number[] };
export type RoutineTimeSelection =
  | { kind: "at-time"; time: string }
  | { kind: "every"; amount: number; unit: Exclude<RoutineIntervalUnit, "days"> };

export type RoutineSchedule =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval"; amount: number; unit: RoutineIntervalUnit; anchorAt: string }
  | {
      kind: "advanced";
      months: number[];
      days: RoutineDaySelection;
      time: RoutineTimeSelection;
    }
  | { kind: "custom"; expression: string };

export function isRoutineSchedule(value: unknown): value is RoutineSchedule {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case "hourly":
      return integerInRange(value.minute, 0, 59);
    case "daily":
    case "weekdays":
      return isRoutineTime(value.time);
    case "weekly":
      return integerInRange(value.weekday, 0, 6) && isRoutineTime(value.time);
    case "monthly":
      return integerInRange(value.day, 1, 31) && isRoutineTime(value.time);
    case "interval":
      return (
        integerInRange(value.amount, 1, 100_000) &&
        isOneOf(["minutes", "hours", "days"] as const, value.unit) &&
        isString(value.anchorAt) &&
        !Number.isNaN(Date.parse(value.anchorAt))
      );
    case "advanced":
      return (
        Array.isArray(value.months) &&
        value.months.length > 0 &&
        value.months.every((month) => integerInRange(month, 1, 12)) &&
        isRoutineDaySelection(value.days) &&
        isRoutineTimeSelection(value.time)
      );
    case "custom":
      return (
        isString(value.expression) && value.expression.length > 0 && value.expression.length <= INPUT_LIMITS.routineCron
      );
    default:
      return false;
  }
}

function isRoutineTime(value: unknown): value is string {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRoutineDaySelection(value: unknown): value is RoutineDaySelection {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "every-day") return true;
  if (!Array.isArray(value.days) || value.days.length === 0) return false;
  if (value.kind === "days-of-week") return value.days.every((day) => integerInRange(day, 0, 6));
  if (value.kind === "days-of-month") return value.days.every((day) => integerInRange(day, 1, 31));
  return false;
}

function isRoutineTimeSelection(value: unknown): value is RoutineTimeSelection {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "at-time") return isRoutineTime(value.time);
  return (
    value.kind === "every" &&
    integerInRange(value.amount, 1, 100_000) &&
    isOneOf(["minutes", "hours"] as const, value.unit)
  );
}

export interface RoutineTrigger {
  id: string;
  routineId: string;
  schedule: RoutineSchedule;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

function isRoutineTrigger(value: unknown): value is RoutineTrigger {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.routineId) &&
    isRoutineSchedule(value.schedule) &&
    isString(value.nextRunAt) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

/**
 * What a run does while the provider plan of its agent is spent: `wait` stays in the queue until the
 * reset, `skip` is dropped, for a routine whose result is no use when late.
 */
export const ROUTINE_LIMIT_POLICIES = ["wait", "skip"] as const;
export type RoutineLimitPolicy = (typeof ROUTINE_LIMIT_POLICIES)[number];

/**
 * The part of a routine that does not name its owner. One store and one settings panel serve both
 * an agent and a channel; `Routine` and `ChannelRoutine` only add the owner id and keep their own
 * shapes exactly.
 */
export interface RoutineFields {
  id: string;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  trigger: RoutineTrigger;
  /** Absent from a host that does not store it: the released Team API projects a fixed key list. */
  limitPolicy?: RoutineLimitPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface Routine extends RoutineFields {
  agentId: string;
}

export function isRoutineFields(value: unknown): value is RoutineFields {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.instruction) &&
    isBoolean(value.active) &&
    isString(value.timezone) &&
    isRoutineTrigger(value.trigger) &&
    (value.limitPolicy === undefined || isOneOf(ROUTINE_LIMIT_POLICIES, value.limitPolicy)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isRoutine(value: unknown): value is Routine {
  return isDynamicRecord(value) && isRoutineFields(value) && isString(value.agentId);
}

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "needs-attention"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled";

/** A run without its owner and without the handle that names the work it started. */
export interface RoutineRunFields {
  id: string;
  routineId: string;
  triggerId: string | null;
  kind: "scheduled" | "manual";
  scheduledFor: string;
  routineName: string;
  instruction: string;
  status: RoutineRunStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRun extends RoutineRunFields {
  agentId: string;
  deliveryId: string | null;
}

export function isRoutineRunFields(value: unknown): value is RoutineRunFields {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.routineId) &&
    (value.triggerId === null || isString(value.triggerId)) &&
    isOneOf(["scheduled", "manual"] as const, value.kind) &&
    isString(value.scheduledFor) &&
    isString(value.routineName) &&
    isString(value.instruction) &&
    isOneOf(
      ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"] as const,
      value.status,
    ) &&
    (value.error === null || isString(value.error)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isRoutineRun(value: unknown): value is RoutineRun {
  return (
    isDynamicRecord(value) &&
    isRoutineRunFields(value) &&
    isString(value.agentId) &&
    (value.deliveryId === null || isString(value.deliveryId))
  );
}

export interface CreateRoutineInput {
  agentId: string;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  /** `wait` when absent. */
  limitPolicy?: RoutineLimitPolicy;
}

export interface UpdateRoutineInput {
  agentId: string;
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
}

export interface DeleteRoutineInput {
  agentId: string;
  routineId: string;
}

export interface TestRoutineInput {
  agentId: string;
  routineId: string;
}

export interface ListRoutineRunsInput {
  agentId: string;
  routineId: string;
  limit?: number;
}

/** A time range of the routine calendar, as two ISO instants. The host limits its length. */
export interface RoutineCalendarInput {
  from: string;
  to: string;
}

export type RoutineCalendarOwner = { kind: "agent"; agentId: string } | { kind: "channel"; channelId: string };

/** One routine of an agent or a channel, with what the calendar needs to place and name it. */
export interface RoutineCalendarRoutine {
  id: string;
  name: string;
  owner: RoutineCalendarOwner;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
}

/** `scheduled` is a run the schedule will make. The other values are the status of a run the host made. */
export type RoutineCalendarRunStatus = RoutineRunStatus | "scheduled";

export interface RoutineCalendarRun {
  id: string;
  routineId: string;
  at: string;
  status: RoutineCalendarRunStatus;
}

/** Every routine of a host, and its runs in the range: past runs from history, later runs from the schedule. */
export interface RoutineCalendar {
  routines: RoutineCalendarRoutine[];
  runs: RoutineCalendarRun[];
}

const ROUTINE_CALENDAR_RUN_STATUSES = [
  "scheduled",
  "queued",
  "running",
  "needs-attention",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
] as const;

function isRoutineCalendarOwner(value: unknown): value is RoutineCalendarOwner {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "agent") return isString(value.agentId);
  return value.kind === "channel" && isString(value.channelId);
}

function isRoutineCalendarRoutine(value: unknown): value is RoutineCalendarRoutine {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isRoutineCalendarOwner(value.owner) &&
    isBoolean(value.active) &&
    isString(value.timezone) &&
    isRoutineSchedule(value.schedule)
  );
}

function isRoutineCalendarRun(value: unknown): value is RoutineCalendarRun {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.routineId) &&
    isString(value.at) &&
    !Number.isNaN(Date.parse(value.at)) &&
    isOneOf(ROUTINE_CALENDAR_RUN_STATUSES, value.status)
  );
}

export function isRoutineCalendar(value: unknown): value is RoutineCalendar {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.routines) &&
    value.routines.every(isRoutineCalendarRoutine) &&
    Array.isArray(value.runs) &&
    value.runs.every(isRoutineCalendarRun)
  );
}

/**
 * The iCalendar feed of this computer's routines. `url` holds the private token: anyone who has it
 * can read the routine names and times. Null while the feed is off.
 */
export interface RoutineFeed {
  url: string | null;
}

export function isRoutineFeed(value: unknown): value is RoutineFeed {
  return isDynamicRecord(value) && (value.url === null || isString(value.url));
}
