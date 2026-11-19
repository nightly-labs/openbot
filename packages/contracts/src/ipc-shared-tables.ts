import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export interface SharedTable {
  name: string;
  ownerAgentId: string | null;
  rowCount: number | null;
}

export interface DeleteSharedTableInput {
  name: string;
}

export function isSharedTable(value: unknown): value is SharedTable {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.sharedTableName) &&
    value.name.length > 0 &&
    isNullableBoundedString(value.ownerAgentId, INPUT_LIMITS.identifier) &&
    (value.rowCount === null || isFiniteNumber(value.rowCount))
  );
}

export function isDeleteSharedTableInput(value: unknown): value is DeleteSharedTableInput {
  return isDynamicRecord(value) && isBoundedString(value.name, INPUT_LIMITS.sharedTableName) && value.name.length > 0;
}
