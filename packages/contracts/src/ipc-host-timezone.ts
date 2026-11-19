import { isDynamicRecord, isString } from "./runtime-values";

export interface HostTimezoneSettings {
  timezone: string | null;
  systemTimezone: string;
}

export function decodeHostTimezoneSettings(value: unknown): HostTimezoneSettings {
  if (
    !isDynamicRecord(value) ||
    (value.timezone !== null && !isString(value.timezone)) ||
    !isString(value.systemTimezone)
  ) {
    throw new Error("Invalid server timezone.");
  }
  return { timezone: value.timezone, systemTimezone: value.systemTimezone };
}
