// Row checks for the migrations, frozen like them, so a change to `@openbot/contracts/runtime-values`
// does not change a released migration. Their input is SQLite rows and `JSON.parse` values.

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
