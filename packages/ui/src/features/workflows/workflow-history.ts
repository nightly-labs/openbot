/**
 * The undo history of the workflow canvas, and the conversion between a canvas snapshot and the saved
 * graph. A snapshot keeps the removed nodes mounted, so redo brings back what the user wrote in them;
 * the graph has only the nodes that are on the canvas.
 */

import {
  type RoutineSchedule,
  WORKFLOW_BRANCHES,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodeSize,
} from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import type { BoardSnapshot, WfnFields, WfnPoint, WfnSize } from "./workflow-board";
import type { Stroke } from "./workflow-ink";
import { defaultWorkflowModel, type WorkflowCatalogs, type WorkflowFeatures } from "./workflow-model";
import { isColor } from "./workflow-node-parts";

/** A node on the canvas. Its place, size and fields are in their own stores. */
export interface CanvasItem {
  id: string;
  kind: WorkflowNodeKind;
  /** The schedule of a trigger node, as the graph has it. */
  schedule?: RoutineSchedule | undefined;
}

/** What undo restores: the nodes in stack order, where they are, their sizes, the board, and the drawing. */
export interface CanvasSnapshot {
  nodes: readonly CanvasItem[];
  positions: Record<string, WfnPoint>;
  sizes: Record<string, WfnSize>;
  board: BoardSnapshot;
  strokes: readonly Stroke[];
}

const HISTORY_LIMIT = 100;

const itemOf = (node: WorkflowNode): CanvasItem =>
  node.schedule ? { id: node.id, kind: node.kind, schedule: node.schedule } : { id: node.id, kind: node.kind };

/** The canvas of a saved graph, with nothing selected. */
export function snapshotFromGraph(graph: WorkflowGraph): CanvasSnapshot {
  return {
    nodes: graph.nodes.map(itemOf),
    positions: Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.at.x, y: node.at.y }])),
    sizes: Object.fromEntries(graph.nodes.flatMap((node) => (node.size ? [[node.id, { ...node.size }]] : []))),
    board: {
      edges: graph.edges.map((edge) => ({ ...edge })),
      removed: [],
      locked: graph.nodes.filter((node) => node.locked).map((node) => node.id),
      selection: [],
      fields: Object.fromEntries(graph.nodes.map((node) => [node.id, { ...node.fields }])),
    },
    strokes: graph.strokes.map((stroke) => ({
      id: stroke.id,
      brush: stroke.brush === "marker" ? "marker" : "pen",
      color: isColor(stroke.color) ?? "ink",
      width: stroke.width,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  };
}

function sizeOf(size: WfnSize | undefined): WorkflowNodeSize | undefined {
  if (!size) return undefined;
  const kept: WorkflowNodeSize = {};
  if (size.width !== undefined) kept.width = size.width;
  if (size.height !== undefined) kept.height = size.height;
  if (size.font !== undefined) kept.font = size.font;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** The graph that a save writes: the nodes on the canvas in stack order, their connections and the drawing. */
export function graphFromSnapshot(snapshot: CanvasSnapshot): WorkflowGraph {
  const removed = new Set(snapshot.board.removed);
  const locked = new Set(snapshot.board.locked);
  const items = snapshot.nodes.filter((item) => !removed.has(item.id));
  const live = new Set(items.map((item) => item.id));
  const nodes = items.map((item): WorkflowNode => {
    const at = snapshot.positions[item.id] ?? { x: 0, y: 0 };
    const node: WorkflowNode = {
      id: item.id,
      kind: item.kind,
      at: { x: at.x, y: at.y },
      fields: { ...(snapshot.board.fields[item.id] ?? {}) },
    };
    const size = sizeOf(snapshot.sizes[item.id]);
    if (size) node.size = size;
    if (locked.has(item.id)) node.locked = true;
    if (item.schedule) node.schedule = item.schedule;
    return node;
  });
  const edges = snapshot.board.edges.flatMap((edge): WorkflowEdge[] => {
    if (!live.has(edge.from) || !live.has(edge.to)) return [];
    const kept: WorkflowEdge = { id: edge.id, from: edge.from, to: edge.to, type: edge.type };
    const branch = WORKFLOW_BRANCHES.find((value) => value === edge.branch);
    if (branch) kept.branch = branch;
    return [kept];
  });
  const strokes = snapshot.strokes.map((stroke) => ({
    id: stroke.id,
    brush: stroke.brush,
    color: stroke.color,
    width: stroke.width,
    points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
  }));
  return { nodes, edges, strokes };
}

/** JSON with the keys of each object in order, so two equal graphs give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    part !== null && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : part,
  );
}

/**
 * The undo and redo stacks. Each entry is the canvas before one change. A text in a field keeps its
 * own undo, so `beforeCommit` ends the typing step first.
 */
export function createCanvasHistory(options: {
  capture: () => CanvasSnapshot;
  apply: (snapshot: CanvasSnapshot) => void;
  beforeCommit: () => void;
}) {
  let past: CanvasSnapshot[] = [];
  let future: CanvasSnapshot[] = [];
  /** While above 0, changes join the step that is open, so one action is one undo. */
  let joined = 0;
  const [steps, setSteps] = createSignal({ undo: 0, redo: 0 });
  const count = () => setSteps({ undo: past.length, redo: future.length });
  /** Puts a snapshot on the undo stack, and clears redo. */
  const push = (snapshot: CanvasSnapshot) => {
    past = [...past, snapshot].slice(-HISTORY_LIMIT);
    future = [];
    count();
  };
  return {
    steps,
    /** Saves the canvas before a change. */
    commit: () => {
      options.beforeCommit();
      if (joined === 0) push(options.capture());
    },
    push,
    undo: () => {
      const saved = past.at(-1);
      if (!saved) return;
      future = [...future, options.capture()];
      past = past.slice(0, -1);
      options.apply(saved);
      count();
    },
    redo: () => {
      const saved = future.at(-1);
      if (!saved) return;
      past = [...past, options.capture()];
      future = future.slice(0, -1);
      options.apply(saved);
      count();
    },
    clear: () => {
      past = [];
      future = [];
      count();
    },
    /** Joins the next changes to the open step. The returned function ends the join. */
    join: () => {
      joined += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        joined -= 1;
      };
    },
  };
}

/**
 * The schedule of a new trigger node: each day at 09:00, as a new routine has. Each call gives a new
 * object, so a node that changes its schedule does not change the schedule of another node.
 */
export const newTriggerSchedule = () => ({ kind: "daily", time: "09:00" }) satisfies RoutineSchedule;

/** The local time zone, which a new schedule trigger runs in. */
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The fields that the host needs on a new node, with the first choice of each catalog. A node shows
 * these choices without them, but the host reads only the saved fields.
 */
export function hostDefaults(
  kind: WorkflowNodeKind,
  catalogs: WorkflowCatalogs,
  features: WorkflowFeatures,
): WfnFields {
  switch (kind) {
    case "agent": {
      const agent = catalogs.agents[0];
      return agent ? { agentId: agent.id, model: agent.model, provider: agent.provider } : {};
    }
    case "llm": {
      const model = defaultWorkflowModel(catalogs);
      return model
        ? {
            model: model.id,
            provider: model.provider,
            effort: model.defaultReasoningEffort ?? "medium",
          }
        : {};
    }
    case "image": {
      const model = catalogs.imageModels[0];
      return model ? { model: model.id } : {};
    }
    case "trigger": {
      const trigger = features.triggers.includes("schedule") ? "schedule" : features.triggers[0];
      return trigger ? { trigger, timezone: localTimeZone() } : { timezone: localTimeZone() };
    }
    case "output": {
      const target = features.outputs.includes("channel") ? "channel" : features.outputs[0];
      if (!target) return {};
      const place = catalogs.places[0];
      return target === "channel" && place
        ? { target, connectionId: place.connectionId, placeId: place.placeId }
        : { target };
    }
    default:
      return {};
  }
}
