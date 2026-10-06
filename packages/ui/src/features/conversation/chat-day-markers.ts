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

function dateOf(value: Date, options: DayMarkerOptions): string {
  const date = { weekday: "short", month: "short", day: "numeric" } as const;
  return options.format ? options.format.date(value, date) : value.toLocaleDateString(options.locale, date);
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
  const now = options.now ?? new Date();
  const age = dayDifference(current, now);
  const t = options.t ?? currentText().t;
  const time = timeOf(current, options);
  if (age === 0) return t("chat.day.today", { time });
  if (age === 1) return t("chat.day.yesterday", { time });
  return t("chat.day.date", { date: dateOf(current, options), time });
}

/** How many calendar days lie from one time to a later one, in local time: 0 for the same day. */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, dayDifference(from, to));
}

/** Where a day starts in a transcript: the row that carries its separator, and the separator's text. */
export interface ChatDaySection {
  index: number;
  label: string;
}

/** A transcript row as the day rule reads it: its stored time, and the time its footer prints. */
export interface ChatDayRow {
  createdAt?: string | undefined;
  time?: string | undefined;
}

/**
 * The days of a transcript, in the rule of `dayMarkerLabel`. The first row always opens a day, so a
 * transcript with rows has at least one. A first row with no stored time takes the label its separator
 * shows: the time in its footer, or "now".
 */
export function chatDaySections(rows: readonly ChatDayRow[], options: DayMarkerOptions = {}): ChatDaySection[] {
  const sections: ChatDaySection[] = [];
  rows.forEach((row, index) => {
    const label = row.createdAt ? dayMarkerLabel(rows[index - 1]?.createdAt, row.createdAt, options) : null;
    if (label !== null) sections.push({ index, label });
    else if (index === 0) sections.push({ index, label: row.time ?? (options.t ?? currentText().t)("chat.day.now") });
  });
  return sections;
}
