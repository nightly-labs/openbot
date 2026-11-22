import { WORKFLOW_TRIGGER_FIELDS_FORMAT, workflowTriggerFields } from "./ipc-workflow-trigger-fields";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeSize, WorkflowStroke } from "./ipc-workflows";
import { isDynamicRecord } from "./runtime-values";

export const WORKFLOW_FORMAT = 3;

interface WorkflowFormatRule {
  readonly since: number;
  readonly uses: (graph: WorkflowGraph) => boolean;
}

const NAME_TEMPLATE = /\{\{\s*[A-Za-z_][A-Za-z0-9_]{0,39}\s*\}\}/u;
const OUTPUT_NAME_FIELDS = ["title", "labels", "person"] as const;

function outputUsesNames(node: WorkflowNode): boolean {
  if (node.kind !== "output") return false;
  const message = node.fields.message;
  if (typeof message === "string" && message.trim()) return true;
  return OUTPUT_NAME_FIELDS.some((name) => {
    const value = node.fields[name];
    return typeof value === "string" && NAME_TEMPLATE.test(value);
  });
}

const NAME_TEMPLATES = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/gu;
const NAME_WORDS = /[A-Za-z_][A-Za-z0-9_]{0,39}/gu;
const DECLARED_NAMES = /^\s*([A-Za-z_][A-Za-z0-9_]{0,39})\??\s*:/gmu;

function namesIn(node: WorkflowNode, name: string, value: string): string[] {
  if (node.kind === "condition" && name === "check") return [...value.matchAll(NAME_WORDS)].map((match) => match[0]);
  return [...value.matchAll(NAME_TEMPLATES)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function usesTriggerFields(graph: WorkflowGraph): boolean {
  const builtIn = new Set(graph.nodes.flatMap((node) => workflowTriggerFields(node).map((field) => field.name)));
  for (const node of graph.nodes) {
    const answer = node.fields.answer;
    if (typeof answer !== "string") continue;
    for (const match of answer.matchAll(DECLARED_NAMES)) if (match[1]) builtIn.delete(match[1]);
  }
  if (builtIn.size === 0) return false;
  return graph.nodes.some(
    (node) =>
      node.kind !== "trigger" &&
      Object.entries(node.fields).some(
        ([name, value]) => typeof value === "string" && namesIn(node, name, value).some((used) => builtIn.has(used)),
      ),
  );
}

const WORKFLOW_FORMAT_RULES: readonly WorkflowFormatRule[] = [
  { since: 2, uses: (graph) => graph.nodes.some(outputUsesNames) },
  { since: WORKFLOW_TRIGGER_FIELDS_FORMAT, uses: usesTriggerFields },
];

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
