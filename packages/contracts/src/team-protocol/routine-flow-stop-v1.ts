// Frozen optional routine-flow-stop-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who may change a
// routine on `routine-flows-v1` (the routine and every agent it touches are visible to the member,
// with manage access to each) can stop a run of that routine that has not ended. The host cancels the
// run's queued work, stops the turn that works on it, also in the routine's own side thread, and
// records the run as cancelled; the agents after it in the flow do not start. A run that has ended
// stays as it is. Only the routine id and the run id cross the wire, and the response is empty.
// Widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const ROUTINE_FLOW_STOP_CAPABILITY = "routine-flow-stop-v1";

export const ROUTINE_FLOW_STOP_ROUTES = {
  stopRun: "/v1/routine-flows/runs/stop",
} as const;

export const ROUTINE_FLOW_STOP_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_FLOW_STOP_ROUTES.stopRun, adminRoute(fields({ routineId: identifier, runId: identifier }), empty)],
]);
