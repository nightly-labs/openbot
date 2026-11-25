import type { WorkflowBranch, WorkflowEdge, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { ADD_KEYS, type AddKey, addFields, addKind, isFeederKind } from "./workflow-add";
import { edgeTypeFor, linkType } from "./workflow-ports";

export type GraphPlace = { kind: "edge"; edgeId: string } | { kind: "after"; nodeId: string; branch?: WorkflowBranch };

type PortNode = Pick<WorkflowNode, "kind" | "fields">;

const isChain = (node: PortNode) => node.kind !== "output" && !isFeederKind(node.kind);

const STEP_GAP = 360;
const LANE_OFFSET = 200;
const snap = (value: number) => Math.round(value / 8) * 8;

function edgeAt(graph: WorkflowGraph, place: GraphPlace): WorkflowEdge | undefined {
  return place.kind === "edge" ? graph.edges.find((edge) => edge.id === place.edgeId) : undefined;
}

function fitsPlace(graph: WorkflowGraph, place: GraphPlace, node: PortNode): boolean {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  if (place.kind === "after") {
    const from = byId.get(place.nodeId);
    return Boolean(from) && !isFeederKind(node.kind) && from !== undefined && linkType(from, node) !== null;
  }
  const edge = edgeAt(graph, place);
  const from = edge ? byId.get(edge.from) : undefined;
  const to = edge ? byId.get(edge.to) : undefined;
  if (!edge || !from || !to) return false;
  if (isFeederKind(node.kind)) return linkType(node, to) !== null;
  if (!isChain(node)) return edgeTypeFor(from, node, edge.type) !== null;
  return edgeTypeFor(from, node, edge.type) !== null && linkType(node, to) !== null;
}

export function placeKeys(graph: WorkflowGraph, place: GraphPlace): AddKey[] {
  return ADD_KEYS.filter((key) => fitsPlace(graph, place, { kind: addKind(key), fields: addFields(key) }));
}

export function insertAtPlace(
  graph: WorkflowGraph,
  place: GraphPlace,
  node: WorkflowNode,
  newId: () => string,
): WorkflowGraph | null {
  if (!fitsPlace(graph, place, node)) return null;
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  if (place.kind === "after") {
    const from = byId.get(place.nodeId);
    const type = from ? linkType(from, node) : null;
    if (!from || !type) return null;
    const at = {
      x: snap(from.at.x + STEP_GAP),
      y: snap(from.at.y + (place.branch === "no" ? LANE_OFFSET : 0)),
    };
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
  if (isFeederKind(node.kind)) {
    const type = linkType(node, to);
    if (!type) return null;
    const feeds: WorkflowEdge = { id: newId(), from: node.id, to: to.id, type };
    const at = { x: snap(to.at.x - STEP_GAP / 2), y: snap(to.at.y - LANE_OFFSET) };
    return { ...graph, nodes: [...graph.nodes, { ...node, at }], edges: [...graph.edges, feeds] };
  }
  const intoType = edgeTypeFor(from, node, edge.type);
  if (!intoType) return null;
  const into: WorkflowEdge = { id: newId(), from: from.id, to: node.id, type: intoType, ...branch };
  if (!isChain(node)) {
    const at = { x: snap(middle.x), y: snap(middle.y + LANE_OFFSET) };
    return { ...graph, nodes: [...graph.nodes, { ...node, at }], edges: [...graph.edges, into] };
  }
  const onwardType = linkType(node, to);
  if (!onwardType) return null;
  const onward: WorkflowEdge = {
    id: newId(),
    from: node.id,
    to: to.id,
    type: onwardType,
    ...(node.kind === "condition" ? { branch: "yes" as const } : {}),
  };
  return {
    ...graph,
    nodes: [...graph.nodes, { ...node, at: middle }],
    edges: [...graph.edges.filter((item) => item.id !== edge.id), into, onward],
  };
}

export function placeAfter(graph: WorkflowGraph, nodeId: string, branch?: WorkflowBranch): GraphPlace {
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
