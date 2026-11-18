/**
 * The three-way merge of a workflow graph, so that two people can edit one workflow at the same time.
 * `base` is the graph that both edits start from, `mine` has the edits of this device, and `theirs` is
 * the newer graph of the host. A part that only one side changed takes that change. When both sides
 * changed the same field of a node, this device wins: the other device then gets this edit too. An
 * edit wins over a delete, so no work is lost.
 */

import type { WorkflowEdge, WorkflowFields, WorkflowGraph, WorkflowNode, WorkflowStroke } from "@openbot/contracts/ipc";
import { stableJson } from "./workflow-history";

const same = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);

/** The value of one part: the change of the side that changed it, or mine when both did. */
const pick = <V>(base: V, mine: V, theirs: V): V => (same(mine, base) ? theirs : mine);

/** Merges the fields of a node one by one. */
function mergeFields(base: WorkflowFields, mine: WorkflowFields, theirs: WorkflowFields): WorkflowFields {
  const merged: WorkflowFields = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const value = pick(base[key], mine[key], theirs[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** A node that both sides changed: each field and each other part of the node merges alone. */
function mergeNode(base: WorkflowNode, mine: WorkflowNode, theirs: WorkflowNode): WorkflowNode {
  const node: WorkflowNode = {
    id: mine.id,
    kind: pick(base.kind, mine.kind, theirs.kind),
    at: pick(base.at, mine.at, theirs.at),
    fields: mergeFields(base.fields, mine.fields, theirs.fields),
  };
  const size = pick(base.size, mine.size, theirs.size);
  if (size) node.size = size;
  if (pick(base.locked, mine.locked, theirs.locked)) node.locked = true;
  const schedule = pick(base.schedule, mine.schedule, theirs.schedule);
  if (schedule) node.schedule = schedule;
  return node;
}

/** Whether the ids that both lists have are in the same order. */
function sameOrder(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  const ids = new Set(right.map((item) => item.id));
  const shared = left.filter((item) => ids.has(item.id)).map((item) => item.id);
  const kept = new Set(shared);
  const other = right.filter((item) => kept.has(item.id)).map((item) => item.id);
  return shared.every((id, index) => other[index] === id);
}

/**
 * Merges lists of items by id. The order is the order of `theirs`, unless only `mine` changed it; an
 * item that only one side has goes after the others of that side.
 */
function mergeItems<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  both: (base: T, mine: T, theirs: T) => T,
): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const mineById = new Map(mine.map((item) => [item.id, item]));
  const theirsById = new Map(theirs.map((item) => [item.id, item]));
  const pick = (id: string): T | undefined => {
    const b = baseById.get(id);
    const m = mineById.get(id);
    const t = theirsById.get(id);
    if (!b) return m ?? t;
    // One side deleted it: an edit on the other side keeps it.
    if (!m) return t && !same(t, b) ? t : undefined;
    if (!t) return same(m, b) ? undefined : m;
    if (same(m, b)) return t;
    if (same(t, b)) return m;
    return both(b, m, t);
  };
  const first = !sameOrder(mine, base) && sameOrder(theirs, base) ? mine : theirs;
  const second = first === mine ? theirs : mine;
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...first, ...second]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const kept = pick(item.id);
    if (kept) merged.push(kept);
  }
  return merged;
}

const edgeKey = (edge: WorkflowEdge) => `${edge.from}\u0000${edge.to}\u0000${edge.type}\u0000${edge.branch ?? ""}`;

/** The graph with the edits of both sides. */
export function mergeWorkflowGraphs(base: WorkflowGraph, mine: WorkflowGraph, theirs: WorkflowGraph): WorkflowGraph {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || same(mine, theirs)) return mine;
  const nodes = mergeItems(base.nodes, mine.nodes, theirs.nodes, mergeNode);
  const live = new Set(nodes.map((node) => node.id));
  // A connection to a node that a side deleted goes, and two sides that made the same connection keep one.
  const keys = new Set<string>();
  const edges = mergeItems<WorkflowEdge>(base.edges, mine.edges, theirs.edges, (_base, kept) => kept).filter((edge) => {
    const key = edgeKey(edge);
    if (!live.has(edge.from) || !live.has(edge.to) || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  const strokes = mergeItems<WorkflowStroke>(base.strokes, mine.strokes, theirs.strokes, (_base, kept) => kept);
  return { nodes, edges, strokes };
}
