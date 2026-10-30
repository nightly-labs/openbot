/*
 * The separator a transcript draws when the messages under it fall on a later day than the messages
 * above it. Both the agent chat and the channel chat use it, so the rule that decides when a
 * separator appears is here, away from either timeline, and is a pure function of two timestamps.
 */

import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";

/** The clock a caller can replace, so a test does not depend on the day the test runs. */
export interface DayMarkerOptions {
  now?: Date;
  /** The locale of the date and time when the caller gives no `format`. */
  locale?: string;
  /** The interface text. Without it, the label uses the text of the app's provider. */
  t?: AppTranslate;
  /** The interface formats. Without it, the date and time use `locale`. */
  format?: AppFormat;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dayDifference(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

function timeOf(value: Date, options: DayMarkerOptions): string {
  const time = { hour: "numeric", minute: "2-digit" } as const;
  return options.format ? options.format.date(value, time) : value.toLocaleTimeString(options.locale, time);
}

function dateOf(value: Date, now: Date, options: DayMarkerOptions): string {
  // The year shows only when it is not this year.
  const date: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (value.getFullYear() !== now.getFullYear()) date.year = "numeric";
  return options.format ? options.format.date(value, date) : value.toLocaleDateString(options.locale, date);
}

/**
 * The day and time of a moment, in the form of a day separator: "Today 12:55", "Yesterday 11:55" or
 * "Mon 26 Oct 12:55". Other times in a transcript use it too, so a reader sees one date form.
 */
export function dayAndTimeLabel(value: Date, options: DayMarkerOptions = {}): string {
  const now = options.now ?? new Date();
  const age = dayDifference(value, now);
  const t = options.t ?? currentText().t;
  const time = timeOf(value, options);
  if (age === 0) return t("chat.day.today", { time });
  if (age === 1) return t("chat.day.yesterday", { time });
  return t("chat.day.date", { date: dateOf(value, now, options), time });
}

/** The time of a moment alone, in the form of the day separators. */
export function timeLabel(value: Date, options: DayMarkerOptions = {}): string {
  return timeOf(value, options);
}

/**
 * The label for the separator above a message, or `null` when the message needs none.
 *
 * `previousIso` is the time of the message above it, and is absent for the first message of the
 * transcript, which always gets a separator. An unreadable timestamp gives no separator, because a
 * separator that cannot name its day tells the reader nothing.
 */
export function dayMarkerLabel(
  previousIso: string | undefined,
  currentIso: string,
  options: DayMarkerOptions = {},
): string | null {
  const current = new Date(currentIso);
  if (Number.isNaN(current.getTime())) return null;
  if (previousIso !== undefined) {
    const previous = new Date(previousIso);
    if (!Number.isNaN(previous.getTime()) && dayDifference(previous, current) === 0) return null;
  }
  return dayAndTimeLabel(current, options);
}
