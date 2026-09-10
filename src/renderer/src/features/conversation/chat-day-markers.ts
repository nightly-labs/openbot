/*
 * The separator a transcript draws when the messages under it fall on a later day than the messages
 * above it. Both the agent chat and the channel chat use it, so the rule that decides when a
 * separator appears is here, away from either timeline, and is a pure function of two timestamps.
 */

/** The clock a caller can replace, so a test does not depend on the day the test runs. */
export interface DayMarkerOptions {
  now?: Date;
  locale?: string;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dayDifference(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

function timeOf(value: Date, locale?: string): string {
  return value.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
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
  const time = timeOf(current, options.locale);
  if (age === 0) return `Today ${time}`;
  if (age === 1) return `Yesterday ${time}`;
  const date = current.toLocaleDateString(options.locale, { weekday: "short", month: "short", day: "numeric" });
  return `${date} ${time}`;
}
