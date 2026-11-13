import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";

/**
 * The separators of the chat, as on desktop (`packages/ui/src/features/conversation/chat-day-markers.ts`):
 * the first message of the chat and the first message of each later day get a label with their day
 * and time. Rows without a time, such as markers, get none and do not end a day. While older
 * messages are not loaded, the first loaded row gets no label: the older page can be of the same
 * day, and the label would leave that row and move the rows below it while the reader scrolls up.
 */

const DAY_MS = 86_400_000;
const TIME = { hour: "numeric", minute: "2-digit" } as const;
const DATE = { weekday: "short", month: "short", day: "numeric" } as const;

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

const MAX_KEPT_DAYS = 4000;
/** The start of the day of each time that a row had, or NaN for a time that is not a date. */
const keptDays = new Map<string, number>();
let keptTimeZoneOffset: number | null = null;

/**
 * The start of the day of a row. The labels are found again on each streamed chunk, for each loaded
 * row, and the local date of a time is slow to find, so each time is read once. A change of the time
 * zone gives each time another day.
 */
function dayOf(createdAt: string, timeZoneOffset: number): number {
  if (keptTimeZoneOffset !== timeZoneOffset || keptDays.size >= MAX_KEPT_DAYS) {
    keptDays.clear();
    keptTimeZoneOffset = timeZoneOffset;
  }
  let day = keptDays.get(createdAt);
  if (day === undefined) {
    const created = new Date(createdAt);
    day = Number.isNaN(created.getTime()) ? Number.NaN : startOfDay(created);
    keptDays.set(createdAt, day);
  }
  return day;
}

/** The label of each message that opens a day, by message ID. One pass over the loaded rows. */
export function chatDayLabels(
  rows: readonly { id: string; createdAt?: string }[],
  text: { t: MobileTranslate; format: AppFormat },
  { hasOlder = false, now = new Date() }: { hasOlder?: boolean; now?: Date } = {},
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const today = startOfDay(now);
  const timeZoneOffset = now.getTimezoneOffset();
  let previousDay: number | undefined;
  let skipFirst = hasOlder;
  for (const row of rows) {
    if (!row.createdAt) continue;
    const day = dayOf(row.createdAt, timeZoneOffset);
    if (Number.isNaN(day) || day === previousDay) continue;
    previousDay = day;
    if (skipFirst) {
      skipFirst = false;
      continue;
    }
    const created = new Date(row.createdAt);
    const time = text.format.date(created, TIME);
    const age = Math.round((today - day) / DAY_MS);
    labels.set(
      row.id,
      age === 0
        ? text.t("mobile.chat.day.today", { time })
        : age === 1
          ? text.t("mobile.chat.day.yesterday", { time })
          : text.t("mobile.chat.day.date", { date: text.format.date(created, DATE), time }),
    );
  }
  return labels;
}
