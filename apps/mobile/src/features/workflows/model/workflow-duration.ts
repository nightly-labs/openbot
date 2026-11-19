import type { MobileTranslate } from "@openbot/i18n/mobile";

export function formatRunDuration(startedAt: string, endedAt: string | null, t: MobileTranslate): string | null {
  if (!endedAt) return null;
  const total = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(total) || total < 0) return null;
  if (total < 60) return t("mobile.workflow.duration.seconds", { seconds: total });
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return t("mobile.workflow.duration.minutes", { minutes, seconds: total % 60 });
  return t("mobile.workflow.duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
