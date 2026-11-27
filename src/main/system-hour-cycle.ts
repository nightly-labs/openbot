import type { HourCycle } from "@openbot/contracts/ipc";
import { systemPreferences } from "electron";

export function systemHourCycle(): HourCycle | undefined {
  if (process.platform !== "darwin") return undefined;
  if (systemPreferences.getUserDefault("AppleICUForce24HourTime", "boolean")) return "h23";
  if (systemPreferences.getUserDefault("AppleICUForce12HourTime", "boolean")) return "h12";
  return undefined;
}
