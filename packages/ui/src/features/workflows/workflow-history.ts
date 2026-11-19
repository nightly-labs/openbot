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

export interface CanvasItem {
  id: string;
  kind: WorkflowNodeKind;
  schedule?: RoutineSchedule | undefined;
}

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

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    part !== null && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : part,
  );
}

export function createCanvasHistory(options: {
  capture: () => CanvasSnapshot;
  apply: (snapshot: CanvasSnapshot) => void;
  beforeCommit: () => void;
}) {
  type Entry = { snapshot: CanvasSnapshot; at: number };
  let past: Entry[] = [];
  let future: Entry[] = [];
  let rebases: ((snapshot: CanvasSnapshot) => CanvasSnapshot)[] = [];
  let first = 0;
  const entry = (snapshot: CanvasSnapshot): Entry => ({ snapshot, at: first + rebases.length });
  const take = (saved: Entry) =>
    rebases.slice(saved.at - first).reduce((snapshot, change) => change(snapshot), saved.snapshot);
  const prune = () => {
    const oldest = Math.min(
      first + rebases.length,
      ...past.map((saved) => saved.at),
      ...future.map((saved) => saved.at),
    );
    rebases = rebases.slice(oldest - first);
    first = oldest;
  };
  let joined = 0;
  const [steps, setSteps] = createSignal({ undo: 0, redo: 0 });
  const count = () => setSteps({ undo: past.length, redo: future.length });
  const push = (snapshot: CanvasSnapshot) => {
    past = [...past, entry(snapshot)].slice(-HISTORY_LIMIT);
    future = [];
    prune();
    count();
  };
  return {
    steps,
    commit: () => {
      options.beforeCommit();
      if (joined === 0) push(options.capture());
    },
    push,
    undo: () => {
      const saved = past.at(-1);
      if (!saved) return;
      future = [...future, entry(options.capture())];
      past = past.slice(0, -1);
      options.apply(take(saved));
      prune();
      count();
    },
    redo: () => {
      const saved = future.at(-1);
      if (!saved) return;
      past = [...past, entry(options.capture())];
      future = future.slice(0, -1);
      options.apply(take(saved));
      prune();
      count();
    },
    clear: () => {
      past = [];
      future = [];
      prune();
      count();
    },
    rebase: (change: (snapshot: CanvasSnapshot) => CanvasSnapshot) => {
      if (past.length > 0 || future.length > 0) rebases = [...rebases, change];
    },
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

export const newTriggerSchedule = () => ({ kind: "daily", time: "09:00" }) satisfies RoutineSchedule;

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function hostDefaults(
  kind: WorkflowNodeKind,
  catalogs: WorkflowCatalogs,
  features: WorkflowFeatures,
  initial?: WfnFields,
): WfnFields {
  switch (kind) {
    case "agent": {
      const agent = catalogs.agents[0];
      return agent ? { agentId: agent.id, model: agent.model, provider: agent.provider } : {};
    }
    case "llm":
    case "condition": {
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
      const media = initial?.media === "video" ? "video" : "image";
      const model = catalogs.imageModels.find((choice) => choice.kinds.includes(media));
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
