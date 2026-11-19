export type CalendarDay = string;

const zoneParts = new Map<string, Intl.DateTimeFormat>();

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

export function calendarHourOf(instant: Date, timeZone: string): number {
  return wallClock(instant, timeZone).hour;
}

export function calendarDayDate(day: CalendarDay): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

export function addCalendarDays(day: CalendarDay, amount: number): CalendarDay {
  const date = calendarDayDate(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dayFromUtc(date);
}

export function calendarWeekStart(day: CalendarDay, weekStartsOn: number): CalendarDay {
  const weekday = calendarDayDate(day).getUTCDay();
  return addCalendarDays(day, -((weekday - weekStartsOn + 7) % 7));
}

export function calendarMonthStart(day: CalendarDay): CalendarDay {
  return `${day.slice(0, 8)}01`;
}

export function addCalendarMonths(day: CalendarDay, amount: number): CalendarDay {
  const date = calendarDayDate(calendarMonthStart(day));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return dayFromUtc(date);
}

export function calendarDays(first: CalendarDay, count: number): CalendarDay[] {
  return Array.from({ length: count }, (_, index) => addCalendarDays(first, index));
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

export function clockChangeDay(days: readonly CalendarDay[], timeZone: string): CalendarDay | null {
  const offset = (day: CalendarDay) => zoneOffsetMinutes(calendarDayDate(day), timeZone);
  return days.find((day) => offset(addCalendarDays(day, -1)) !== offset(day)) ?? null;
}
