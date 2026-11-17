import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { databaseRows, UnknownStoredValueError } from "./database-rows";

const logger = createOpenBotLogger("database");

/** `<table>.<column>` pairs already logged, so a list read does not flood the log. */
const warned = new Set<string>();

/**
 * Decodes a list of SQLite rows. A row with an enum value that this build does not know is left out
 * and stays unchanged in the database; other decode errors still throw. A read of one row by id
 * stays strict, so a write never acts on a row that it cannot read.
 */
export function readableRows<T>(rows: unknown, decode: (row: DynamicRecord) => T, table: string): T[] {
  return databaseRows(rows).flatMap((row) => {
    const value = readableRow(row, decode, table);
    return value === undefined ? [] : [value];
  });
}

/** One row: undefined when it has an enum value that this build does not know. */
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
