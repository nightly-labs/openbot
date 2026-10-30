/**
 * The loops of a workflow graph, as the canvas shows them. A run takes the same connections back to an
 * earlier node as the next pass (`workflowLoopEdges`), so the canvas marks the ones the run marks.
 */

import { type WorkflowEdge, type WorkflowGraph, workflowLoopEdges } from "@openbot/contracts/ipc";

export interface WorkflowLoop {
  /** The nodes that each pass runs again: from the node the loop goes back to, to the loop's start. */
  body: readonly string[];
  /** No condition in the body can end the loop, so it repeats until the user stops the run. */
  endless: boolean;
}

/** The loop of each connection that goes back to an earlier node, by connection ID. */
export function workflowLoops(graph: WorkflowGraph): Map<string, WorkflowLoop> {
  const backs = workflowLoopEdges(graph.nodes, graph.edges);
  const forward = graph.edges.filter((edge) => !backs.has(edge.id));
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const loops = new Map<string, WorkflowLoop>();
  for (const edge of graph.edges) {
    if (!backs.has(edge.id)) continue;
    const after = reach(edge.to, forward, "from", "to");
    const before = reach(edge.from, forward, "to", "from");
    const body = [...after].filter((id) => before.has(id));
    loops.set(edge.id, { body, endless: !body.some((id) => kinds.get(id) === "condition") });
  }
  return loops;
}

function reach(origin: string, edges: readonly WorkflowEdge[], from: "from" | "to", to: "from" | "to"): Set<string> {
  const seen = new Set([origin]);
  const pending = [origin];
  for (let id = pending.pop(); id !== undefined; id = pending.pop())
    for (const edge of edges)
      if (edge[from] === id && !seen.has(edge[to])) {
        seen.add(edge[to]);
        pending.push(edge[to]);
      }
  return seen;
}
