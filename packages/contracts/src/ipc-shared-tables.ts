import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/**
 * One table an agent created in the shared database.
 *
 * There is no `agentId` on this shape on purpose: every agent can read and write every shared
 * table, and `ownerAgentId` only records who created it -- the one thing it decides is which agent
 * may remove it. It is `null` for a table the user made by hand, which nobody owns.
 */
export interface SharedTable {
  name: string;
  ownerAgentId: string | null;
  /** `null` when the table held too many rows to count inside the statement deadline. */
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
