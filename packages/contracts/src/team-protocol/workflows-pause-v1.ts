import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { workflowSummaryCodec } from "./workflows-v1";

export const WORKFLOWS_PAUSE_CAPABILITY = "workflows-pause-v1";

export const WORKFLOWS_PAUSE_ROUTES = {
  pause: "/v1/workflows/pause",
} as const;

export const WORKFLOWS_PAUSE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_PAUSE_ROUTES.pause, adminRoute(fields({ workflowId: identifier, paused: boolean }), workflowSummaryCodec)],
]);
