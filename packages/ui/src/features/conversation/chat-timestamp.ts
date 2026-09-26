import type { AppFormat } from "@openbot/i18n";
import { currentText } from "../../text";

/** `format` defaults to the app's interface language, for a caller outside a component. */
export function formatChatTimestamp(date: Date, format: AppFormat = currentText().format): string {
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return format.date(
    date,
    isToday ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" },
  );
}
