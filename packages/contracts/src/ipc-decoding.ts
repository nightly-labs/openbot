import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export function decodeRecord(value: unknown, label: string): DynamicRecord {
  if (!isDynamicRecord(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function requiredString(record: DynamicRecord, field: string): string {
  const value = record[field];
  if (!isString(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

export function requiredNumber(record: DynamicRecord, field: string): number {
  const value = record[field];
  if (!isNumber(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

export function requiredBoolean(record: DynamicRecord, field: string): boolean {
  const value = record[field];
  if (!isBoolean(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

export function nullableBoolean(record: DynamicRecord, field: string): boolean | null {
  const value = record[field];
  if (value === null || isBoolean(value)) return value;
  throw new Error(`Invalid ${field}.`);
}

export function nullableString(record: DynamicRecord, field: string): string | null {
  const value = record[field];
  if (value === null || isString(value)) return value;
  throw new Error(`Invalid ${field}.`);
}

export function nullableNumber(record: DynamicRecord, field: string): number | null {
  const value = record[field];
  if (value === null || isNumber(value)) return value;
  throw new Error(`Invalid ${field}.`);
}

export function optionalHistoryExtent(record: DynamicRecord): { olderCount?: number; oldestAt?: string } {
  const { olderCount, oldestAt } = record;
  if (olderCount !== undefined && !(isNumber(olderCount) && Number.isSafeInteger(olderCount) && olderCount >= 0)) {
    throw new Error("Invalid olderCount.");
  }
  if (oldestAt !== undefined && !isString(oldestAt)) throw new Error("Invalid oldestAt.");
  return {
    ...(olderCount === undefined ? {} : { olderCount }),
    ...(oldestAt === undefined ? {} : { oldestAt }),
  };
}

export function decodeList<T>(value: unknown, label: string, decodeItem: (item: DynamicRecord) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value.map((item) => decodeItem(decodeRecord(item, label)));
}

export function guardedDecoder<T>(guard: (value: unknown) => value is T, label: string): (value: unknown) => T {
  return (value) => {
    if (!guard(value)) throw new Error(`Invalid ${label}.`);
    return value;
  };
}

export function guardedListDecoder<T>(guard: (value: unknown) => value is T, label: string): (value: unknown) => T[] {
  return (value) => {
    if (!Array.isArray(value) || !value.every(guard)) throw new Error(`Invalid ${label}.`);
    return value;
  };
}

export function emptyDecoder(message: string): (value: unknown) => undefined {
  return (value) => {
    if (value !== undefined && value !== null) throw new Error(message);
    return undefined;
  };
}
