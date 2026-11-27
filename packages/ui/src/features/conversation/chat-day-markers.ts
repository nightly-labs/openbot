import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";

export interface DayMarkerOptions {
  now?: Date;
  locale?: string;
  t?: AppTranslate;
  format?: AppFormat;
  gapMs?: number;
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

export function dayMarkerLabel(
  previousIso: string | undefined,
  currentIso: string,
  options: DayMarkerOptions = {},
): string | null {
  const current = new Date(currentIso);
  if (Number.isNaN(current.getTime())) return null;
  if (previousIso !== undefined) {
    const previous = new Date(previousIso);
    const sameDay = !Number.isNaN(previous.getTime()) && dayDifference(previous, current) === 0;
    const longGap = options.gapMs !== undefined && current.getTime() - previous.getTime() >= options.gapMs;
    if (sameDay && !longGap) return null;
  }
  const now = options.now ?? new Date();
  const age = dayDifference(current, now);
  const t = options.t ?? currentText().t;
  const time = timeOf(current, options);
  if (age === 0) return t("chat.day.today", { time });
  if (age === 1) return t("chat.day.yesterday", { time });
  return t("chat.day.date", { date: dateOf(current, options), time });
}
