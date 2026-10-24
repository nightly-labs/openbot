import { DeviceToolError } from "./device-tool-error";

/** The host asks for at most this span of calendar events. The decoder checks the shape only. */
export const MAX_EVENT_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * A date or date-time of the contract. A date without a time is local midnight, not UTC midnight, so
 * an all-day event covers the day of the user. A date-time without an offset is local time.
 */
export function parseDeviceDate(value: string): Date {
  const parts = DATE_ONLY.exec(value);
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(value);
  if (Number.isNaN(date.getTime()) || (parts && date.getMonth() !== Number(parts[2]) - 1)) {
    throw new DeviceToolError("invalid_arguments");
  }
  return date;
}

export function deviceIso(value: string | Date): string {
  return new Date(value).toISOString();
}

/** Keeps a text inside the bound of the contract. */
export function clip(value: string | null | undefined, maximum: number): string {
  return (value ?? "").slice(0, maximum);
}

export function requireText(value: string): string {
  if (!value.trim()) throw new DeviceToolError("invalid_arguments");
  return value;
}
