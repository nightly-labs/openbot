import type { HourCycle } from "@openbot/contracts/ipc";
import { systemPreferences } from "electron";

/**
 * The clock of the macOS "24-hour time" setting (System Settings > General > Date & Time). macOS
 * writes these keys only when the setting differs from the region's own clock. Chromium's `Intl`
 * does not read them, so an English (US) Mac with a 24-hour clock still formats "2:30 PM".
 * Read at each call, so a window opened later follows a change.
 */
export function systemHourCycle(): HourCycle | undefined {
  if (process.platform !== "darwin") return undefined;
  if (systemPreferences.getUserDefault("AppleICUForce24HourTime", "boolean")) return "h23";
  if (systemPreferences.getUserDefault("AppleICUForce12HourTime", "boolean")) return "h12";
  return undefined;
}
