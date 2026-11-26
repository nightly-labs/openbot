import { type WorkflowEdge, type WorkflowGraph, type WorkflowNode, workflowLoopEdges } from "./ipc-workflows";

export const WORKFLOW_PATH_WALK_LIMIT = 256;

export interface WorkflowPathSource {
  node: WorkflowNode;
  fields: readonly { name: string }[];
}

export interface WorkflowNamePathProblem {
  name: string;
  code: "path" | "repeated";
}

export function workflowForwardEdges(graph: WorkflowGraph): WorkflowEdge[] {
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  return graph.edges.filter((edge) => !loops.has(edge.id));
}

export function workflowNamePathProblems(
  graph: WorkflowGraph,
  nodeId: string,
  forward: readonly WorkflowEdge[],
  sources: readonly WorkflowPathSource[],
  names: readonly string[],
  required: ReadonlySet<string>,
): WorkflowNamePathProblem[] {
  if (names.length === 0) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const before = new Map<string, WorkflowEdge[]>();
  for (const edge of forward) before.set(edge.to, [...(before.get(edge.to) ?? []), edge]);
  const ancestors = ancestorsOf(nodeId, before);
  const conditions = ancestors.filter((id) => id !== nodeId && nodes.get(id)?.kind === "condition");
  const triggers = ancestors.filter((id) => nodes.get(id)?.kind === "trigger");
  const starts: (string | null)[] = triggers.length > 0 ? triggers : [null];
  if (starts.length * 2 ** conditions.length > WORKFLOW_PATH_WALK_LIMIT) return [];
  const giving = new Map(
    names.map((name) => [name, sources.filter((source) => source.fields.some((field) => field.name === name))]),
  );
  const found = new Map<string, WorkflowNamePathProblem["code"]>();
  for (const start of starts)
    for (let mask = 0; mask < 2 ** conditions.length; mask += 1) {
      const outcome = new Map(conditions.map((id, index) => [id, mask & (1 << index) ? "yes" : "no"]));
      const runs = runCheck(nodes, before, start, outcome);
      if (!runs(nodeId)) continue;
      for (const [name, options] of giving) {
        const running = options.filter((source) => runs(source.node.id));
        if (running.length > 1) found.set(name, "repeated");
        else if (running.length === 0 && required.has(name) && !found.has(name)) found.set(name, "path");
      }
    }
  return [...found].map(([name, code]) => ({ name, code }));
}

function ancestorsOf(nodeId: string, before: ReadonlyMap<string, readonly WorkflowEdge[]>): string[] {
  const seen = new Set<string>([nodeId]);
  const pending = [nodeId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop())
    for (const edge of before.get(id) ?? [])
      if (!seen.has(edge.from)) {
        seen.add(edge.from);
        pending.push(edge.from);
      }
  return [...seen];
}

function runCheck(
  nodes: ReadonlyMap<string, WorkflowNode>,
  before: ReadonlyMap<string, readonly WorkflowEdge[]>,
  start: string | null,
  outcome: ReadonlyMap<string, string>,
): (nodeId: string) => boolean {
  const known = new Map<string, boolean>();
  const active = (edge: WorkflowEdge) =>
    nodes.get(edge.from)?.kind !== "condition" || edge.branch === outcome.get(edge.from);
  const runs = (nodeId: string): boolean => {
    const saved = known.get(nodeId);
    if (saved !== undefined) return saved;
    known.set(nodeId, false);
    const node = nodes.get(nodeId);
    const inputs = before.get(nodeId) ?? [];
    const result =
      node !== undefined &&
      (node.kind === "trigger"
        ? nodeId === start
        : inputs.length === 0 || inputs.some((edge) => runs(edge.from) && active(edge)));
    known.set(nodeId, result);
    return result;
  };
  return runs;
}
