import type { AppFormat } from "@openbot/i18n/mobile";
import { currentText } from "@/shared/lib/text";

export function formatUpdatedAt(value: string | null, format: AppFormat = currentText().format): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return format.date(date, { hour: "2-digit", minute: "2-digit" });
  }
  // "Mar 4" is ambiguous when the list holds a message from this year and one from last year, so
  // the year is shown whenever it is not the current one.
  return date.getFullYear() === today.getFullYear()
    ? format.date(date, { month: "short", day: "numeric" })
    : format.date(date, { month: "short", day: "numeric", year: "numeric" });
}
