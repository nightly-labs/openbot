import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppMessages } from "@openbot/i18n";
import { currentText, type TextValue } from "../../text";

export interface RoutineSelectOption {
  value: string;
  label: string;
}

/** The translator and formats a routine label needs. It defaults to the app's interface language. */
export type RoutineText = Pick<TextValue, "t" | "format">;

const INTERVAL_SUMMARY = {
  minutes: "routine.summary.intervalMinutes",
  hours: "routine.summary.intervalHours",
  days: "routine.summary.intervalDays",
} as const satisfies Record<Extract<RoutineSchedule, { kind: "interval" }>["unit"], keyof AppMessages>;

/** A date on the weekday `day` (0 is Sunday), for a weekday name in the interface language. */
function weekdayDate(day: number): Date {
  // January 7, 2024 is a Sunday.
  return new Date(2024, 0, 7 + (((day % 7) + 7) % 7));
}

/** "Sunday", "Sun" or "S". */
export function routineWeekdayText(
  day: number,
  width: "long" | "short" | "narrow",
  text: RoutineText = currentText(),
): string {
  return text.format.date(weekdayDate(day), { weekday: width });
}

export function routineScheduleSummary(
  schedule: RoutineSchedule,
  sentence = false,
  text: RoutineText = currentText(),
): string {
  const { t } = text;
  switch (schedule.kind) {
    case "hourly":
      return t("routine.summary.hourly", { minute: String(schedule.minute).padStart(2, "0") });
    case "daily": {
      const time = formatRoutineClock(schedule.time, text);
      return sentence ? t("routine.summary.dailySentence", { time }) : t("routine.summary.daily", { time });
    }
    case "weekdays": {
      const time = formatRoutineClock(schedule.time, text);
      return sentence ? t("routine.summary.weekdaysSentence", { time }) : t("routine.summary.weekdays", { time });
    }
    case "weekly": {
      const params = {
        weekday: routineWeekdayText(schedule.weekday, "long", text),
        time: formatRoutineClock(schedule.time, text),
      };
      return sentence ? t("routine.summary.weeklySentence", params) : t("routine.summary.weekly", params);
    }
    case "monthly": {
      const params = { day: schedule.day, time: formatRoutineClock(schedule.time, text) };
      return sentence ? t("routine.summary.monthlySentence", params) : t("routine.summary.monthly", params);
    }
    case "interval":
      return t(INTERVAL_SUMMARY[schedule.unit], { amount: schedule.amount });
    case "advanced":
      return t("routine.summary.advanced");
    case "custom":
      return t("routine.summary.cron", { expression: schedule.expression });
  }
}

/** "9:00 AM". */
export function formatRoutineClock(value: string, text: RoutineText = currentText()): string {
  const [hourText = "0", minuteText = "0"] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return routineClockText(`${hour % 12 || 12}:${String(minute).padStart(2, "0")}`, hour >= 12, text);
}

/** `time` ("9" or "9:30") with its half of the day. */
export function routineClockText(time: string, pm: boolean, text: RoutineText = currentText()): string {
  const meridiem = pm ? text.t("routine.clock.pm") : text.t("routine.clock.am");
  return text.t("routine.clock.withMeridiem", { time, meridiem });
}

export function routineTimeMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}
