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
  | { kind: "custom"; expression: string }
  /**
   * One run at a date and time in the routine timezone. After that run the host pauses the
   * routine, and it cannot resume until the date moves to the future. It stays on this computer's
   * host: the released Team API routes do not list it, and they refuse it on a save.
   */
  | { kind: "once"; date: string; time: string };

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
    case "once":
      return isRoutineDate(value.date) && isRoutineTime(value.time);
    default:
      return false;
  }
}

function isRoutineTime(value: unknown): value is string {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type ReleasedRoutineSchedule = Exclude<RoutineSchedule, { kind: "once" }>;

/**
 * A schedule that the released Team API, channel, event, canvas and template formats can carry.
 * Their frozen decoders reject the whole list for an unknown kind, so a `once` schedule stays on
 * this computer's host.
 */
export function isReleasedRoutineSchedule(value: unknown): value is ReleasedRoutineSchedule {
  return isRoutineSchedule(value) && value.kind !== "once";
}

/** A calendar date as "YYYY-MM-DD" that exists, such as 2028-02-29 but not 2027-02-29. */
export function isRoutineDate(value: unknown): value is string {
  if (!isString(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
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
 * What a routine does with the occurrences that came due while OpenBot was closed: `skip` records
 * them and drops them, `run-once` runs the newest one when OpenBot opens and records the others.
 */
export const ROUTINE_MISSED_POLICIES = ["skip", "run-once"] as const;
export type RoutineMissedPolicy = (typeof ROUTINE_MISSED_POLICIES)[number];

/**
 * Where the runs of an agent routine run: `chat` in the agent's own chat, `thread` in the routine's
 * own side thread, beside the chat. A channel routine runs in its channel and has no such place.
 */
export const ROUTINE_RUN_PLACES = ["chat", "thread"] as const;
export type RoutineRunPlace = (typeof ROUTINE_RUN_PLACES)[number];

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
  /** Absent from a host that does not store it, for the same reason as `limitPolicy`. */
  missedPolicy?: RoutineMissedPolicy;
  /**
   * Set on an agent routine of this computer's host, and of a remote host with `routine-run-place-v1`.
   * A channel routine and the released Team API routes leave it out.
   */
  runIn?: RoutineRunPlace;
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
    (value.missedPolicy === undefined || isOneOf(ROUTINE_MISSED_POLICIES, value.missedPolicy)) &&
    (value.runIn === undefined || isOneOf(ROUTINE_RUN_PLACES, value.runIn)) &&
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

/** The largest count a missed-run record names exactly. A larger count means "more than this". */
export const ROUTINE_MISSED_COUNT_LIMIT = 999;

/**
 * The occurrences that one `cancelled` run stands for: they came due while OpenBot was closed, and
 * none of them ran. `until` is the last of them, or null for one occurrence at `scheduledFor`.
 */
export interface RoutineMissedRuns {
  count: number;
  until: string | null;
}

/**
 * What started a run with no trigger. A run from before the source was stored has none, and a host
 * that does not store it leaves it out; read both as a test run.
 */
export const ROUTINE_RUN_SOURCES = ["test", "script", "webhook"] as const;
export type RoutineRunSource = (typeof ROUTINE_RUN_SOURCES)[number];

/** A run without its owner and without the handle that names the work it started. */
export interface RoutineRunFields {
  id: string;
  routineId: string;
  triggerId: string | null;
  kind: "scheduled" | "manual";
  /** Set only on a manual run that records what started it. */
  source?: RoutineRunSource;
  scheduledFor: string;
  routineName: string;
  instruction: string;
  status: RoutineRunStatus;
  error: string | null;
  /** Set only on a run that records missed occurrences. A host that does not store it leaves it out. */
  missed?: RoutineMissedRuns;
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
    (value.source === undefined || isOneOf(ROUTINE_RUN_SOURCES, value.source)) &&
    isString(value.scheduledFor) &&
    isString(value.routineName) &&
    isString(value.instruction) &&
    isOneOf(
      ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"] as const,
      value.status,
    ) &&
    (value.error === null || isString(value.error)) &&
    (value.missed === undefined || isRoutineMissedRuns(value.missed)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isRoutineMissedRuns(value: unknown): value is RoutineMissedRuns {
  return (
    isDynamicRecord(value) &&
    Number.isSafeInteger(value.count) &&
    Number(value.count) >= 1 &&
    (value.until === null || isString(value.until))
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
  /** `skip` when absent. */
  missedPolicy?: RoutineMissedPolicy;
  /** `chat` when absent. */
  runIn?: RoutineRunPlace;
}

export interface UpdateRoutineInput {
  agentId: string;
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
  runIn?: RoutineRunPlace;
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
