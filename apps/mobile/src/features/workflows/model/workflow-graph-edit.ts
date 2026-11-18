import {
  WORKFLOW_PORTS,
  type WorkflowBranch,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import type { AddableKind } from "./workflow-outline";

/**
 * Where a new step goes in a workflow of any shape, the shape that the outline cannot hold:
 *
 * - `edge`: on a connection, between the two steps that it joins.
 * - `after`: after a step that has no next step, or on a path of a condition that goes nowhere yet.
 *
 * The phone edits these workflows on their graph: it changes only the edges at that place and keeps
 * every other edge, as the desktop canvas does when a card is dropped on a line.
 */
export type GraphPlace = { kind: "edge"; edgeId: string } | { kind: "after"; nodeId: string; branch?: WorkflowBranch };

/** Steps that a run goes through: they take the output of the step before and give text to the next. */
const CHAIN_KINDS = ["agent", "llm", "approval", "condition"] as const satisfies readonly AddableKind[];
const isChainKind = (kind: AddableKind): kind is (typeof CHAIN_KINDS)[number] =>
  CHAIN_KINDS.some((chain) => chain === kind);

/** Where a new step sits on the desktop canvas: near the steps that it joins, on the 8 px grid. */
const STEP_GAP = 360;
const LANE_OFFSET = 200;
const snap = (value: number) => Math.round(value / 8) * 8;

function edgeAt(graph: WorkflowGraph, place: GraphPlace): WorkflowEdge | undefined {
  return place.kind === "edge" ? graph.edges.find((edge) => edge.id === place.edgeId) : undefined;
}

/** The kinds of step that can go at a place, in the order of the Add a step page. */
export function placeKinds(graph: WorkflowGraph, place: GraphPlace, kinds: readonly AddableKind[]): AddableKind[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (place.kind === "after") {
    const from = byId.get(place.nodeId);
    const type = from ? WORKFLOW_PORTS[from.kind].out[0] : undefined;
    if (!type) return [];
    // A prompt feeds a step after it; at the end of a path there is none. A step takes what the step
    // before sends: an image step sends a picture.
    return kinds.filter((kind) => kind !== "prompt" && WORKFLOW_PORTS[kind].in.includes(type));
  }
  const edge = edgeAt(graph, place);
  const to = edge ? byId.get(edge.to) : undefined;
  if (!edge || !to) return [];
  return kinds.filter((kind) => {
    // A chain step takes what the edge carries and gives text to the step after it.
    if (isChainKind(kind))
      return WORKFLOW_PORTS[kind].in.includes(edge.type) && WORKFLOW_PORTS[to.kind].in.includes("text");
    // A prompt gives its text to the step after the edge; the edge stays.
    if (kind === "prompt") return WORKFLOW_PORTS[to.kind].in.includes("text");
    // An output takes the result of the step before the edge; the edge stays.
    return true;
  });
}

/** The graph with `node`, a new step of `kind`, at `place`, or null when the place is gone. */
export function insertAtPlace(
  graph: WorkflowGraph,
  place: GraphPlace,
  kind: AddableKind,
  node: WorkflowNode,
  newId: () => string,
): WorkflowGraph | null {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  if (place.kind === "after") {
    const from = byId.get(place.nodeId);
    if (!from) return null;
    const at = {
      x: snap(from.at.x + STEP_GAP),
      y: snap(from.at.y + (place.branch === "no" ? LANE_OFFSET : 0)),
    };
    const type = WORKFLOW_PORTS[from.kind].out[0];
    if (!type) return null;
    const edge: WorkflowEdge = {
      id: newId(),
      from: from.id,
      to: node.id,
      type,
      ...(place.branch ? { branch: place.branch } : {}),
    };
    return { ...graph, nodes: [...graph.nodes, { ...node, at }], edges: [...graph.edges, edge] };
  }
  const edge = edgeAt(graph, place);
  const from = edge ? byId.get(edge.from) : undefined;
  const to = edge ? byId.get(edge.to) : undefined;
  if (!edge || !from || !to) return null;
  const middle = { x: snap((from.at.x + to.at.x) / 2), y: snap((from.at.y + to.at.y) / 2) };
  const branch = edge.branch ? { branch: edge.branch } : {};
  if (isChainKind(kind)) {
    const into: WorkflowEdge = { id: newId(), from: from.id, to: node.id, type: edge.type, ...branch };
    // A new condition sends the flow on along its yes path; its no path goes nowhere yet.
    const onward: WorkflowEdge = {
      id: newId(),
      from: node.id,
      to: to.id,
      type: "text",
      ...(kind === "condition" ? { branch: "yes" as const } : {}),
    };
    return {
      ...graph,
      nodes: [...graph.nodes, { ...node, at: middle }],
      edges: [...graph.edges.filter((item) => item.id !== edge.id), into, onward],
    };
  }
  if (kind === "prompt") {
    const feeds: WorkflowEdge = { id: newId(), from: node.id, to: to.id, type: "text" };
    const at = { x: snap(to.at.x - STEP_GAP / 2), y: snap(to.at.y - LANE_OFFSET) };
    return { ...graph, nodes: [...graph.nodes, { ...node, at }], edges: [...graph.edges, feeds] };
  }
  const takes: WorkflowEdge = { id: newId(), from: from.id, to: node.id, type: edge.type, ...branch };
  const at = { x: snap(middle.x), y: snap(middle.y + LANE_OFFSET) };
  return { ...graph, nodes: [...graph.nodes, { ...node, at }], edges: [...graph.edges, takes] };
}

/**
 * The place right after a step: on its one way on, or after it when it has none. A step with more than
 * one way on gets a new path of its own. A condition names the path with `branch`.
 */
export function placeAfter(graph: WorkflowGraph, nodeId: string, branch?: WorkflowBranch): GraphPlace {
  // An output that only takes this step's result, and leads nowhere, is not the way on.
  const sideOutput = (id: string) =>
    graph.nodes.find((item) => item.id === id)?.kind === "output" &&
    !graph.edges.some((edge) => edge.from === id) &&
    graph.edges.filter((edge) => edge.to === id).length === 1;
  const ways = graph.edges.filter(
    (edge) => edge.from === nodeId && (branch ? edge.branch === branch : true) && !sideOutput(edge.to),
  );
  const only = ways.length === 1 ? ways[0] : undefined;
  if (only) return { kind: "edge", edgeId: only.id };
  return { kind: "after", nodeId, ...(branch ? { branch } : {}) };
}

/** A place as route parameters of the Add a step page, and back. */
export function placeParams(place: GraphPlace): Record<string, string> {
  return place.kind === "edge"
    ? { edge: place.edgeId }
    : { after: place.nodeId, ...(place.branch ? { branch: place.branch } : {}) };
}

export function placeFromParams(params: { edge?: string; after?: string; branch?: string }): GraphPlace | null {
  if (params.edge) return { kind: "edge", edgeId: params.edge };
  if (params.after)
    return {
      kind: "after",
      nodeId: params.after,
      ...(params.branch === "yes" || params.branch === "no" ? { branch: params.branch } : {}),
    };
  return null;
}
