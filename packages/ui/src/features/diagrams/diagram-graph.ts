import type { Diagram, DiagramEdge, DiagramNode, DiagramPoint, DiagramRun } from "./diagram-model";

export const DIAGRAM_NODE_WIDTH = { routine: 264, agent: 264 } as const;
export const DIAGRAM_NODE_HEIGHT = { routine: 176, agent: 196 } as const;
export const DIAGRAM_PORT_OFFSET_Y = 26;

export type DiagramConnectionProblem = "same-node" | "into-routine" | "duplicate" | "cycle";

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

export function diagramRoutineReach(
  edges: readonly DiagramEdge[],
  routineId: string,
): { direct: string[]; nodes: number; steps: number } {
  const steps = diagramRoutineSteps(edges, routineId);
  const direct = edges.filter((edge) => edge.from === routineId).map((edge) => edge.to);
  return { direct, nodes: steps.size, steps: Math.max(0, ...steps.values()) };
}

export function diagramEdgeCarries(edge: DiagramEdge, routineId: string): boolean {
  return edge.routineId === undefined || edge.routineId === routineId;
}

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

export function diagramAgentTask(node: DiagramNode, routineId: string | null): string {
  if (node.kind !== "agent") return "";
  if (routineId && node.tasks && routineId in node.tasks) return node.tasks[routineId] ?? "";
  return node.task;
}

export function diagramLatestRun(diagram: Pick<Diagram, "lastRuns">): DiagramRun | null {
  let latest: DiagramRun | null = null;
  for (const run of diagram.lastRuns) if (!latest || run.startedAt > latest.startedAt) latest = run;
  return latest;
}

export function diagramRunOf(diagram: Pick<Diagram, "lastRuns">, routineId: string | null): DiagramRun | null {
  return diagram.lastRuns.find((run) => run.routineNodeId === routineId) ?? null;
}

export const DIAGRAM_ROUTINE_COLORS = 6;

export function diagramRoutineColor(nodes: readonly DiagramNode[], routineId: string): number {
  const index = nodes.filter((node) => node.kind === "routine").findIndex((node) => node.id === routineId);
  return Math.max(0, index) % DIAGRAM_ROUTINE_COLORS;
}

export function diagramExecutionSteps(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): Map<string, number> {
  const agents = new Set(nodes.flatMap((node) => (node.kind === "agent" ? [node.id] : [])));
  const steps = new Map<string, number>();
  for (const routine of nodes) {
    if (routine.kind !== "routine") continue;
    for (const [id, step] of diagramRoutineSteps(edges, routine.id))
      if (agents.has(id)) steps.set(id, Math.max(steps.get(id) ?? 0, step));
  }
  return steps;
}

export function diagramOutputPort(node: DiagramNode): DiagramPoint {
  return { x: node.position.x + DIAGRAM_NODE_WIDTH[node.kind], y: node.position.y + DIAGRAM_PORT_OFFSET_Y };
}

export function diagramInputPort(node: DiagramNode): DiagramPoint {
  return { x: node.position.x, y: node.position.y + DIAGRAM_PORT_OFFSET_Y };
}

export function diagramEdgePath(from: DiagramPoint, to: DiagramPoint): string {
  const bend = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

const DIAGRAM_ARROW_TIP_GAP = 6;
const DIAGRAM_ARROW_LENGTH = 9;
const DIAGRAM_ARROW_HALF_WIDTH = 5.5;

export function diagramEdgeEnd(to: DiagramPoint): DiagramPoint {
  return { x: to.x - DIAGRAM_ARROW_TIP_GAP - DIAGRAM_ARROW_LENGTH, y: to.y };
}

export function diagramEdgeArrow(to: DiagramPoint): string {
  const tip = to.x - DIAGRAM_ARROW_TIP_GAP;
  const base = tip - DIAGRAM_ARROW_LENGTH;
  return `M ${base} ${to.y - DIAGRAM_ARROW_HALF_WIDTH} L ${tip} ${to.y} L ${base} ${to.y + DIAGRAM_ARROW_HALF_WIDTH} Z`;
}

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
