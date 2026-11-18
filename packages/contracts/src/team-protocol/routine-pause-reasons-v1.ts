// Frozen optional routine-pause-reasons-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a member reads which paused
// routines of an agent that the member can see were paused by one of their own scheduled runs, and the
// scheduled time of that run. A routine is in the list only while it stays paused and nothing changed
// it after that run. The list holds the routines that the released routine routes show the member:
// schedule routines, and, for an owner or admin, the webhook routines of `events-v1`. A `once` routine
// is not in it. The released routine routes and the `events-v1` routes do not carry the reason, so a
// client reads it here. The route changes nothing. A hidden agent, or an agent that the peer cannot see,
// is not found (404). The route is a POST with its ids in the body. Bounds and meaning do not follow IPC
// changes; widening any of it needs a second capability string.
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

/** A paused routine, and the scheduled time of its own run that paused it. */
export interface RoutinePauseReasonEntry {
  routineId: string;
  scheduledFor: string;
}

/** Decodes the answer of the list route. */
export function decodeRoutinePauseReasons(value: unknown): RoutinePauseReasonEntry[] {
  const decoded = reasons(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid routine pause reasons.");
  return decoded.routines.map((entry) => {
    if (!isDynamicRecord(entry) || typeof entry.routineId !== "string" || typeof entry.scheduledFor !== "string")
      throw new Error("Invalid routine pause reason.");
    return { routineId: entry.routineId, scheduledFor: entry.scheduledFor };
  });
}
