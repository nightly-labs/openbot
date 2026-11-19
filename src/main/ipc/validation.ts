import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export function requireString(value: unknown, field: string, maxLength: number = INPUT_LIMITS.identifier): string {
  if (!isString(value) || !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > maxLength) throw new Error(`${field} is too long.`);
  return value;
}

export function stringPayload(field: string, maxLength: number = INPUT_LIMITS.identifier): (value: unknown) => string {
  return (value) => requireString(value, field, maxLength);
}

export function optionalPayload<Payload>(decode: (value: unknown) => Payload): (value: unknown) => Payload | undefined {
  return (value) => (value === undefined ? undefined : decode(value));
}

export function nullishPayload<Payload>(decode: (value: unknown) => Payload): (value: unknown) => Payload | undefined {
  return (value) => (value === null || value === undefined ? undefined : decode(value));
}

export function isObject(value: unknown): value is DynamicRecord {
  return isDynamicRecord(value);
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (!isBoolean(value)) throw new Error(`${field} must be a boolean.`);
  return value;
}
