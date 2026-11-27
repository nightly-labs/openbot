import type { AppFormat, MobileTranslate } from "@openbot/i18n/mobile";
import { messageDay, startOfDay } from "./message-time";

const DAY_MS = 86_400_000;
const TIME = { hour: "numeric", minute: "2-digit" } as const;
const DATE = { weekday: "short", month: "short", day: "numeric" } as const;

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
    const day = messageDay(row.createdAt, timeZoneOffset);
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
