import type { MobileText } from "@/shared/lib/text";

export function playbackTime(seconds: number, format: MobileText["format"]) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = format.number(total % 60, { minimumIntegerDigits: 2 });
  return hours > 0
    ? `${format.number(hours)}:${format.number(minutes, { minimumIntegerDigits: 2 })}:${rest}`
    : `${format.number(minutes)}:${rest}`;
}
