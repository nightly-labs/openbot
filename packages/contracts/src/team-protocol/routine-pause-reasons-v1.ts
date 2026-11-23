import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const ROUTINE_PAUSE_REASONS_CAPABILITY = "routine-pause-reasons-v1";

export const ROUTINE_PAUSE_REASONS_ROUTES = {
  list: "/v1/routine-pause-reasons",
} as const;

const timestamp = string(80);
const reason = fields({ routineId: identifier, scheduledFor: timestamp });
const reasons = fields({ routines: list(reason, 10_000) });

export const ROUTINE_PAUSE_REASONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_PAUSE_REASONS_ROUTES.list, adminRoute(fields({ agentId: identifier }), reasons)],
]);

export interface RoutinePauseReasonEntry {
  routineId: string;
  scheduledFor: string;
}

export function decodeRoutinePauseReasons(value: unknown): RoutinePauseReasonEntry[] {
  const decoded = reasons(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid routine pause reasons.");
  return decoded.routines.map((entry) => {
    if (!isDynamicRecord(entry) || typeof entry.routineId !== "string" || typeof entry.scheduledFor !== "string")
      throw new Error("Invalid routine pause reason.");
    return { routineId: entry.routineId, scheduledFor: entry.scheduledFor };
  });
}
