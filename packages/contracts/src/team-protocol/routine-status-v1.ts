import { isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, fields, identifier, list, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const ROUTINE_STATUS_CAPABILITY = "routine-status-v1";
export const ROUTINE_STATUS_ROUTES = {
  list: "/v1/routine-status",
  set: "/v1/routine-status/set",
} as const;

const owner = fields({ kind: oneOf("agent", "channel"), id: identifier });
const entry = fields({ routineId: identifier, silent: boolean });
const entries = fields({ routines: list(entry, 10_000) });

export const ROUTINE_STATUS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_STATUS_ROUTES.list, adminRoute(fields({ owner }), entries)],
  [ROUTINE_STATUS_ROUTES.set, adminRoute(fields({ owner, routineId: identifier, silent: boolean }), entry)],
]);

export interface RoutineStatusEntry {
  routineId: string;
  silent: boolean;
}

export function decodeRoutineStatus(value: unknown): RoutineStatusEntry {
  const decoded = entry(value);
  if (!isDynamicRecord(decoded) || typeof decoded.routineId !== "string" || typeof decoded.silent !== "boolean")
    throw new Error("Invalid routine status preference.");
  return { routineId: decoded.routineId, silent: decoded.silent };
}

export function decodeRoutineStatuses(value: unknown): RoutineStatusEntry[] {
  const decoded = entries(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines))
    throw new Error("Invalid routine status preferences.");
  return decoded.routines.map(decodeRoutineStatus);
}
