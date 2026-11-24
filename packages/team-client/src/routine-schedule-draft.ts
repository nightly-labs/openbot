import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isRoutineDate, type RoutineSchedule } from "@openbot/contracts/ipc";

export type RoutineClock = string;

export type RoutineHoursWindow = { start: RoutineClock; end: RoutineClock } | null;

export type RoutineScheduleDraft =
  | { kind: "once"; date: string; time: RoutineClock }
  | {
      kind: "hourly";
      everyHours: number;
      days: number[];
      window: RoutineHoursWindow;
      minute?: number;
    }
  | { kind: "daily"; days: number[]; time: RoutineClock }
  | { kind: "weekly"; weekday: number; time: RoutineClock }
  | { kind: "monthly"; day: number; time: RoutineClock }
  | { kind: "yearly"; month: number; day: number; time: RoutineClock }
  | { kind: "custom"; expression: string };

export type RoutineDraftKind = RoutineScheduleDraft["kind"];

export const ROUTINE_DRAFT_KIND_VALUES: readonly RoutineDraftKind[] = [
  "once",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
];

export const ROUTINE_SAVED_DRAFT_KIND_VALUES = ROUTINE_DRAFT_KIND_VALUES.filter((kind) => kind !== "once");

export const ROUTINE_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const ROUTINE_WORKDAYS = [1, 2, 3, 4, 5];

export const ROUTINE_EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12];

const DEFAULT_TIME = "09:00";
const DEFAULT_WINDOW = { start: "09:00", end: "18:00" };
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EVERY_HOURS = new Set(ROUTINE_EVERY_HOURS);

export function isRoutineDraftKind(value: string): value is RoutineDraftKind {
  return ROUTINE_DRAFT_KIND_VALUES.some((kind) => kind === value);
}

export function routineTimeMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function routineDraftTime(draft: RoutineScheduleDraft): RoutineClock | null {
  return "time" in draft ? draft.time : null;
}

function draftDays(draft: RoutineScheduleDraft): number[] | null {
  if (draft.kind === "daily" || draft.kind === "hourly") return draft.days;
  if (draft.kind === "weekly") return [draft.weekday];
  return null;
}

export function switchDraftKind(
  draft: RoutineScheduleDraft,
  kind: RoutineDraftKind,
  today: Date,
): RoutineScheduleDraft {
  if (draft.kind === kind) return draft;
  const time = routineDraftTime(draft) ?? DEFAULT_TIME;
  const days = draftDays(draft);
  switch (kind) {
    case "once": {
      const passed = time <= clock(today.getHours(), today.getMinutes());
      const day = passed ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) : today;
      return { kind, date: routineDateKey(day), time };
    }
    case "hourly":
      return { kind, everyHours: 1, days: days ?? ROUTINE_EVERY_DAY, window: DEFAULT_WINDOW };
    case "daily":
      return { kind, days: days ?? ROUTINE_EVERY_DAY, time };
    case "weekly":
      return { kind, weekday: days?.[0] ?? today.getDay(), time };
    case "monthly":
      return { kind, day: draft.kind === "yearly" ? draft.day : today.getDate(), time };
    case "yearly": {
      const month = today.getMonth() + 1;
      const day = draft.kind === "monthly" ? Math.min(draft.day, routineYearlyDaysInMonth(month)) : today.getDate();
      return { kind, month, day, time };
    }
    case "custom":
      return { kind, expression: routineDraftCron(draft) };
  }
}

function routineDraftCron(draft: RoutineScheduleDraft): string {
  switch (draft.kind) {
    case "once": {
      const date = parseRoutineDateKey(draft.date);
      return `${clockCron(draft.time)} ${date.getDate()} ${date.getMonth() + 1} *`;
    }
    case "hourly":
      return routineHourlyCron(draft);
    case "daily":
      return `${clockCron(draft.time)} * * ${cronDayList(draft.days)}`;
    case "weekly":
      return `${clockCron(draft.time)} * * ${draft.weekday}`;
    case "monthly":
      return `${clockCron(draft.time)} ${draft.day} * *`;
    case "yearly":
      return `${clockCron(draft.time)} ${draft.day} ${draft.month} *`;
    case "custom":
      return draft.expression;
  }
}

export function routineHourlyCron(draft: Extract<RoutineScheduleDraft, { kind: "hourly" }>): string {
  const minute = routineHourlyMinute(draft);
  const step = draft.everyHours > 1 ? `/${draft.everyHours}` : "";
  let hours = `*${step}`;
  if (draft.window) {
    const first = Math.floor(routineTimeMinutes(draft.window.start) / 60);
    const last = Math.max(first, Math.floor((windowEndMinutes(draft.window) - minute) / 60));
    const morning = nextDayFirstHour(first, draft.everyHours);
    if (last < 24) hours = `${first}-${last}${step}`;
    else if (morning > last - 24) hours = `${first}-23${step}`;
    else hours = `${first}-23${step},${morning}-${last - 24}${step}`;
  }
  return `${minute} ${hours} * * ${cronDayList(draft.days)}`;
}

function windowEndMinutes(window: NonNullable<RoutineHoursWindow>): number {
  const end = routineTimeMinutes(window.end);
  return end < routineTimeMinutes(window.start) ? end + 24 * 60 : end;
}

function nextDayFirstHour(first: number, everyHours: number): number {
  return first % everyHours;
}

export function routineHourlyMinute(draft: Extract<RoutineScheduleDraft, { kind: "hourly" }>): number {
  return draft.window ? routineTimeMinutes(draft.window.start) % 60 : (draft.minute ?? 0);
}

function clockCron(time: RoutineClock): string {
  const minutes = routineTimeMinutes(time);
  return `${minutes % 60} ${Math.floor(minutes / 60)}`;
}

function cronDayList(days: number[]): string {
  const sorted = sortedDays(days);
  return sameDays(sorted, ROUTINE_EVERY_DAY) ? "*" : sorted.join(",");
}

export function toggleRoutineDay(days: number[], day: number): number[] {
  if (!days.includes(day)) return [...days, day].sort((left, right) => left - right);
  if (days.length === 1) return days;
  return days.filter((value) => value !== day);
}

export function sameRoutineDays(days: number[], expected: number[]): boolean {
  return sameDays(days, expected);
}

export function routineRunsPerDay(window: RoutineHoursWindow, everyHours: number): number {
  const step = Math.max(1, everyHours) * 60;
  const start = window ? routineTimeMinutes(window.start) : 0;
  const end = window ? windowEndMinutes(window) : 24 * 60 - 1;
  return Math.floor((end - start) / step) + 1;
}

export function routineDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseRoutineDateKey(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export const ROUTINE_YEARLY_CALENDAR_YEAR = 2024;

export function routineYearlyDaysInMonth(month: number): number {
  return new Date(ROUTINE_YEARLY_CALENDAR_YEAR, month, 0).getDate();
}

export type RoutineDraftProblem = "invalidDate" | "cronRequired" | "cronTooLong";

export function routineDraftProblemCode(draft: RoutineScheduleDraft): RoutineDraftProblem | null {
  switch (draft.kind) {
    case "once":
      return isRoutineDate(draft.date) ? null : "invalidDate";
    case "yearly":
      return draft.day > routineYearlyDaysInMonth(draft.month) ? "invalidDate" : null;
    case "custom": {
      const expression = draft.expression.trim();
      if (!expression) return "cronRequired";
      return expression.length > INPUT_LIMITS.routineCron ? "cronTooLong" : null;
    }
    default:
      return null;
  }
}

export function routineScheduleFromDraft(draft: RoutineScheduleDraft): RoutineSchedule {
  switch (draft.kind) {
    case "once":
      return { kind: "once", date: draft.date, time: draft.time };
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
    case "once":
      return { kind: "once", date: schedule.date, time: schedule.time };
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

function intervalCron(schedule: Extract<RoutineSchedule, { kind: "interval" }>): string {
  if (schedule.unit === "minutes" && schedule.amount < 60) return `*/${schedule.amount} * * * *`;
  const hoursPerUnit = { minutes: 1 / 60, hours: 1, days: 24 }[schedule.unit];
  const hours = Math.max(1, Math.round(schedule.amount * hoursPerUnit));
  if (hours < 24) return `0 */${hours} * * *`;
  return `0 0 */${Math.min(31, Math.round(hours / 24))} * *`;
}

function hourlyCronDraft(expression: string): RoutineScheduleDraft | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField = "", hourField = "", monthDay, month, weekDayField = ""] = fields;
  if (monthDay !== "*" || month !== "*" || !/^\d{1,2}$/.test(minuteField)) return null;
  const minute = Number(minuteField);
  const [evening = "", morning, ...extra] = hourField.split(",");
  const hours = /^(\*|(\d{1,2})-(\d{1,2}))(?:\/(\d{1,2}))?$/.exec(evening);
  const days = cronWeekDays(weekDayField);
  if (minute > 59 || !hours || !days || extra.length > 0) return null;
  const everyHours = hours[4] === undefined ? 1 : Number(hours[4]);
  if (!EVERY_HOURS.has(everyHours)) return null;
  if (hours[1] === "*") {
    if (morning !== undefined) return null;
    return { kind: "hourly", everyHours, days, window: null, ...(minute === 0 ? {} : { minute }) };
  }
  const first = Number(hours[2]);
  let last = Number(hours[3]);
  if (first > last || last > 23) return null;
  if (morning !== undefined) {
    const next = last === 23 ? morningLastHour(morning, first, everyHours) : null;
    if (next === null) return null;
    last = next;
  }
  return { kind: "hourly", everyHours, days, window: { start: clock(first, minute), end: clock(last, minute) } };
}

function morningLastHour(source: string, first: number, everyHours: number): number | null {
  const range = /^(\d{1,2})-(\d{1,2})(?:\/(\d{1,2}))?$/.exec(source);
  if (!range) return null;
  const start = Number(range[1]);
  const last = Number(range[2]);
  const step = range[3] === undefined ? 1 : Number(range[3]);
  if (step !== everyHours || start !== nextDayFirstHour(first, everyHours) || last < start || last >= first) {
    return null;
  }
  return last;
}

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
