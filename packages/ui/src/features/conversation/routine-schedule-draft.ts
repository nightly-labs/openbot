import type { AppMessages, AppTextKey } from "@openbot/i18n";
import {
  parseRoutineDateKey,
  ROUTINE_EVERY_DAY,
  ROUTINE_EVERY_HOURS,
  ROUTINE_WORKDAYS,
  ROUTINE_YEARLY_CALENDAR_YEAR,
  type RoutineClock,
  type RoutineDraftKind,
  type RoutineHoursWindow,
  type RoutineScheduleDraft,
  routineDateKey,
  routineHourlyMinute,
  routineRunsPerDay,
  sameRoutineDays,
} from "@openbot/team-client/routine-schedule-draft";
import { currentText } from "../../text";
import {
  formatRoutineClock,
  type RoutineSelectOption,
  type RoutineText,
  routineClockText,
  routineTimeMinutes,
  routineWeekdayText,
} from "./routine-schedule-ui";

// The draft model is shared with the phone; this module adds the desktop labels.
export {
  isRoutineDraftKind,
  parseRoutineDateKey,
  ROUTINE_EVERY_DAY,
  ROUTINE_EVERY_HOURS,
  ROUTINE_WORKDAYS,
  type RoutineClock,
  type RoutineDraftKind,
  type RoutineHoursWindow,
  type RoutineScheduleDraft,
  routineDateKey,
  routineHourlyCron,
  routineHourlyMinute,
  routineRunsPerDay,
  routineYearlyDaysInMonth,
  switchDraftKind,
  toggleRoutineDay,
} from "@openbot/team-client/routine-schedule-draft";

/** A frequency the menu offers. `label` is the key of its name. */
export interface RoutineDraftKindOption {
  value: RoutineDraftKind;
  label: AppTextKey;
}

export const ROUTINE_DRAFT_KINDS: RoutineDraftKindOption[] = [
  { value: "once", label: "routine.kind.once" },
  { value: "hourly", label: "routine.kind.hourly" },
  { value: "daily", label: "routine.kind.daily" },
  { value: "weekly", label: "routine.kind.weekly" },
  { value: "monthly", label: "routine.kind.monthly" },
  { value: "yearly", label: "routine.kind.yearly" },
  { value: "custom", label: "routine.kind.custom" },
];

export function routineMonthDayOptions(text: RoutineText = currentText()): RoutineSelectOption[] {
  return Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    label: text.t("routine.monthDay.option", { day: index + 1 }),
  }));
}

export function routineEveryHoursOptions(text: RoutineText = currentText()): RoutineSelectOption[] {
  return ROUTINE_EVERY_HOURS.map((hours) => ({
    value: String(hours),
    label: text.t("routine.everyHours.option", { count: hours }),
  }));
}

const sameDays = sameRoutineDays;

type RoutineNamedDaySet = "everyDay" | "weekdays" | "weekends";

function routineNamedDaySet(days: number[]): RoutineNamedDaySet | null {
  if (sameDays(days, ROUTINE_EVERY_DAY)) return "everyDay";
  if (sameDays(days, ROUTINE_WORKDAYS)) return "weekdays";
  if (sameDays(days, [0, 6])) return "weekends";
  return null;
}

const NAMED_DAY_SET_LABEL = {
  everyDay: "routine.days.everyDay",
  weekdays: "routine.days.weekdays",
  weekends: "routine.days.weekends",
} as const satisfies Record<RoutineNamedDaySet, AppTextKey>;

export function routineDaySetLabel(days: number[], text: RoutineText = currentText()): string {
  const named = routineNamedDaySet(days);
  if (named) return text.t(NAMED_DAY_SET_LABEL[named]);
  // Three or more days in a row read as a range, so six days stay short: "Mon–Sat".
  return routineDayRuns(days)
    .map((run) => {
      const first = run[0] ?? 0;
      const last = run.at(-1) ?? first;
      if (run.length < 3) return run.map((day) => routineWeekdayShort(day, text)).join(", ");
      return text.t("routine.days.range", {
        first: routineWeekdayShort(first, text),
        last: routineWeekdayShort(last, text),
      });
    })
    .join(", ");
}

/** The days chip: the day set, or a count when the list is too long for one row. */
export function routineDayChipLabel(days: number[], text: RoutineText = currentText()): string {
  const label = routineDaySetLabel(days, text);
  return label.length > 13 ? text.t("routine.days.count", { count: new Set(days).size }) : label;
}

/**
 * The days as runs of consecutive days, in week order. A run that crosses from Saturday to
 * Sunday joins into one range at the end when it is long enough: Friday to Monday is "Fri–Mon".
 */
function routineDayRuns(days: number[]): number[][] {
  const runs: number[][] = [];
  for (const day of [...new Set(days)].sort((left, right) => left - right)) {
    const run = runs.at(-1);
    if (run && run.at(-1) === day - 1) run.push(day);
    else runs.push([day]);
  }
  const first = runs[0];
  const last = runs.at(-1);
  if (runs.length > 1 && first?.[0] === 0 && last?.at(-1) === 6 && first.length + last.length >= 3) {
    runs.shift();
    last.push(...first);
  }
  return runs;
}

export function routineWeekdayName(day: number, text: RoutineText = currentText()): string {
  return routineWeekdayText(day, "long", text);
}

export function routineWeekdayShort(day: number, text: RoutineText = currentText()): string {
  return routineWeekdayText(day, "short", text);
}

export function routineWeekdayInitial(day: number, text: RoutineText = currentText()): string {
  return routineWeekdayText(day, "narrow", text);
}

/**
 * The hours chip: "All day", "All day at :30" for runs past the hour, "9 AM–6 PM", or
 * "10:30–11:30 AM" when both ends share a half of the day. The step is on the frequency chip.
 */
export function routineHoursLabel(window: RoutineHoursWindow, minute = 0, text: RoutineText = currentText()): string {
  const { t } = text;
  if (!window) {
    return minute > 0
      ? t("routine.hours.allDayAt", { minute: String(minute).padStart(2, "0") })
      : t("routine.hours.allDay");
  }
  const start = splitClock(window.start);
  const end = splitClock(window.end);
  if (start.meridiem === end.meridiem) {
    return t("routine.hours.windowSameHalf", {
      start: shortClockDigits(start),
      end: shortClockDigits(end),
      meridiem: start.meridiem === "PM" ? t("routine.clock.pm") : t("routine.clock.am"),
    });
  }
  return t("routine.hours.window", {
    start: formatRoutineClockShort(window.start, text),
    end: formatRoutineClockShort(window.end, text),
  });
}

/** The frequency chip of an hourly run: "Hourly", or "Every 2h" with a longer step. */
export function routineHourlyLabel(everyHours: number, text: RoutineText = currentText()): string {
  return everyHours <= 1 ? text.t("routine.kind.hourly") : text.t("routine.hours.everyShort", { hours: everyHours });
}

/** "9" on the hour and "9:30" otherwise. */
function shortClockDigits(parts: RoutineClockParts): string {
  return parts.minute === 0 ? String(parts.hour) : `${parts.hour}:${String(parts.minute).padStart(2, "0")}`;
}

/** "9 AM" on the hour and "9:30 AM" otherwise, for labels that must stay short. */
export function formatRoutineClockShort(value: RoutineClock, text: RoutineText = currentText()): string {
  const parts = splitClock(value);
  return routineClockText(shortClockDigits(parts), parts.meridiem === "PM", text);
}

export function routineRunsPerDayLabel(
  window: RoutineHoursWindow,
  everyHours: number,
  text: RoutineText = currentText(),
): string {
  const runs = routineRunsPerDay(window, everyHours);
  if (runs === 0) return text.t("routine.hours.endBeforeStart");
  return text.t("routine.hours.runsPerDay", { count: runs });
}

/** "Thu, Sep 24". */
export function formatRoutineDate(value: string, text: RoutineText = currentText()): string {
  return text.format.date(parseRoutineDateKey(value), { weekday: "short", month: "short", day: "numeric" });
}

/** The date chip: "Sep 24", with the year only when it is not the current one. */
export function routineDateChipLabel(value: string, today: Date, text: RoutineText = currentText()): string {
  const date = parseRoutineDateKey(value);
  return date.getFullYear() === today.getFullYear()
    ? text.format.date(date, { month: "short", day: "numeric" })
    : text.format.date(date, { month: "short", day: "numeric", year: "numeric" });
}

const YEARLY_CALENDAR_YEAR = ROUTINE_YEARLY_CALENDAR_YEAR;

export function routineYearlyDateKey(month: number, day: number): string {
  return routineDateKey(new Date(YEARLY_CALENDAR_YEAR, month - 1, day));
}

export function isRoutineYearlyCalendarYear(date: Date): boolean {
  return date.getFullYear() === YEARLY_CALENDAR_YEAR;
}

export function routineYearlyCalendarDate(month: number, day: number): Date {
  return new Date(YEARLY_CALENDAR_YEAR, month, day);
}

function monthDate(month: number): Date {
  return new Date(YEARLY_CALENDAR_YEAR, month >= 1 && month <= 12 ? month - 1 : 0, 1);
}

export function routineMonthName(month: number, text: RoutineText = currentText()): string {
  return text.format.date(monthDate(month), { month: "long" });
}

const HOURLY_DAYS_SUMMARY = {
  everyDay: "routine.draftSummary.hourlyEveryDay",
  weekdays: "routine.draftSummary.hourlyWeekdays",
  weekends: "routine.draftSummary.hourlyWeekends",
} as const satisfies Record<RoutineNamedDaySet, keyof AppMessages>;

const DAILY_SUMMARY = {
  everyDay: "routine.summary.daily",
  weekdays: "routine.summary.weekdays",
  weekends: "routine.draftSummary.dailyWeekends",
} as const satisfies Record<RoutineNamedDaySet, keyof AppMessages>;

export function routineDraftSummary(draft: RoutineScheduleDraft, text: RoutineText = currentText()): string {
  const { t } = text;
  switch (draft.kind) {
    case "once":
      return t("routine.draftSummary.once", {
        date: formatRoutineDate(draft.date, text),
        time: formatRoutineClock(draft.time, text),
      });
    case "hourly": {
      const minute = routineHourlyMinute(draft);
      const everyHours = t("routine.draftSummary.everyHours", { count: draft.everyHours });
      const every =
        !draft.window && minute > 0
          ? t("routine.draftSummary.atMinute", { every: everyHours, minute: String(minute).padStart(2, "0") })
          : everyHours;
      const named = routineNamedDaySet(draft.days);
      const days = named
        ? t(HOURLY_DAYS_SUMMARY[named], { every })
        : t("routine.draftSummary.hourlyOnDays", { every, days: routineDaySetLabel(draft.days, text) });
      if (!draft.window) return days;
      return t("routine.draftSummary.between", {
        schedule: days,
        start: formatRoutineClock(draft.window.start, text),
        end: formatRoutineClock(draft.window.end, text),
      });
    }
    case "daily": {
      const time = formatRoutineClock(draft.time, text);
      const named = routineNamedDaySet(draft.days);
      return named
        ? t(DAILY_SUMMARY[named], { time })
        : t("routine.draftSummary.dailyOnDays", { days: routineDaySetLabel(draft.days, text), time });
    }
    case "weekly":
      return t("routine.draftSummary.weekly", {
        weekday: routineWeekdayName(draft.weekday, text),
        time: formatRoutineClock(draft.time, text),
      });
    case "monthly":
      return t("routine.draftSummary.monthly", { day: draft.day, time: formatRoutineClock(draft.time, text) });
    case "yearly":
      return t("routine.draftSummary.yearly", {
        month: routineMonthName(draft.month, text),
        day: draft.day,
        time: formatRoutineClock(draft.time, text),
      });
    case "custom":
      return t("routine.draftSummary.custom", { expression: draft.expression });
  }
}

export type RoutineMeridiem = "AM" | "PM";

export interface RoutineClockParts {
  hour: number;
  minute: number;
  meridiem: RoutineMeridiem;
}

export function splitClock(value: RoutineClock): RoutineClockParts {
  const minutes = routineTimeMinutes(value);
  const hour24 = Math.floor(minutes / 60) % 24;
  return { hour: hour24 % 12 || 12, minute: minutes % 60, meridiem: hour24 >= 12 ? "PM" : "AM" };
}

export function joinClock(parts: RoutineClockParts): RoutineClock {
  const hour = clamp(Math.trunc(parts.hour), 1, 12) % 12;
  const hour24 = parts.meridiem === "PM" ? hour + 12 : hour;
  const minute = clamp(Math.trunc(parts.minute), 0, 59);
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Reads a typed hour. The box shows a 12-hour clock, but a person can type a 24-hour one: 18 is
 * 6 PM and 0 is 12 AM. Other values keep the half of the day that is set.
 */
export function typedClockHour(typed: number, meridiem: RoutineMeridiem): Pick<RoutineClockParts, "hour" | "meridiem"> {
  if (typed === 0) return { hour: 12, meridiem: "AM" };
  if (typed > 12 && typed < 24) return { hour: typed - 12, meridiem: "PM" };
  return { hour: typed, meridiem };
}

/** Wraps a stepped value inside its range, so ArrowUp on 12 gives 1 and ArrowDown on 0 gives 59. */
export function wrapClockValue(value: number, min: number, max: number): number {
  const span = max - min + 1;
  return ((((value - min) % span) + span) % span) + min;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
