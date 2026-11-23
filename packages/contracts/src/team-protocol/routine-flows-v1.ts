import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { routineTrigger } from "./events-v1";

export const ROUTINE_FLOWS_CAPABILITY = "routine-flows-v1";

export const ROUTINE_FLOWS_ROUTES = {
  canvas: "/v1/routine-flows/canvas",
  savePosition: "/v1/routine-flows/positions/save",
  removePosition: "/v1/routine-flows/positions/remove",
  connect: "/v1/routine-flows/links/connect",
  disconnect: "/v1/routine-flows/links/disconnect",
  updateLink: "/v1/routine-flows/links/update",
} as const;

export const ROUTINE_FLOW_STEP_TEXT_LIMIT = 4_000;

export type RoutineFlowsEvent = { type: "routine-flows-changed"; agentId: string };

export function routineFlowsEvent(value: unknown): RoutineFlowsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "routine-flows-changed") return null;
  if (!isString(value.agentId) || !value.agentId.length || value.agentId.length > 128) {
    throw new Error("Invalid routine flows event.");
  }
  return { type: "routine-flows-changed", agentId: value.agentId };
}

const timestamp = string(64);
const instruction = string(100_000);
const stepText = string(ROUTINE_FLOW_STEP_TEXT_LIMIT);
const coordinate: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error("Invalid routine flow coordinate.");
  }
  return value;
};
const nodeKey: AdminDecoder = (value) => {
  if (!isString(value) || !/^(agent|routine):[^:]{1,128}$/u.test(value)) throw new Error("Invalid routine flow node.");
  return value;
};
const link = fields({
  id: identifier,
  routineId: identifier,
  fromAgentId: identifier,
  toAgentId: identifier,
  instruction,
  createdAt: timestamp,
});
const step = fields({
  id: identifier,
  runId: identifier,
  agentId: identifier,
  deliveryId: nullable(identifier),
  input: stepText,
  output: nullable(stepText),
  status: oneOf("running", "succeeded", "failed", "skipped", "cancelled"),
  error: nullable(stepText),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const run = fields({
  id: identifier,
  routineId: identifier,
  triggerId: nullable(identifier),
  kind: oneOf("scheduled", "manual"),
  scheduledFor: timestamp,
  routineName: string(256),
  instruction,
  status: oneOf("queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"),
  error: nullable(string(100_000)),
  createdAt: timestamp,
  updatedAt: timestamp,
  agentId: identifier,
  deliveryId: nullable(identifier),
});
const routineInfo = fields(
  {
    id: identifier,
    agentId: identifier,
    name: string(256),
    instruction,
    active: boolean,
    timezone: string(128),
    trigger: routineTrigger,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { limitPolicy: oneOf("wait", "skip") },
);
const canvas = fields({
  agentId: identifier,
  routines: list(
    fields({
      routine: routineInfo,
      recentRuns: list(run, 50),
      upcomingRuns: list(timestamp, 400),
      steps: list(step, 1_000),
    }),
    1_000,
  ),
  links: list(link, 10_000),
  positions: list(fields({ nodeKey, x: coordinate, y: coordinate }), 10_000),
  placedAgentIds: list(identifier, 10_000),
});

export const ROUTINE_FLOWS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_FLOWS_ROUTES.canvas, adminRoute(fields({ agentId: identifier }), canvas)],
  [
    ROUTINE_FLOWS_ROUTES.savePosition,
    adminRoute(fields({ agentId: identifier, nodeKey, x: coordinate, y: coordinate }), empty),
  ],
  [ROUTINE_FLOWS_ROUTES.removePosition, adminRoute(fields({ agentId: identifier, nodeKey }), empty)],
  [
    ROUTINE_FLOWS_ROUTES.connect,
    adminRoute(
      fields({ routineId: identifier, fromAgentId: identifier, toAgentId: identifier }, { instruction }),
      link,
    ),
  ],
  [ROUTINE_FLOWS_ROUTES.disconnect, adminRoute(fields({ linkId: identifier }), empty)],
  [ROUTINE_FLOWS_ROUTES.updateLink, adminRoute(fields({ linkId: identifier, instruction }), link)],
]);
