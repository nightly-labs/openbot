import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { RoutineSchedule } from "@openbot/contracts/ipc";
import {
  ROUTINE_DRAFT_KINDS,
  ROUTINE_EVERY_DAY,
  ROUTINE_EVERY_HOURS_OPTIONS,
  ROUTINE_WORKDAYS,
  type RoutineClock,
  type RoutineScheduleDraft,
  routineHourlyCron,
  routineHourlyMinute,
  routineRunsPerDay,
  routineYearlyDaysInMonth,
} from "./routine-schedule-draft";
import { routineTimeMinutes } from "./routine-schedule-ui";

/*
 * The trigger row edits a `RoutineScheduleDraft`; a routine saves a `RoutineSchedule`. The saved
 * kinds are a released Team API contract, so each draft saves as the simplest saved kind that
 * runs at the same times: a yearly run is an advanced schedule, and an hourly run between two
 * times is a cron expression. Reading a schedule back gives the same chips.
 */

/** The kinds a routine can save today. A one-time run needs a new saved kind first. */
export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS.filter((option) => option.value !== "once");

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EVERY_HOURS = new Set(ROUTINE_EVERY_HOURS_OPTIONS.map((option) => Number(option.value)));

/** Why the draft cannot be saved, or `null`. A save of such a draft would change when it runs. */
export function routineDraftProblem(draft: RoutineScheduleDraft): string | null {
  switch (draft.kind) {
    case "once":
      return "A one-time routine cannot be saved yet.";
    case "hourly":
      return routineRunsPerDay(draft.window, draft.everyHours) === 0 ? "End time must be after start time." : null;
    case "yearly":
      return draft.day > routineYearlyDaysInMonth(draft.month) ? "Choose a date that exists." : null;
    case "custom": {
      const expression = draft.expression.trim();
      if (!expression) return "Enter a cron expression.";
      return expression.length > INPUT_LIMITS.routineCron ? "The cron expression is too long." : null;
    }
    default:
      return null;
  }
}

export function routineScheduleFromDraft(draft: RoutineScheduleDraft): RoutineSchedule {
  switch (draft.kind) {
    case "once":
      throw new Error("A one-time routine cannot be saved yet.");
    case "hourly":
      return hourlySchedule(draft);
    case "daily": {
      const days = sortedDays(draft.days);
      if (sameDays(days, ROUTINE_EVERY_DAY)) return { kind: "daily", time: draft.time };
      if (sameDays(days, ROUTINE_WORKDAYS)) return { kind: "weekdays", time: draft.time };
      return {
        kind: "advanced",
        months: ALL_MONTHS,
        days: { kind: "days-of-week", days },
        time: { kind: "at-time", time: draft.time },
      };
    }
    case "weekly":
      return { kind: "weekly", weekday: draft.weekday, time: draft.time };
    case "monthly":
      return { kind: "monthly", day: draft.day, time: draft.time };
    case "yearly":
      return {
        kind: "advanced",
        months: [draft.month],
        days: { kind: "days-of-month", days: [draft.day] },
        time: { kind: "at-time", time: draft.time },
      };
    case "custom":
      return { kind: "custom", expression: draft.expression.trim() };
  }
}

function hourlySchedule(draft: Extract<RoutineScheduleDraft, { kind: "hourly" }>): RoutineSchedule {
  const days = sortedDays(draft.days);
  const everyDay = sameDays(days, ROUTINE_EVERY_DAY);
  const minute = routineHourlyMinute(draft);
  if (!draft.window && draft.everyHours === 1 && everyDay) return { kind: "hourly", minute };
  if (!draft.window && minute === 0) {
    return {
      kind: "advanced",
      months: ALL_MONTHS,
      days: everyDay ? { kind: "every-day" } : { kind: "days-of-week", days },
      time: { kind: "every", amount: draft.everyHours, unit: "hours" },
    };
  }
  return { kind: "custom", expression: routineHourlyCron(draft) };
}

export function routineScheduleToDraft(schedule: RoutineSchedule): RoutineScheduleDraft {
  switch (schedule.kind) {
    case "hourly": {
      const draft: RoutineScheduleDraft = { kind: "hourly", everyHours: 1, days: ROUTINE_EVERY_DAY, window: null };
      return schedule.minute === 0 ? draft : { ...draft, minute: schedule.minute };
    }
    case "daily":
      return { kind: "daily", days: ROUTINE_EVERY_DAY, time: schedule.time };
    case "weekdays":
      return { kind: "daily", days: ROUTINE_WORKDAYS, time: schedule.time };
    case "weekly":
      return { kind: "weekly", weekday: schedule.weekday, time: schedule.time };
    case "monthly":
      return { kind: "monthly", day: schedule.day, time: schedule.time };
    case "advanced":
      return advancedDraft(schedule);
    case "interval":
      return { kind: "custom", expression: intervalCron(schedule) };
    case "custom":
      return hourlyCronDraft(schedule.expression) ?? { kind: "custom", expression: schedule.expression };
  }
}

function advancedDraft(schedule: Extract<RoutineSchedule, { kind: "advanced" }>): RoutineScheduleDraft {
  const months = sortedDays(schedule.months);
  const allMonths = sameDays(months, ALL_MONTHS);
  const weekDays = schedule.days.kind === "every-day" ? ROUTINE_EVERY_DAY : null;
  const days = schedule.days.kind === "days-of-week" ? sortedDays(schedule.days.days) : weekDays;
  const monthDays = schedule.days.kind === "days-of-month" ? sortedDays(schedule.days.days) : null;
  const time = schedule.time;
  if (time.kind === "at-time") {
    if (allMonths && days) return { kind: "daily", days, time: time.time };
    const [month] = months;
    const [day] = monthDays ?? [];
    if (month !== undefined && day !== undefined && months.length === 1 && monthDays?.length === 1) {
      return { kind: "yearly", month, day, time: time.time };
    }
    if (allMonths && day !== undefined && monthDays?.length === 1) return { kind: "monthly", day, time: time.time };
  } else if (allMonths && days && time.unit === "hours" && EVERY_HOURS.has(time.amount)) {
    return { kind: "hourly", everyHours: time.amount, days, window: null };
  }
  return { kind: "custom", expression: advancedCron(schedule) };
}

/** The cron expression that runs at the same times as an advanced schedule. */
function advancedCron(schedule: Extract<RoutineSchedule, { kind: "advanced" }>): string {
  const time = schedule.time;
  let clock = "0 *";
  if (time.kind === "at-time") {
    const minutes = routineTimeMinutes(time.time);
    clock = `${minutes % 60} ${Math.floor(minutes / 60)}`;
  } else if (time.unit === "minutes") {
    clock = `*/${time.amount} *`;
  } else {
    clock = `0 */${time.amount}`;
  }
  const monthDays = schedule.days.kind === "days-of-month" ? cronList(schedule.days.days) : "*";
  const months = sameDays(sortedDays(schedule.months), ALL_MONTHS) ? "*" : cronList(schedule.months);
  const weekDays = schedule.days.kind === "days-of-week" ? cronList(schedule.days.days) : "*";
  return `${clock} ${monthDays} ${months} ${weekDays}`;
}

/**
 * An interval runs from its anchor, which cron cannot say. The nearest cron shows the rate; the
 * saved interval stays until the user changes the schedule.
 */
function intervalCron(schedule: Extract<RoutineSchedule, { kind: "interval" }>): string {
  if (schedule.unit === "minutes" && schedule.amount < 60) return `*/${schedule.amount} * * * *`;
  const hoursPerUnit = { minutes: 1 / 60, hours: 1, days: 24 }[schedule.unit];
  const hours = Math.max(1, Math.round(schedule.amount * hoursPerUnit));
  if (hours < 24) return `0 */${hours} * * *`;
  return `0 0 */${Math.min(31, Math.round(hours / 24))} * *`;
}

/** Reads back the cron that `hourlySchedule` writes: `M H1-H2/N * * DAYS`. */
function hourlyCronDraft(expression: string): RoutineScheduleDraft | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField = "", hourField = "", monthDay, month, weekDayField = ""] = fields;
  if (monthDay !== "*" || month !== "*" || !/^\d{1,2}$/.test(minuteField)) return null;
  const minute = Number(minuteField);
  const hours = /^(\*|(\d{1,2})-(\d{1,2}))(?:\/(\d{1,2}))?$/.exec(hourField);
  const days = cronWeekDays(weekDayField);
  if (minute > 59 || !hours || !days) return null;
  const everyHours = hours[4] === undefined ? 1 : Number(hours[4]);
  if (!EVERY_HOURS.has(everyHours)) return null;
  if (hours[1] === "*") {
    return { kind: "hourly", everyHours, days, window: null, ...(minute === 0 ? {} : { minute }) };
  }
  const first = Number(hours[2]);
  const last = Number(hours[3]);
  if (first > last || last > 23) return null;
  return { kind: "hourly", everyHours, days, window: { start: clock(first, minute), end: clock(last, minute) } };
}

/** `*`, or days and day ranges from 0 to 7, where 7 is Sunday. */
function cronWeekDays(field: string): number[] | null {
  if (field === "*") return ROUTINE_EVERY_DAY;
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)(?:-(\d))?$/.exec(part);
    if (!range) return null;
    const first = Number(range[1]);
    const last = range[2] === undefined ? first : Number(range[2]);
    if (last > 7 || first > last) return null;
    for (let day = first; day <= last; day += 1) days.add(day % 7);
  }
  return sortedDays([...days]);
}

function clock(hour: number, minute: number): RoutineClock {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cronList(values: number[]): string {
  return sortedDays(values).join(",");
}

function sortedDays(days: number[]): number[] {
  return [...new Set(days)].sort((left, right) => left - right);
}

function sameDays(days: number[], expected: number[]): boolean {
  return days.length === expected.length && expected.every((day) => days.includes(day));
}
