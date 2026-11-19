import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const ROUTINE_FLOW_STOP_CAPABILITY = "routine-flow-stop-v1";

export const ROUTINE_FLOW_STOP_ROUTES = {
  stopRun: "/v1/routine-flows/runs/stop",
} as const;

export const ROUTINE_FLOW_STOP_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_FLOW_STOP_ROUTES.stopRun, adminRoute(fields({ routineId: identifier, runId: identifier }), empty)],
]);
