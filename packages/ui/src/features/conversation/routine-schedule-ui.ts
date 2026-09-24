import type { RoutineSchedule } from "@openbot/contracts/ipc";

export interface RoutineSelectOption {
  value: string;
  label: string;
}

export const ROUTINE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function routineScheduleSummary(schedule: RoutineSchedule, sentence = false): string {
  const prefix = sentence ? "On " : "";
  switch (schedule.kind) {
    case "hourly":
      return `Every hour at :${String(schedule.minute).padStart(2, "0")}`;
    case "daily":
      return `${sentence ? "On every" : "Every"} day at ${formatRoutineClock(schedule.time)}`;
    case "weekdays":
      return `${sentence ? "On weekdays" : "Weekdays"} at ${formatRoutineClock(schedule.time)}`;
    case "weekly":
      return `${prefix}${ROUTINE_WEEKDAYS[schedule.weekday]} at ${formatRoutineClock(schedule.time)}`;
    case "monthly":
      return `${prefix}day ${schedule.day} of every month at ${formatRoutineClock(schedule.time)}`;
    case "interval":
      return `Every ${schedule.amount} ${schedule.unit}`;
    case "advanced":
      return "Advanced schedule";
    case "custom":
      return `Cron ${schedule.expression}`;
  }
}

export function formatRoutineClock(value: string): string {
  const [hourText = "0", minuteText = "0"] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function routineTimeMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}
