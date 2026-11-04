import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";

/**
 * The separators of the chat, as on desktop (`packages/ui/src/features/conversation/chat-day-markers.ts`):
 * the first message of the chat and the first message of each later day get a label with their day
 * and time. Rows without a time, such as markers, get none and do not end a day.
 */

const DAY_MS = 86_400_000;
const TIME = { hour: "numeric", minute: "2-digit" } as const;
const DATE = { weekday: "short", month: "short", day: "numeric" } as const;

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** The label of each message that opens a day, by message ID. One pass over the loaded rows. */
export function chatDayLabels(
  rows: readonly { id: string; createdAt?: string }[],
  text: { t: MobileTranslate; format: AppFormat },
  now: Date = new Date(),
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const today = startOfDay(now);
  let previousDay: number | undefined;
  for (const row of rows) {
    if (!row.createdAt) continue;
    const created = new Date(row.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const day = startOfDay(created);
    if (day === previousDay) continue;
    previousDay = day;
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
