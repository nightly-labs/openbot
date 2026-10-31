// Workflow payloads from a joined server, for the desktop app and the mobile app. `workflows-v1`
// carries kinds and statuses as open names, so a newer host can add one. The decoders below map a
// name that this app does not know to a known one before the closed IPC guards run: a status or a
// source to the nearest neutral value, and a node kind or a port type to a locked note that the app
// shows but does not save. A trigger type or an output target that it does not know keeps its node,
// but the app shows the workflow read-only, as a save from a choice that falls back would change it.

import {
  isWorkflowDetail,
  isWorkflowGraph,
  isWorkflowRunDetail,
  isWorkflowRunPage,
  isWorkflowSaveResult,
  isWorkflowStep,
  isWorkflowSummary,
  isWorkflowVersion,
  isWorkflowWebhookSecret,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTPUT_TARGETS,
  WORKFLOW_PORT_TYPES,
  WORKFLOW_RUN_SOURCES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_KINDS,
} from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

type Json = DynamicRecord;

/** The record with `fallback` at `key` when the name there is one that this app does not know. */
function withKnown(record: Json, key: string, choices: readonly string[], fallback: string): Json {
  return isUnknownName(choices, record[key]) ? { ...record, [key]: fallback } : record;
}

function isUnknownName(choices: readonly string[], value: unknown): boolean {
  return isString(value) && !isOneOf(choices, value);
}

/** A map of a record; any other value goes to its guard as it is. */
const onRecord =
  (map: (record: Json) => Json) =>
  (value: unknown): unknown =>
    isDynamicRecord(value) ? map(value) : value;

function mapList(record: Json, key: string, map: (item: unknown) => unknown): Json {
  const items = record[key];
  return Array.isArray(items) ? { ...record, [key]: items.map(map) } : record;
}

const runStatus = (record: Json) => withKnown(record, "status", WORKFLOW_RUN_STATUSES, "stopped");

const summary = onRecord((record) =>
  isDynamicRecord(record.lastRun) ? { ...record, lastRun: runStatus(record.lastRun) } : record,
);

const run = onRecord((record) => runStatus(withKnown(record, "source", WORKFLOW_RUN_SOURCES, "manual")));

const step = onRecord((record) => withKnown(record, "status", WORKFLOW_STEP_STATUSES, "stopped"));

const runDetail = onRecord((record) => mapList({ ...record, run: run(record.run) }, "steps", step));

const version = onRecord((record) => withKnown(record, "kind", WORKFLOW_VERSION_KINDS, "auto"));

const trigger = onRecord((record) => withKnown(record, "type", WORKFLOW_TRIGGER_TYPES, "manual"));

/** A trigger type or an output target that this app does not know. */
function hasUnknownSetting(node: Json): boolean {
  const fields = isDynamicRecord(node.fields) ? node.fields : {};
  if (node.kind === "trigger") return isUnknownName(WORKFLOW_TRIGGER_TYPES, fields.trigger);
  if (node.kind === "output") return isUnknownName(WORKFLOW_OUTPUT_TARGETS, fields.target);
  return false;
}

/**
 * The detail with each node of an unknown kind as a locked note in its place, without the edges of
 * such nodes and the edges of an unknown port type, and marked so the app does not save it. A node
 * with an unknown trigger type or output target stays, and it also marks the detail.
 */
const detail = onRecord((record) => {
  const base = mapList({ ...record, summary: summary(record.summary) }, "triggers", trigger);
  const graph = base.graph;
  if (!isDynamicRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return base;
  const placeholders = new Set<unknown>();
  const settings = graph.nodes.some((node) => isDynamicRecord(node) && hasUnknownSetting(node));
  const nodes = graph.nodes.map(
    onRecord((node) => {
      if (!isUnknownName(WORKFLOW_NODE_KINDS, node.kind)) return node;
      placeholders.add(node.id);
      const { schedule: _schedule, ...rest } = node;
      return { ...rest, kind: "note", locked: true };
    }),
  );
  const edges = graph.edges.filter(
    (edge) =>
      !isDynamicRecord(edge) ||
      !(isUnknownName(WORKFLOW_PORT_TYPES, edge.type) || placeholders.has(edge.from) || placeholders.has(edge.to)),
  );
  const newer = settings || placeholders.size > 0 || edges.length < graph.edges.length;
  return { ...base, graph: { ...graph, nodes, edges }, ...(newer ? { needsNewerApp: true } : {}) };
});

const saveResult = onRecord((record) =>
  record.ok === false ? { ...record, conflict: detail(record.conflict) } : record,
);

const runPage = onRecord((record) => mapList(mapList(record, "runs", runDetail), "soloSteps", step));

function mapped<T>(map: (value: unknown) => unknown, decode: (value: unknown) => T) {
  return (value: unknown): T => decode(map(value));
}

export const decodeRemoteWorkflowSummary = mapped(summary, guardedDecoder(isWorkflowSummary, "remote workflow"));
export const decodeRemoteWorkflowDetail = mapped(detail, guardedDecoder(isWorkflowDetail, "remote workflow"));
/**
 * The `workflows-v1` version-graph route wraps its graph as `{ graph }`. A graph with a kind that this
 * app does not know shows with locked notes in its place; the restore itself runs on the host.
 */
export function decodeRemoteWorkflowVersionGraph(value: unknown) {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote workflow version.");
  const mappedDetail = detail({ graph: value.graph });
  if (!isDynamicRecord(mappedDetail)) throw new Error("Invalid remote workflow version.");
  return decodeVersionGraph(mappedDetail.graph);
}
export const decodeRemoteWorkflowSaveResult = mapped(
  saveResult,
  guardedDecoder(isWorkflowSaveResult, "remote workflow save result"),
);
export const decodeRemoteWorkflowRunDetail = mapped(
  runDetail,
  guardedDecoder(isWorkflowRunDetail, "remote workflow run"),
);
export const decodeRemoteWorkflowRunPage = mapped(runPage, guardedDecoder(isWorkflowRunPage, "remote workflow runs"));
export const decodeRemoteWorkflowStep = mapped(step, guardedDecoder(isWorkflowStep, "remote workflow step"));
export const decodeRemoteWorkflowSecret = guardedDecoder(isWorkflowWebhookSecret, "remote workflow webhook secret");
const decodeVersionGraph = guardedDecoder(isWorkflowGraph, "remote workflow version");
const decodeWorkflowSummaries = guardedListDecoder(isWorkflowSummary, "remote workflow list");
const decodeWorkflowVersions = guardedListDecoder(isWorkflowVersion, "remote workflow versions");

/** The `workflows-v1` list route wraps its list as `{ workflows }`. */
export function decodeRemoteWorkflowList(value: unknown) {
  if (!isDynamicRecord(value) || !Array.isArray(value.workflows)) throw new Error("Invalid remote workflow list.");
  return decodeWorkflowSummaries(value.workflows.map(summary));
}

/** The `workflows-v1` versions route wraps its list as `{ versions }`. */
export function decodeRemoteWorkflowVersions(value: unknown) {
  if (!isDynamicRecord(value) || !Array.isArray(value.versions)) throw new Error("Invalid remote workflow versions.");
  return decodeWorkflowVersions(value.versions.map(version));
}
