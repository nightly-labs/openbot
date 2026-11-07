// Frozen optional routine-run-place-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a member reads where each
// routine of an agent that the member can see runs, the agent's chat (`chat`) or the routine's own
// thread (`thread`), and sets it for one routine with manage access to the agent, as on the released
// routine routes. A member sees the routines that the released routes show the member: the schedule
// routines of those routes, and, for an owner or admin, the webhook routines of `events-v1`. A `once`
// routine is not in the lists, as on those routes. A set changes only the place, and the
// runs that start after it use the new place. The released routine routes and the `events-v1` and
// `routine-recovery-v1` routes do not carry the place, so a client sends it here after it saves a
// routine through them. A hidden agent, or an agent that the peer cannot see, is not found (404); a
// routine that the agent does not have is gone (404). Every route is a POST with its ids in the body.
// Bounds and meaning do not follow IPC changes; widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, list, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const ROUTINE_RUN_PLACE_CAPABILITY = "routine-run-place-v1";

export const ROUTINE_RUN_PLACE_ROUTES = {
  list: "/v1/routine-run-places",
  set: "/v1/routine-run-places/set",
} as const;

const runIn = oneOf("chat", "thread");
const place = fields({ routineId: identifier, runIn });
const places = fields({ routines: list(place, 10_000) });

export const ROUTINE_RUN_PLACE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_RUN_PLACE_ROUTES.list, adminRoute(fields({ agentId: identifier }), places)],
  [ROUTINE_RUN_PLACE_ROUTES.set, adminRoute(fields({ agentId: identifier, routineId: identifier, runIn }), place)],
]);

/** Where one routine runs. */
export interface RoutineRunPlaceEntry {
  routineId: string;
  runIn: "chat" | "thread";
}

/** Decodes the answer of the set route, and each entry of the list route. */
export function decodeRoutineRunPlace(value: unknown): RoutineRunPlaceEntry {
  const decoded = place(value);
  if (!isDynamicRecord(decoded) || typeof decoded.routineId !== "string") throw new Error("Invalid routine run place.");
  return { routineId: decoded.routineId, runIn: decoded.runIn === "thread" ? "thread" : "chat" };
}

/** Decodes the answer of the list route. */
export function decodeRoutineRunPlaces(value: unknown): RoutineRunPlaceEntry[] {
  const decoded = places(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid routine run places.");
  return decoded.routines.map(decodeRoutineRunPlace);
}
