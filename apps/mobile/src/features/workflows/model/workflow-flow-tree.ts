import {
  isWorkflowStepKind,
  WORKFLOW_PORTS,
  type WorkflowBranch,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  workflowLoopEdges,
} from "@openbot/contracts/ipc";
import type { GraphPlace } from "./workflow-graph-edit";

/**
 * A workflow of any shape as a tree that a phone draws from left to right:
 *
 * - `step`: one step.
 * - `split`: a step with more than one way on, such as a condition. Each path goes down to the step
 *   where the paths join, and the flow goes on from there.
 * - `jump`: a way to a step that the tree shows at another place: a loop back, or a second way in.
 * - `add`: a place where the editor can add a step: on each connection, and at the end of a path. A
 *   view that does not edit draws a connection as a line and leaves out the ends of paths.
 *
 * An output that a step sends its result to, and a prompt or a file that feeds a step, sit next to
 * that step in its list, as the editor shows them. The steps that no trigger reaches come last.
 */
export type FlowItem =
  | { type: "step"; id: string }
  /** `joined`: the paths meet again and the flow goes on after them; else each path ends by itself. */
  | { type: "split"; from: string; paths: FlowPath[]; joined: boolean }
  /** `from`: the step that the way leaves, so two ways to one step have their own keys. */
  | { type: "jump"; from: string; to: string; loop: boolean }
  | { type: "add"; place: GraphPlace };

export interface FlowPath {
  /** Stable among the paths of one split: the branch, or the first step of the path. */
  key: string;
  /** The branch of a condition, or null for a step that sends its result to more than one step. */
  branch: WorkflowBranch | null;
  items: FlowItem[];
  /** The path goes on to a step after the split, its join or a join further out; else the run ends. */
  goesOn: boolean;
}

export interface FlowTree {
  items: FlowItem[];
  /** The steps that no trigger reaches. */
  loose: string[];
}

const BRANCH_ORDER: Record<WorkflowBranch, number> = { yes: 0, no: 1 };

export function workflowFlowTree(graph: WorkflowGraph): FlowTree {
  const steps = graph.nodes.filter((node) => isWorkflowStepKind(node.kind));
  const byId = new Map(steps.map((node) => [node.id, node]));
  const edges = graph.edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to);
  const loops = workflowLoopEdges(steps, edges);
  const out = new Map<string, WorkflowEdge[]>();
  const into = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (loops.has(edge.id)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge]);
  }
  const loopEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of edges)
    if (loops.has(edge.id)) loopEdges.set(edge.from, [...(loopEdges.get(edge.from) ?? []), edge]);

  const position = (id: string) => byId.get(id)?.at ?? { x: 0, y: 0 };
  // The canvas reads from left to right, then from top to bottom.
  const byPosition = (left: string, right: string) =>
    position(left).x - position(right).x || position(left).y - position(right).y;
  const isLeaf = (id: string) => (out.get(id) ?? []).length === 0 && !loopEdges.has(id);
  /** A step with no way in that feeds the steps after it, such as a prompt. */
  // Only a prompt or a file feeds the step after it. Any other step with no way in does not run: it
  // stays with the steps that no trigger reaches.
  const isFeeder = (node: WorkflowNode) =>
    (node.kind === "prompt" || node.kind === "asset") && (into.get(node.id) ?? []).length === 0;

  const placed = new Set<string>();
  /** Whether the last walk stopped at a join: its path goes on after the split. */
  let endedAtStop = false;

  /**
   * The steps that a step reaches, with the fewest edges to each. It does not go past a step of `stop`,
   * the join of an outer split: the paths of an inner split must join before the outer paths do.
   */
  const reach = (start: string, stop: ReadonlySet<string>) => {
    const distance = new Map([[start, 0]]);
    let layer = [start];
    while (layer.length > 0) {
      const next: string[] = [];
      for (const id of layer) {
        if (stop.has(id)) continue;
        for (const edge of out.get(id) ?? [])
          if (!distance.has(edge.to) && !placed.has(edge.to)) {
            distance.set(edge.to, (distance.get(id) ?? 0) + 1);
            next.push(edge.to);
          }
      }
      layer = next;
    }
    return distance;
  };

  /** The nearest step that every path reaches: the paths join there. */
  const joinOf = (targets: readonly string[], stop: ReadonlySet<string>): string | undefined => {
    const maps = targets.map((target) => reach(target, stop));
    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [id] of maps[0] ?? []) {
      if (!maps.every((map) => map.has(id))) continue;
      const distance = Math.max(...maps.map((map) => map.get(id) ?? 0));
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  };

  const place = (id: string, items: FlowItem[]) => {
    // A prompt or a file that feeds this step comes first, as it does in the editor.
    for (const edge of into.get(id) ?? []) {
      const feeder = byId.get(edge.from);
      if (feeder && isFeeder(feeder) && !placed.has(feeder.id)) {
        placed.add(feeder.id);
        items.push({ type: "step", id: feeder.id });
      }
    }
    placed.add(id);
    items.push({ type: "step", id });
  };

  /** `via`: the connection into `start`, which is a place to add a step. */
  const walk = (start: string | undefined, stop: ReadonlySet<string>, via?: WorkflowEdge): FlowItem[] => {
    const items: FlowItem[] = [];
    if (via) items.push({ type: "add", place: { kind: "edge", edgeId: via.id } });
    let current = start;
    let previous = via?.from ?? "";
    while (current && !stop.has(current)) {
      if (placed.has(current)) {
        items.push({ type: "jump", from: previous, to: current, loop: false });
        break;
      }
      place(current, items);
      const from = current;
      const ways = out.get(from) ?? [];
      // An output with no way on takes the result of this step; the flow goes on from this step.
      const ends = ways.filter(
        (edge) =>
          !edge.branch &&
          byId.get(edge.to)?.kind === "output" &&
          isLeaf(edge.to) &&
          (into.get(edge.to) ?? []).length === 1 &&
          !stop.has(edge.to) &&
          !placed.has(edge.to),
      );
      for (const edge of ends.sort((left, right) => byPosition(left.to, right.to))) place(edge.to, items);
      const rest = ways
        .filter((edge) => !ends.includes(edge))
        .sort(
          (left, right) =>
            (left.branch ? BRANCH_ORDER[left.branch] : 2) - (right.branch ? BRANCH_ORDER[right.branch] : 2) ||
            byPosition(left.to, right.to),
        );
      const back = loopEdges.get(from) ?? [];
      for (const edge of back)
        items.push(
          { type: "add", place: { kind: "edge", edgeId: edge.id } },
          { type: "jump", from, to: edge.to, loop: true },
        );
      const node = byId.get(from);
      const isCondition = node?.kind === "condition";
      if (rest.length === 0 && !isCondition) {
        // A step that sends nothing, such as an output, or one that loops back, has no end to add after.
        if (back.length === 0 && node && WORKFLOW_PORTS[node.kind].out.length > 0)
          items.push({ type: "add", place: { kind: "after", nodeId: from } });
        break;
      }
      const next = rest[0];
      if (rest.length === 1 && next && !(isCondition && next.branch)) {
        items.push({ type: "add", place: { kind: "edge", edgeId: next.id } });
        previous = from;
        current = next.to;
        continue;
      }
      // Paths join only when there are two or more: one connected path of a condition goes on alone,
      // and its other answer ends the run.
      const join =
        rest.length > 1
          ? joinOf(
              rest.map((edge) => edge.to),
              stop,
            )
          : undefined;
      const inner = new Set(stop);
      if (join) inner.add(join);
      const paths: FlowPath[] = rest.map((edge) => {
        const items = walk(edge.to, inner, edge);
        return { key: edge.branch ?? edge.to, branch: edge.branch ?? null, items, goesOn: endedAtStop };
      });
      // A condition shows both of its paths: one that goes nowhere ends the run, and a step can go there.
      if (isCondition)
        for (const branch of ["yes", "no"] as const)
          if (!rest.some((edge) => edge.branch === branch))
            paths.push({
              key: branch,
              branch,
              items: [{ type: "add", place: { kind: "after", nodeId: from, branch } }],
              goesOn: false,
            });
      paths.sort((left, right) => (left.branch === "no" ? 1 : 0) - (right.branch === "no" ? 1 : 0));
      items.push({ type: "split", from, paths, joined: Boolean(join) });
      previous = from;
      current = join;
    }
    // Read by the split that walked this path, right after this call returns.
    endedAtStop = current !== undefined && stop.has(current);
    return items;
  };

  const triggers = steps.filter((node) => node.kind === "trigger").map((node) => node.id);
  const items = triggers.sort(byPosition).flatMap((id) => walk(id, new Set()));
  const loose = steps
    .filter((node) => !placed.has(node.id))
    .map((node) => node.id)
    .sort(byPosition);
  return { items, loose };
}

/**
 * A row of the list view of a workflow of any shape, in the order that a run goes, with the depth of
 * its path: a step, the label of a path, a way to a step shown at another place, or the end of a path
 * that has no step.
 */
export type FlowRow =
  | { type: "step"; id: string; depth: number }
  | { type: "path"; key: string; branch: WorkflowBranch | null; index: number; depth: number }
  | { type: "jump"; key: string; to: string; loop: boolean; depth: number }
  /** `goesOn`: the path goes to the steps after the split; else the run ends there. */
  | { type: "end"; key: string; goesOn: boolean; depth: number }
  | { type: "loose"; depth: number };

/** The tree as rows: each path under its label, one level deeper; the steps that no trigger reaches last. */
export function flowRows(tree: FlowTree): FlowRow[] {
  const rows: FlowRow[] = [];
  const walk = (items: readonly FlowItem[], depth: number, path: string) => {
    for (const item of items) {
      if (item.type === "step") rows.push({ type: "step", id: item.id, depth });
      else if (item.type === "jump")
        rows.push({
          type: "jump",
          key: `${path}/jump-${item.from}-${item.to}`,
          to: item.to,
          loop: item.loop,
          depth,
        });
      else if (item.type === "split")
        item.paths.forEach((child, index) => {
          const key = `${path}/${item.from}-${child.key}`;
          rows.push({ type: "path", key, branch: child.branch, index, depth: depth + 1 });
          if (child.items.every((inner) => inner.type === "add"))
            rows.push({ type: "end", key: `${key}/end`, goesOn: child.goesOn, depth: depth + 1 });
          else walk(child.items, depth + 1, key);
        });
    }
  };
  walk(tree.items, 0, "");
  if (tree.loose.length > 0) {
    rows.push({ type: "loose", depth: 0 });
    for (const id of tree.loose) rows.push({ type: "step", id, depth: 1 });
  }
  return rows;
}
