import { isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const ROUTINE_RUN_CHANGES_CAPABILITY = "routine-run-changes-v1";

export const ROUTINE_RUN_CHANGES_ROUTES = {
  list: "/v1/routine-run-changes",
  set: "/v1/routine-run-changes/set",
} as const;

const entry = fields({ routineId: identifier, runsChangeRoutines: boolean });
const entries = fields({ routines: list(entry, 10_000) });

export const ROUTINE_RUN_CHANGES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_RUN_CHANGES_ROUTES.list, adminRoute(fields({ agentId: identifier }), entries)],
  [
    ROUTINE_RUN_CHANGES_ROUTES.set,
    adminRoute(fields({ agentId: identifier, routineId: identifier, runsChangeRoutines: boolean }), entry),
  ],
]);

export interface RoutineRunChangesEntry {
  routineId: string;
  runsChangeRoutines: boolean;
}

export function decodeRoutineRunChanges(value: unknown): RoutineRunChangesEntry {
  const decoded = entry(value);
  if (
    !isDynamicRecord(decoded) ||
    typeof decoded.routineId !== "string" ||
    typeof decoded.runsChangeRoutines !== "boolean"
  )
    throw new Error("Invalid routine run changes.");
  return { routineId: decoded.routineId, runsChangeRoutines: decoded.runsChangeRoutines };
}

export function decodeRoutineRunChangesList(value: unknown): RoutineRunChangesEntry[] {
  const decoded = entries(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid routine run changes.");
  return decoded.routines.map(decodeRoutineRunChanges);
}
