import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { UnknownStoredValueError } from "./database-rows";

const logger = createOpenBotLogger("database");

/** The `<table>.<column>` pairs that this process has already warned about, so a list read does not flood the log. */
const warned = new Set<string>();

/**
 * Decodes each row of a list. A row with an enum value that this build does not know (an older
 * release reads data that a newer one wrote) is left out, with one warning for each table and column,
 * so the other rows still load and the start continues. The row stays in the database unchanged.
 * Every other decode error still throws.
 *
 * Use it for reads that show or schedule many rows. A read of one row by its id keeps the strict
 * decode: it fails only that action, and it stops a write path from acting on a row it cannot read.
 */
export function readableRows<T>(rows: readonly DynamicRecord[], decode: (row: DynamicRecord) => T, table: string): T[] {
  const decoded: T[] = [];
  for (const row of rows) {
    const value = readableRow(row, decode, table);
    if (value !== undefined) decoded.push(value);
  }
  return decoded;
}

/** One row of a list: undefined when it holds an enum value that this build does not know. */
export function readableRow<T>(row: DynamicRecord, decode: (row: DynamicRecord) => T, table: string): T | undefined {
  try {
    return decode(row);
  } catch (error) {
    if (!(error instanceof UnknownStoredValueError)) throw error;
    const key = `${table}.${error.column}`;
    if (!warned.has(key)) {
      warned.add(key);
      logger.warn("Rows with a value that this version does not know were left out:", key);
    }
    return undefined;
  }
}
