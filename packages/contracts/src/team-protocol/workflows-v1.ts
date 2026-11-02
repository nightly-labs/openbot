// Frozen optional workflows-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a member of a server reads
// the workflows whose agent steps name only agents that the member can see, and whose model steps
// name only providers that the member's protocol shows; an owner or admin also reads one that names
// an agent that no longer exists, so they can fix or delete it. Any other workflow answers as
// missing, and so do its runs, steps and versions. A run, a single step, a stop, a retry or a
// decision needs the chat level for each agent that the workflow names, because a run sends tasks to
// them. A change, a delete or a restore needs the manage level for each agent that the workflow
// names, before and after the change. A workflow that names no agent, such as one with only model
// and condition steps, needs no agent level: each member who reads it can change and run it on the
// host's providers, by product decision. Only an owner or admin can add an output that posts to a
// messaging place or change its place, as routine results need the admin role; a member can run one
// that is there. A step of an agent that is hidden now does not cross, as no object that names a
// hidden agent does. A webhook trigger's URL goes only to an owner or admin; a member reads it as
// null, as `events-v1` keeps it behind the admin role, and only an owner or admin can make a new
// webhook secret. Step output and error cross with at most 32,000 characters each, and the host
// empties the step texts of the oldest runs first when a page of runs would not fit one WebRTC
// frame. A node's fields cross as an open record of texts, numbers and switches, so a node kind that
// does not run yet keeps its settings. Node kinds, port types, statuses, run sources, trigger types
// and version kinds cross as open names, so a newer host can add one; a client shows a workflow with
// a node kind or a port type that it does not know as read-only. The optional event
// `workflows-changed` names only the workflow that changed, so the client reads it again. Widening
// any other part needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { routineSchedule, routineTime } from "./events-v1";
import type { TeamProtocolV2Json } from "./v2";

export const WORKFLOWS_CAPABILITY = "workflows-v1";

export const WORKFLOWS_ROUTES = {
  list: "/v1/workflows/list",
  get: "/v1/workflows/get",
  create: "/v1/workflows/create",
  rename: "/v1/workflows/rename",
  delete: "/v1/workflows/delete",
  saveGraph: "/v1/workflows/save-graph",
  versions: "/v1/workflows/versions",
  versionGraph: "/v1/workflows/version-graph",
  restoreVersion: "/v1/workflows/restore-version",
  startRun: "/v1/workflows/start-run",
  runStep: "/v1/workflows/run-step",
  stopStep: "/v1/workflows/stop-step",
  stopRun: "/v1/workflows/stop-run",
  retryStep: "/v1/workflows/retry-step",
  decide: "/v1/workflows/decide",
  runs: "/v1/workflows/runs",
  run: "/v1/workflows/run",
  rotateWebhookSecret: "/v1/workflows/rotate-webhook-secret",
} as const;

/** The longest step output, step error or run error that crosses. */
export const WORKFLOW_STEP_TEXT_LIMIT = 32_000;
/** The most steps of one run that cross; the host sends the newest. */
export const WORKFLOW_RUN_STEP_LIMIT = 2_000;

export type WorkflowsEvent = { type: "workflows-changed"; workflowId: string };

/** The workflows event in `value`, or null for any other event. A malformed one throws. */
export function workflowsEvent(value: unknown): WorkflowsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "workflows-changed") return null;
  if (!isString(value.workflowId) || !value.workflowId.length || value.workflowId.length > 128) {
    throw new Error("Invalid workflows event.");
  }
  return { type: "workflows-changed", workflowId: value.workflowId };
}

const timestamp = string(64);
/** `<started at>|<run id>` of the last run of a page; see `WorkflowRunStore.page`. */
const runCursor = string(64);
const stepText = string(WORKFLOW_STEP_TEXT_LIMIT);
const title: AdminDecoder = (value) => {
  if (!isString(value) || !value.trim().length || value.length > 160) throw new Error("Invalid workflow title.");
  return value;
};
/**
 * A kind or a status. A newer host can add one in this capability, so the decoder accepts any short
 * lowercase name and the client maps a name it does not know (see `remote-agent-decoding.ts`).
 */
const token: AdminDecoder = (value) => {
  if (!isString(value) || !/^[a-z][a-z0-9-]{0,31}$/u.test(value)) throw new Error("Invalid workflow value.");
  return value;
};
/** A whole number from 1, such as a run number, an attempt or a page size. */
const ordinal =
  (maximum: number): AdminDecoder =>
  (value) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error("Invalid workflow number.");
    return value;
  };
const finite =
  (maximum: number, positive: boolean): AdminDecoder =>
  (value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum || (positive && value <= 0))
      throw new Error("Invalid workflow number.");
    return value;
  };
const coordinate = finite(1_000_000, false);
const size = finite(100_000, true);
const point = fields({ x: coordinate, y: coordinate });
const fieldValue: AdminDecoder = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value) && value.length <= 20_000) return value;
  throw new Error("Invalid workflow field.");
};
/** The settings of a node by name. The host reads the names its runtime knows and keeps the rest. */
const nodeFields: AdminDecoder = (value) => {
  if (!isDynamicRecord(value)) throw new Error("Invalid workflow fields.");
  const entries = Object.entries(value);
  if (entries.length > 32 || entries.some(([name]) => !name.length || name.length > 64))
    throw new Error("Invalid workflow fields.");
  const decoded: Record<string, TeamProtocolV2Json> = {};
  for (const [name, field] of entries) decoded[name] = fieldValue(field);
  return decoded;
};
/** A calendar date as "YYYY-MM-DD" that exists. */
const routineDate: AdminDecoder = (value) => {
  if (!isString(value)) throw new Error("Invalid workflow schedule.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!match || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new Error("Invalid workflow schedule.");
  return value;
};
const onceSchedule = fields({ kind: oneOf("once"), date: routineDate, time: routineTime });
/** A routine schedule, and also a one-time date, which the routine contracts do not carry. */
const schedule: AdminDecoder = (value) =>
  isDynamicRecord(value) && value.kind === "once" ? onceSchedule(value) : routineSchedule(value);
const node = fields(
  {
    id: identifier,
    kind: token,
    at: point,
    fields: nodeFields,
  },
  { size: fields({}, { width: size, height: size, font: size }), locked: boolean, schedule },
);
const edge = fields({ id: identifier, from: identifier, to: identifier, type: token }, { branch: oneOf("yes", "no") });
const stroke = fields({
  id: identifier,
  brush: identifier,
  color: identifier,
  width: size,
  points: list(point, 2_000),
});
const graph = fields({ nodes: list(node, 200), edges: list(edge, 400), strokes: list(stroke, 500) });
const runStatus = token;
const summary = fields({
  id: identifier,
  title,
  steps: count,
  updatedAt: timestamp,
  lastRun: nullable(fields({ status: runStatus, at: timestamp })),
});
const trigger = fields({
  nodeId: identifier,
  type: token,
  nextDueAt: nullable(timestamp),
  webhookUrl: nullable(string(2_048)),
});
const detail = fields({ summary, graph, revision: count, triggers: list(trigger, 200) });
const saveResult: AdminDecoder = (value) => {
  if (isDynamicRecord(value) && value.ok === true) return fields({ ok: boolean, revision: count })(value);
  if (isDynamicRecord(value) && value.ok === false) return fields({ ok: boolean, conflict: detail })(value);
  throw new Error("Invalid workflow save result.");
};
const version = fields({ id: identifier, at: timestamp, kind: token, revision: count });
const run = fields({
  id: identifier,
  workflowId: identifier,
  number: ordinal(Number.MAX_SAFE_INTEGER),
  triggerNodeId: nullable(identifier),
  source: token,
  status: runStatus,
  error: nullable(stepText),
  startedAt: timestamp,
  endedAt: nullable(timestamp),
});
const step = fields({
  id: identifier,
  workflowId: identifier,
  runId: nullable(identifier),
  nodeId: identifier,
  attempt: ordinal(Number.MAX_SAFE_INTEGER),
  agentId: nullable(identifier),
  status: token,
  output: nullable(stepText),
  branch: nullable(oneOf("yes", "no")),
  error: nullable(stepText),
  startedAt: nullable(timestamp),
  endedAt: nullable(timestamp),
});
const runDetail = fields({ run, steps: list(step, WORKFLOW_RUN_STEP_LIMIT) });
const runPage = fields({
  runs: list(runDetail, 50),
  soloSteps: list(step, 50),
  nextBefore: nullable(runCursor),
});
const workflowRef = fields({ workflowId: identifier });
const secret: AdminDecoder = (value) => {
  if (!isString(value) || !value.length || value.length > 128) throw new Error("Invalid workflow webhook secret.");
  return value;
};

export const WORKFLOWS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_ROUTES.list, adminRoute(empty, fields({ workflows: list(summary, 10_000) }))],
  [WORKFLOWS_ROUTES.get, adminRoute(workflowRef, detail)],
  [WORKFLOWS_ROUTES.create, adminRoute(fields({ title }, { graph }), detail)],
  [WORKFLOWS_ROUTES.rename, adminRoute(fields({ workflowId: identifier, title }), summary)],
  [WORKFLOWS_ROUTES.delete, adminRoute(workflowRef, empty)],
  [WORKFLOWS_ROUTES.saveGraph, adminRoute(fields({ workflowId: identifier, baseRevision: count, graph }), saveResult)],
  [WORKFLOWS_ROUTES.versions, adminRoute(workflowRef, fields({ versions: list(version, 100) }))],
  [
    WORKFLOWS_ROUTES.versionGraph,
    adminRoute(fields({ workflowId: identifier, versionId: identifier }), fields({ graph })),
  ],
  [WORKFLOWS_ROUTES.restoreVersion, adminRoute(fields({ workflowId: identifier, versionId: identifier }), detail)],
  [
    WORKFLOWS_ROUTES.startRun,
    adminRoute(fields({ workflowId: identifier, requestId: identifier }, { fromNodeId: identifier }), runDetail),
  ],
  [
    WORKFLOWS_ROUTES.runStep,
    adminRoute(fields({ workflowId: identifier, nodeId: identifier, requestId: identifier }), step),
  ],
  [WORKFLOWS_ROUTES.stopStep, adminRoute(fields({ stepId: identifier }), empty)],
  [WORKFLOWS_ROUTES.stopRun, adminRoute(fields({ runId: identifier }), empty)],
  [WORKFLOWS_ROUTES.retryStep, adminRoute(fields({ stepId: identifier, requestId: identifier }), step)],
  [WORKFLOWS_ROUTES.decide, adminRoute(fields({ stepId: identifier, approved: boolean }), empty)],
  [
    WORKFLOWS_ROUTES.runs,
    adminRoute(fields({ workflowId: identifier, limit: ordinal(50) }, { before: runCursor }), runPage),
  ],
  [WORKFLOWS_ROUTES.run, adminRoute(fields({ runId: identifier }), runDetail)],
  [
    WORKFLOWS_ROUTES.rotateWebhookSecret,
    adminRoute(fields({ workflowId: identifier, nodeId: identifier }), fields({ secret })),
  ],
]);
