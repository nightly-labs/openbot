/**
 * The time of a message and the local day it is in. The chat finds its day labels and its turn
 * times again on each streamed chunk, for each loaded message. A time does not change, and the
 * local date of a time is slow to find, so each `createdAt` is read once.
 */

const MAX_KEPT_TIMES = 4000;

interface KeptTime {
  at: number;
  /** Unset until a caller asks for the day, and after the time zone changes. */
  day: number | undefined;
}

const keptTimes = new Map<string, KeptTime>();
let keptTimeZoneOffset: number | null = null;

function keptTime(createdAt: string): KeptTime {
  let kept = keptTimes.get(createdAt);
  if (!kept) {
    if (keptTimes.size >= MAX_KEPT_TIMES) keptTimes.clear();
    kept = { at: Date.parse(createdAt), day: undefined };
    keptTimes.set(createdAt, kept);
  }
  return kept;
}

/** The first moment of the local day of `value`. */
export function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** `Date.parse(createdAt)`: NaN for a time that is not a date. */
export function messageTime(createdAt: string): number {
  return keptTime(createdAt).at;
}

/**
 * The start of the local day of a message, or NaN for a time that is not a date. `timeZoneOffset`
 * is `getTimezoneOffset()` of now: a change of the time zone gives each time another day.
 */
export function messageDay(createdAt: string, timeZoneOffset: number): number {
  if (keptTimeZoneOffset !== timeZoneOffset) {
    for (const kept of keptTimes.values()) kept.day = undefined;
    keptTimeZoneOffset = timeZoneOffset;
  }
  const kept = keptTime(createdAt);
  if (kept.day === undefined) kept.day = Number.isNaN(kept.at) ? Number.NaN : startOfDay(new Date(kept.at));
  return kept.day;
}
