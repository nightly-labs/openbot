// Frozen optional routine-runs-quiet-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a member reads which runs of
// the routines of an agent that the member can see ended with nothing to report. The client sends the
// ids of the runs that its chat shows, and the host answers the ids of the quiet ones among them. A run
// of an other agent, a channel routine run, or an id that the host does not know is not in the answer.
// The released run routes do not carry this. A hidden agent, or an agent that the peer cannot see, is
// not found (404). The route is a POST with its ids in the body. Bounds and meaning do not follow IPC
// changes; widening any of it needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const ROUTINE_RUNS_QUIET_CAPABILITY = "routine-runs-quiet-v1";

export const ROUTINE_RUNS_QUIET_ROUTES = {
  list: "/v1/routine-runs-quiet",
} as const;

/** The most run ids that one request asks about. */
export const ROUTINE_RUNS_QUIET_LIMIT = 100;

const runIds = list(identifier, ROUTINE_RUNS_QUIET_LIMIT);
const response = fields({ runIds });

export const ROUTINE_RUNS_QUIET_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_RUNS_QUIET_ROUTES.list, adminRoute(fields({ agentId: identifier, runIds }), response)],
]);

/** Decodes the answer of the list route: the ids of the quiet runs. */
export function decodeQuietRoutineRunIds(value: unknown): string[] {
  const decoded = response(value);
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.runIds)) throw new Error("Invalid quiet routine runs.");
  return decoded.runIds.filter(isString);
}
