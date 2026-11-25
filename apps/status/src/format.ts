import type { Stage, StatusState } from "./model";

export const STATE_LABELS: Record<StatusState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial: "Partial outage",
  major: "Major outage",
  maintenance: "Maintenance",
};

export const STAGE_LABELS: Record<Stage, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  update: "Update",
  resolved: "Resolved",
  scheduled: "Scheduled",
  completed: "Completed",
};

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const toDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

export const formatTime = (iso: string) => `${TIME_FORMAT.format(toDate(iso))} UTC`;
export const formatClock = (iso: string) => TIME_FORMAT.format(toDate(iso));
export const formatDay = (iso: string) => DAY_FORMAT.format(toDate(iso));
export const formatLongDay = (iso: string) => LONG_DAY_FORMAT.format(toDate(iso));
export const formatMonth = (iso: string) => MONTH_FORMAT.format(toDate(iso));
export const formatDayTime = (iso: string) => `${formatDay(iso)}, ${formatTime(iso)}`;

export const formatUptime = (percent: number | null) => {
  if (percent === null) return "No data";
  return `${Number(percent.toFixed(2))}%`;
};

export const formatMinutes = (minutes: number) => {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export const formatDuration = (fromIso: string, toIso: string) =>
  formatMinutes((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
