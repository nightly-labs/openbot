export interface DynamicRecord {
  readonly [key: string]: unknown;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isDynamicRecord(value: unknown): value is DynamicRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
