import type { AppFormat } from "@openbot/i18n";
import { currentText } from "../../text";
import { dayAndTimeLabel, timeLabel } from "./chat-day-markers";

/**
 * A time in a transcript: the time alone today, else the day and time in the form of the day
 * separators. `format` defaults to the app's interface language, for a caller outside a component.
 */
export function formatChatTimestamp(date: Date, format: AppFormat = currentText().format): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return isToday ? timeLabel(date, { now, format }) : dayAndTimeLabel(date, { now, format });
}
