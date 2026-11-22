import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeSize, WorkflowStroke } from "./ipc-workflows";
import { isDynamicRecord } from "./runtime-values";

export const WORKFLOW_FORMAT = 1;

interface WorkflowFormatRule {
  readonly since: number;
  readonly uses: (graph: WorkflowGraph) => boolean;
}

const WORKFLOW_FORMAT_RULES: readonly WorkflowFormatRule[] = [];

export function workflowGraphFormat(graph: WorkflowGraph): number {
  return WORKFLOW_FORMAT_RULES.reduce((format, rule) => (rule.uses(graph) ? Math.max(format, rule.since) : format), 1);
}

export function isWorkflowFormat(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function workflowFormatIsNewer(format: unknown): boolean {
  return isWorkflowFormat(format) && format > WORKFLOW_FORMAT;
}

const GRAPH_KEYS = { nodes: true, edges: true, strokes: true } as const satisfies Record<keyof WorkflowGraph, true>;
const NODE_KEYS = {
  id: true,
  kind: true,
  at: true,
  size: true,
  locked: true,
  fields: true,
  schedule: true,
} as const satisfies Record<keyof WorkflowNode, true>;
const SIZE_KEYS = { width: true, height: true, font: true } as const satisfies Record<keyof WorkflowNodeSize, true>;
const EDGE_KEYS = { id: true, from: true, to: true, type: true, branch: true } as const satisfies Record<
  keyof WorkflowEdge,
  true
>;
const STROKE_KEYS = { id: true, brush: true, color: true, width: true, points: true } as const satisfies Record<
  keyof WorkflowStroke,
  true
>;

function hasOnly(value: unknown, keys: Readonly<Record<string, true>>): boolean {
  return !isDynamicRecord(value) || Object.keys(value).every((key) => Object.hasOwn(keys, key));
}

function listHasOnly(value: unknown, keys: Readonly<Record<string, true>>, each?: (item: unknown) => boolean) {
  return !Array.isArray(value) || value.every((item) => hasOnly(item, keys) && (each?.(item) ?? true));
}

export function workflowGraphHasUnknownKey(graph: unknown): boolean {
  if (!isDynamicRecord(graph)) return false;
  return !(
    hasOnly(graph, GRAPH_KEYS) &&
    listHasOnly(graph.nodes, NODE_KEYS, (node) => !isDynamicRecord(node) || hasOnly(node.size, SIZE_KEYS)) &&
    listHasOnly(graph.edges, EDGE_KEYS) &&
    listHasOnly(graph.strokes, STROKE_KEYS)
  );
}
