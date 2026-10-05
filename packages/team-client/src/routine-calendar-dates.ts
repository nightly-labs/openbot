/**
 * Calendar days for the routine calendar. A day is a civil date, "2026-10-26", in the viewer's time
 * zone. Day arithmetic happens in UTC on that civil date, so a daylight-saving change never adds or
 * removes a day, and a run is placed by the wall clock of the zone, not by the UTC instant.
 */
export type CalendarDay = string;

const zoneParts = new Map<string, Intl.DateTimeFormat>();

/** The parts are keys, not display text, so the locale is fixed. */
function partsFormat(timeZone: string): Intl.DateTimeFormat {
  const cached = zoneParts.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  zoneParts.set(timeZone, created);
  return created;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of partsFormat(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
  };
}

function dayFromUtc(date: Date): CalendarDay {
  return date.toISOString().slice(0, 10);
}

export function calendarDayOf(instant: Date, timeZone: string): CalendarDay {
  const clock = wallClock(instant, timeZone);
  return dayFromUtc(new Date(Date.UTC(clock.year, clock.month - 1, clock.day)));
}

/** The hour of the wall clock in `timeZone`, 0 to 23. */
export function calendarHourOf(instant: Date, timeZone: string): number {
  return wallClock(instant, timeZone).hour;
}

/** Noon UTC on `day`. Format it with `timeZone: "UTC"` to show the civil date. */
export function calendarDayDate(day: CalendarDay): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

export function addCalendarDays(day: CalendarDay, amount: number): CalendarDay {
  const date = calendarDayDate(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dayFromUtc(date);
}

/** The first day of the week that holds `day`. `weekStartsOn` is 0 for Sunday, 1 for Monday. */
export function calendarWeekStart(day: CalendarDay, weekStartsOn: number): CalendarDay {
  const weekday = calendarDayDate(day).getUTCDay();
  return addCalendarDays(day, -((weekday - weekStartsOn + 7) % 7));
}

export function calendarDays(first: CalendarDay, count: number): CalendarDay[] {
  return Array.from({ length: count }, (_, index) => addCalendarDays(first, index));
}

/** Minutes between the wall clock in `timeZone` and UTC at `instant`. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The day in `days` on which the clocks of `timeZone` change, or `null`. A daylight-saving change
 * happens at night, so the offsets at noon of two days next to each other show it.
 */
export function clockChangeDay(days: readonly CalendarDay[], timeZone: string): CalendarDay | null {
  const offset = (day: CalendarDay) => zoneOffsetMinutes(calendarDayDate(day), timeZone);
  return days.find((day) => offset(addCalendarDays(day, -1)) !== offset(day)) ?? null;
}
