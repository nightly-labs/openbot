/**
 * The DOM-free rules of a diagram: the order its agents run in, which connections it accepts, and
 * the geometry the canvas draws edges with. Node sizes are fixed so that a port's position follows
 * from its node's position alone, without measuring the DOM.
 */

import type { Diagram, DiagramEdge, DiagramNode, DiagramPoint, DiagramRun } from "./diagram-model";

export const DIAGRAM_NODE_WIDTH = { routine: 264, agent: 264 } as const;
/** The height the fit and the bounds use. A card can be taller; its ports stay at the top. */
export const DIAGRAM_NODE_HEIGHT = { routine: 248, agent: 196 } as const;
/** The distance from a card's top edge to the centre of its ports. */
export const DIAGRAM_PORT_OFFSET_Y = 26;

export type DiagramConnectionProblem = "same-node" | "into-routine" | "duplicate" | "cycle";

/**
 * Why `from` cannot point at `to`, or null when it can. A routine only starts work, so nothing
 * points into one; and a cycle would run forever, so a connection that closes one is refused.
 */
export function diagramConnectionProblem(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  from: string,
  to: string,
): DiagramConnectionProblem | null {
  if (from === to) return "same-node";
  if (nodes.find((node) => node.id === to)?.kind === "routine") return "into-routine";
  if (edges.some((edge) => edge.from === from && edge.to === to)) return "duplicate";
  return reaches(edges, to, from) ? "cycle" : null;
}

function reaches(edges: readonly DiagramEdge[], start: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const edge of edges) if (edge.from === next) queue.push(edge.to);
  }
  return false;
}

/**
 * What one routine sets in motion: the agents it starts itself, and how many agents and steps the
 * whole run behind it takes. A node after two routines counts for each of them.
 */
export function diagramRoutineReach(
  edges: readonly DiagramEdge[],
  routineId: string,
): { direct: string[]; nodes: number; steps: number } {
  const steps = diagramRoutineSteps(edges, routineId);
  const direct = edges.filter((edge) => edge.from === routineId).map((edge) => edge.to);
  return { direct, nodes: steps.size, steps: Math.max(0, ...steps.values()) };
}

/** True when a run of `routineId` passes through the connection. */
export function diagramEdgeCarries(edge: DiagramEdge, routineId: string): boolean {
  return edge.routineId === undefined || edge.routineId === routineId;
}

/** The step each node runs in when this one routine fires. A node it does not reach is absent. */
export function diagramRoutineSteps(edges: readonly DiagramEdge[], routineId: string): Map<string, number> {
  const depth = new Map<string, number>();
  const queue = [routineId];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const current = depth.get(next) ?? 0;
    for (const edge of edges) {
      if (edge.from !== next || !diagramEdgeCarries(edge, routineId)) continue;
      if ((depth.get(edge.to) ?? 0) >= current + 1) continue;
      depth.set(edge.to, current + 1);
      queue.push(edge.to);
    }
  }
  return depth;
}

/** The routines whose run reaches a node, in the order the diagram lists them. */
export function diagramRoutinesReaching(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  nodeId: string,
): Extract<DiagramNode, { kind: "routine" }>[] {
  return nodes.filter(
    (node): node is Extract<DiagramNode, { kind: "routine" }> =>
      node.kind === "routine" && diagramRoutineSteps(edges, node.id).has(nodeId),
  );
}

/** The run that started last, whichever routine started it. */
export function diagramLatestRun(diagram: Pick<Diagram, "lastRuns">): DiagramRun | null {
  let latest: DiagramRun | null = null;
  for (const run of diagram.lastRuns) if (!latest || run.startedAt > latest.startedAt) latest = run;
  return latest;
}

export function diagramRunOf(diagram: Pick<Diagram, "lastRuns">, routineId: string | null): DiagramRun | null {
  return diagram.lastRuns.find((run) => run.routineNodeId === routineId) ?? null;
}

/** Each routine gets one of a fixed set of colours, by its place among the routines. */
export const DIAGRAM_ROUTINE_COLORS = 6;

export function diagramRoutineColor(nodes: readonly DiagramNode[], routineId: string): number {
  const index = nodes.filter((node) => node.kind === "routine").findIndex((node) => node.id === routineId);
  return Math.max(0, index) % DIAGRAM_ROUTINE_COLORS;
}

/**
 * The step each agent runs in: 1 for an agent a routine starts directly, and one more than its
 * latest input for the rest. Agents in the same step run side by side. An agent that no routine
 * reaches has no step and never runs.
 */
export function diagramExecutionSteps(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): Map<string, number> {
  const steps = new Map<string, number>();
  const level = new Map<string, number>();
  const queue = nodes.filter((node) => node.kind === "routine").map((node) => node.id);
  for (const id of queue) level.set(id, 0);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const current = level.get(next) ?? 0;
    for (const edge of edges) {
      if (edge.from !== next) continue;
      // The graph has no cycle, so a node's level only grows to its longest path from a routine.
      if ((level.get(edge.to) ?? -1) >= current + 1) continue;
      level.set(edge.to, current + 1);
      queue.push(edge.to);
    }
  }
  for (const node of nodes) {
    const value = level.get(node.id);
    if (node.kind === "agent" && value !== undefined) steps.set(node.id, value);
  }
  return steps;
}

export function diagramOutputPort(node: DiagramNode): DiagramPoint {
  return { x: node.position.x + DIAGRAM_NODE_WIDTH[node.kind], y: node.position.y + DIAGRAM_PORT_OFFSET_Y };
}

export function diagramInputPort(node: DiagramNode): DiagramPoint {
  return { x: node.position.x, y: node.position.y + DIAGRAM_PORT_OFFSET_Y };
}

/** A horizontal S-curve from an output port to an input port, as an SVG path. */
export function diagramEdgePath(from: DiagramPoint, to: DiagramPoint): string {
  const bend = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

/** The point halfway along `diagramEdgePath`, where an edge's controls sit. */
export function diagramEdgeMidpoint(from: DiagramPoint, to: DiagramPoint): DiagramPoint {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export function diagramBounds(nodes: readonly DiagramNode[]): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + DIAGRAM_NODE_WIDTH[node.kind]));
  const bottom = Math.max(...nodes.map((node) => node.position.y + DIAGRAM_NODE_HEIGHT[node.kind]));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
