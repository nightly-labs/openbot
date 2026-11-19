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

export interface RoutineRunPlaceEntry {
  routineId: string;
  runIn: "chat" | "thread";
}

export function decodeRoutineRunPlace(value: unknown): RoutineRunPlaceEntry {
  const decoded = place(value);
  if (!isDynamicRecord(decoded) || typeof decoded.routineId !== "string") throw new Error("Invalid routine run place.");
  return { routineId: decoded.routineId, runIn: decoded.runIn === "thread" ? "thread" : "chat" };
}

export function decodeRoutineRunPlaces(value: unknown): RoutineRunPlaceEntry[] {
  const decoded = places(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.routines)) throw new Error("Invalid routine run places.");
  return decoded.routines.map(decodeRoutineRunPlace);
}
