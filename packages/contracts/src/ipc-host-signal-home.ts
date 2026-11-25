import { isDynamicRecord, isString } from "./runtime-values";

export interface HostSignalHome {
  id: string;
  latencyMs: number | null;
}

export interface HostSignalHomeSettings {
  preferred: string | null;
  current: string | null;
  homes: HostSignalHome[];
}

export const SIGNAL_HOME_LIST_LIMIT = 32;

const SIGNAL_HOME_ID_PATTERN = /^[a-z0-9-]{1,32}$/u;

export function isSignalHomeId(value: unknown): value is string {
  return isString(value) && SIGNAL_HOME_ID_PATTERN.test(value);
}

export function parseSignalHomeChoice(value: unknown): string | null {
  if (value === null) return null;
  if (!isSignalHomeId(value)) throw new Error("Invalid Signal server.");
  return value;
}

function isLatency(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function decodeHostSignalHome(value: unknown): HostSignalHome {
  if (!isDynamicRecord(value) || !isSignalHomeId(value.id) || !isLatency(value.latencyMs))
    throw new Error("Invalid Signal server.");
  return { id: value.id, latencyMs: value.latencyMs };
}

export function decodeHostSignalHomeSettings(value: unknown): HostSignalHomeSettings {
  if (
    !isDynamicRecord(value) ||
    (value.preferred !== null && !isSignalHomeId(value.preferred)) ||
    (value.current !== null && !isSignalHomeId(value.current)) ||
    !Array.isArray(value.homes) ||
    value.homes.length > SIGNAL_HOME_LIST_LIMIT
  ) {
    throw new Error("Invalid Signal server settings.");
  }
  return { preferred: value.preferred, current: value.current, homes: value.homes.map(decodeHostSignalHome) };
}
