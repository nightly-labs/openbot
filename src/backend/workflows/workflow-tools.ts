/**
 * The `openbot` tools that let an agent build, change, move and run workflows, as the canvas does.
 *
 * Each text here goes into the agent's context, so the tools stay small. A read leaves out positions,
 * sizes, strokes and view-state fields, and an edit is a list of operations, not a full graph. The
 * host places a new node when the agent gives no position. A request that the model can correct, such
 * as an unknown node or a branch edge from a node that is not a condition, is a tool failure that it
 * reads; other errors are faults.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isRoutineSchedule,
  isWorkflowGraph,
  WORKFLOW_BRANCHES,
  WORKFLOW_MAX_COORDINATE,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_PORT_TYPES,
  WORKFLOW_PORTS,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowPoint,
  type WorkflowRunDetail,
  workflowGraphProblemAt,
} from "@openbot/contracts/ipc";

import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect } from "effect";
import { z } from "zod";
import { openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import { ToolOperationFailed, toolStep } from "../agent/tool-operation";
import { runtimeFields } from "./workflow-graph";
import { WorkflowStoreError } from "./workflow-store";
import type { WorkflowsHandle } from "./workflows";

export type WorkflowTools = Pick<
  WorkflowsHandle,
  "list" | "get" | "create" | "rename" | "remove" | "saveGraph" | "startRun" | "runs" | "run"
>;

const identifier = z.string().min(1).max(INPUT_LIMITS.identifier);
const point = z.object({ x: z.number(), y: z.number() }).strict();
// Ids in an op name nodes of the graph, and the graph check holds the field limits, so the advertised
// schema leaves out lengths that only cost context.
const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
// The schedule shape is the routine schedule; `isRoutineSchedule` checks it, so its long schema stays out
// of the context and the guidance names the common forms.
const schedule = z.object({ kind: z.string() }).catchall(z.unknown());
/** Kinds an agent may add. An asset and an image node do not run yet. */
const AGENT_NODE_KINDS = WORKFLOW_NODE_KINDS.filter((kind) => kind !== "asset" && kind !== "image");

const OPS = ["add", "update", "move", "remove", "connect", "disconnect"] as const;
const opSchema = z
  .object({
    op: z.enum(OPS),
    ref: z.string().optional().describe("add: name for later ops"),
    node: z.string().optional().describe("id or ref"),
    kind: z.enum(AGENT_NODE_KINDS).optional(),
    fields: z.object({}).catchall(fieldValue).optional().describe("merged; null removes"),
    schedule: schedule.optional(),
    at: point.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    branch: z.enum(WORKFLOW_BRANCHES).optional(),
    type: z.enum(WORKFLOW_PORT_TYPES).optional(),
  })
  .strict();
export type WorkflowOp = z.infer<typeof opSchema>;

const listSchema = z.object({}).strict();
const readSchema = z.object({ workflowId: identifier, layout: z.boolean().optional() }).strict();
const editSchema = z
  .object({
    workflowId: identifier.optional(),
    title: z.string().trim().min(1).max(INPUT_LIMITS.workflowTitle).optional(),
    ops: z.array(opSchema).max(INPUT_LIMITS.workflowNodes).optional(),
    tidy: z.boolean().optional(),
  })
  .strict();
const deleteSchema = z.object({ workflowId: identifier }).strict();
const runSchema = z.object({ workflowId: identifier, fromNodeId: identifier.optional() }).strict();
const runsSchema = z
  .object({ workflowId: identifier, runId: identifier.optional(), limit: z.number().int().min(1).max(5).optional() })
  .strict();

export const WORKFLOW_TOOL_DEFINITIONS = [
  {
    name: "list_workflows",
    description: "List the workflows of this computer: id, title, step count and last run.",
    shape: listSchema.shape,
  },
  {
    name: "read_workflow",
    description:
      "Read a workflow's nodes, edges and triggers. Fields are the ones a run uses. layout adds positions and sizes.",
    shape: readSchema.shape,
  },
  {
    name: "edit_workflow",
    description:
      "Create a workflow, a canvas of steps a trigger starts (no workflowId, title required), or change one: rename, and apply ops in order to add, update, move or remove nodes and connect or disconnect them. One agent's scheduled task is a routine.",
    shape: editSchema.shape,
  },
  {
    name: "delete_workflow",
    description: "Delete a workflow, its runs and versions. Stops its open steps.",
    shape: deleteSchema.shape,
  },
  {
    name: "run_workflow",
    description: "Start a run of a workflow, or from one node with the newest answers of the nodes before it.",
    shape: runSchema.shape,
  },
  {
    name: "read_workflow_runs",
    description:
      "Read the newest runs of a workflow, or one run, with the kind, label, status and output of each step.",
    shape: runsSchema.shape,
  },
] as const;

export const WORKFLOW_TOOL_NAMES: ReadonlySet<string> = new Set(WORKFLOW_TOOL_DEFINITIONS.map((tool) => tool.name));

/**
 * The tools that change a workflow or start a run. A run can send messages and post to outside
 * services, so only a person's request starts these, as for channels and webhook routines.
 */
export const WORKFLOW_CHANGE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "edit_workflow",
  "delete_workflow",
  "run_workflow",
]);

/** The field that names a step in a run read, so that the agent does not read the workflow again. */
const LABEL_FIELD: Partial<Record<WorkflowNodeKind, string>> = {
  trigger: "trigger",
  agent: "agentId",
  llm: "prompt",
  condition: "rule",
  approval: "question",
  output: "target",
  prompt: "text",
  image: "prompt",
};
const LABEL_CHARS = 40;

/**
 * The size of each card on the canvas: the widths of "Size" in
 * `packages/ui/src/features/workflows/workflow-nodes.css` and the inline widths of the trigger and output
 * nodes. A card's height follows its content, so the heights are the usual ones. A resized card has `size`.
 */
const CARD_SIZE: Record<WorkflowNodeKind, { width: number; height: number }> = {
  trigger: { width: 320, height: 210 },
  agent: { width: 350, height: 230 },
  llm: { width: 350, height: 230 },
  condition: { width: 300, height: 200 },
  approval: { width: 300, height: 180 },
  output: { width: 320, height: 170 },
  prompt: { width: 296, height: 151 },
  image: { width: 300, height: 300 },
  asset: { width: 240, height: 240 },
  note: { width: 240, height: 240 },
  shape: { width: 208, height: 128 },
  text: { width: 240, height: 48 },
};
/** The space between two columns (the ports, their chips and a visible connection) and between two rows. */
const COLUMN_GAP = 120;
const ROW_GAP = 64;
/** Nodes that do not connect. A layout keeps them where they are. */
const ANNOTATION_KINDS: ReadonlySet<WorkflowNodeKind> = new Set(["text", "note", "shape"]);
/** A step output in a run read. A longer output costs the agent's context, and the canvas has it all. */
const OUTPUT_CHARS = 600;

/** A refusal for the model to read: its message names what to change. */
class WorkflowEditRefused extends Error {}

function refuse(message: string): never {
  throw new WorkflowEditRefused(message);
}

function compactGraph(graph: WorkflowGraph, layout: boolean) {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      fields: runtimeFields(node),
      ...(node.schedule ? { schedule: node.schedule } : {}),
      ...(node.locked ? { locked: true } : {}),
      ...(layout ? { at: node.at, size: cardSize(node) } : {}),
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.type === "text" ? {} : { type: edge.type }),
      ...(edge.branch ? { branch: edge.branch } : {}),
    })),
  };
}

const clampCoordinate = (value: number) => Math.max(-WORKFLOW_MAX_COORDINATE, Math.min(WORKFLOW_MAX_COORDINATE, value));

function cardSize(node: WorkflowNode): { width: number; height: number } {
  const usual = CARD_SIZE[node.kind];
  return { width: node.size?.width ?? usual.width, height: node.size?.height ?? usual.height };
}

/** Whether a card at `at` comes nearer to `other` than the gaps, so that a connection between them would not show. */
function crowds(node: WorkflowNode, at: WorkflowPoint, other: WorkflowNode): boolean {
  const size = cardSize(node);
  const near = cardSize(other);
  return (
    at.x < other.at.x + near.width + COLUMN_GAP &&
    other.at.x < at.x + size.width + COLUMN_GAP &&
    at.y < other.at.y + near.height + ROW_GAP &&
    other.at.y < at.y + size.height + ROW_GAP
  );
}

/** The first place at or below `at` where the card does not crowd one of the others. */
function freePlace(node: WorkflowNode, at: WorkflowPoint, others: readonly WorkflowNode[]): WorkflowPoint {
  let y = at.y;
  // Each step goes below the card in the way, and y only grows, so each card stops the card one time at most.
  for (let block = others.find((other) => crowds(node, { x: at.x, y }, other)); block; ) {
    y = block.at.y + cardSize(block).height + ROW_GAP;
    block = others.find((other) => crowds(node, { x: at.x, y }, other));
  }
  return { x: clampCoordinate(at.x), y: clampCoordinate(y) };
}

/**
 * A free place for a new node: one column right of its upstream node, at the same top, or below all nodes.
 * The "no" child of a condition starts one row lower than its "yes" child, so the two follow the ports.
 */
function placeNode(
  nodes: readonly WorkflowNode[],
  node: WorkflowNode,
  upstream: WorkflowNode | undefined,
  branch: WorkflowEdge["branch"] | undefined,
): WorkflowPoint {
  const others = nodes.filter((other) => other.id !== node.id);
  if (upstream) {
    const x = upstream.at.x + cardSize(upstream).width + COLUMN_GAP;
    const y = upstream.at.y + (branch === "no" ? cardSize(node).height + ROW_GAP : 0);
    return freePlace(node, { x, y }, others);
  }
  if (others.length === 0) return { x: 0, y: 0 };
  const x = Math.min(...others.map((other) => other.at.x));
  const y = Math.max(...others.map((other) => other.at.y + cardSize(other).height)) + ROW_GAP;
  return freePlace(node, { x, y }, others);
}

/**
 * Lays out the `moving` nodes again from left to right: a column for each step after its inputs, a
 * condition's "yes" child above its "no" child, and each child at the top of its first input. An input
 * with no input of its own, such as a prompt, goes in the column before its first step. The other nodes
 * stay, and a moving card goes below one that it would crowd.
 */
function layoutNodes(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  moving: ReadonlySet<string>,
): WorkflowNode[] {
  const flow = nodes.filter((node) => moving.has(node.id));
  if (flow.length === 0) return [...nodes];
  const inner = edges.filter((edge) => moving.has(edge.from) && moving.has(edge.to) && edge.from !== edge.to);
  const inputs = (id: string) => inner.filter((edge) => edge.to === id);
  const layer = new Map<string, number>();
  while (layer.size < flow.length) {
    const open = flow.filter((node) => !layer.has(node.id));
    const ready = open.filter((node) => inputs(node.id).every((edge) => layer.has(edge.from)));
    // A cycle leaves no node ready; then its first node counts only the inputs that have a column.
    for (const node of ready.length > 0 ? ready : open.slice(0, 1))
      layer.set(node.id, Math.max(-1, ...inputs(node.id).map((edge) => layer.get(edge.from) ?? -1)) + 1);
  }
  for (const node of flow) {
    if (node.kind === "trigger" || inputs(node.id).length > 0) continue;
    const next = inner.filter((edge) => edge.from === node.id).map((edge) => layer.get(edge.to) ?? 0);
    if (next.length > 0) layer.set(node.id, Math.max(0, Math.min(...next) - 1));
  }

  const columns = Math.max(...layer.values()) + 1;
  const left = Math.min(...flow.map((node) => node.at.x));
  const top = Math.min(...flow.map((node) => node.at.y));
  const xs: number[] = [];
  for (let column = 0, x = left; column < columns; column += 1) {
    xs.push(x);
    const widths = flow.filter((node) => layer.get(node.id) === column).map((node) => cardSize(node).width);
    x += Math.max(0, ...widths) + COLUMN_GAP;
  }

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const kept = nodes.filter((node) => !moving.has(node.id));
  const done = new Map<string, WorkflowNode>();
  for (let column = 0; column < columns; column += 1) {
    const ranked = flow
      .filter((node) => layer.get(node.id) === column)
      .map((node) => {
        const placed = inputs(node.id).flatMap((edge) => {
          const from = done.get(edge.from);
          return from ? [{ y: from.at.y, branch: edge.branch === "no" ? 1 : 0 }] : [];
        });
        const first = placed.sort((a, b) => a.y - b.y || a.branch - b.branch)[0];
        return { node, y: first?.y ?? top, branch: first?.branch ?? 0 };
      })
      .sort((a, b) => a.y - b.y || a.branch - b.branch || (order.get(a.node.id) ?? 0) - (order.get(b.node.id) ?? 0));
    let below = Number.NEGATIVE_INFINITY;
    for (const { node, y } of ranked) {
      const at = freePlace(node, { x: xs[column] ?? left, y: Math.max(y, below) }, [...kept, ...done.values()]);
      done.set(node.id, { ...node, at });
      below = at.y + cardSize(node).height + ROW_GAP;
    }
  }
  return nodes.map((node) => done.get(node.id) ?? node);
}

function mergeFields(fields: WorkflowNode["fields"], patch: WorkflowOp["fields"]): WorkflowNode["fields"] {
  const next = { ...fields };
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (value === null || value === undefined) delete next[name];
    else next[name] = value;
  }
  return next;
}

function checkedSchedule(value: WorkflowOp["schedule"]) {
  if (value === undefined) return undefined;
  if (!isRoutineSchedule(value)) refuse("The schedule is not a valid routine schedule.");
  return value;
}

/**
 * A new schedule makes a manual trigger a schedule trigger, and a schedule trigger with no schedule
 * gets the default one, so that the trigger runs on the schedule that the agent gave.
 */
function withSchedule(node: WorkflowNode, scheduled: ReturnType<typeof checkedSchedule>): WorkflowNode {
  if (node.kind !== "trigger") return node;
  const fields = scheduled && node.fields.trigger === "manual" ? { ...node.fields, trigger: "schedule" } : node.fields;
  const schedule =
    scheduled ?? node.schedule ?? (fields.trigger === "schedule" ? { kind: "daily", time: "09:00" } : undefined);
  return { ...node, fields, ...(schedule ? { schedule } : {}) };
}

/** The fields that the host needs on a new node when the agent leaves them out. */
function newNodeFields(kind: WorkflowNodeKind): WorkflowNode["fields"] {
  if (kind === "trigger") return { trigger: "manual" };
  if (kind === "output") return { target: "notify" };
  return {};
}

function edgeId(from: string, to: string, type: string, branch: string | undefined): string {
  // The canvas names an edge by its ends, so one edge has one id on each device.
  return `${from}${branch ? `.${branch}` : ""}>${to}:${type}`;
}

/**
 * Applies the operations to a copy of the graph. Returns the new graph and the node id of each ref.
 * Throws `WorkflowEditRefused` with a message for the model when an operation cannot apply.
 */
function applyWorkflowOps(
  graph: WorkflowGraph,
  ops: readonly WorkflowOp[],
  agentIds: ReadonlySet<string>,
  tidy = false,
): { graph: WorkflowGraph; ids: Record<string, string> } {
  let nodes = graph.nodes.map((node) => ({ ...node }));
  let edges = [...graph.edges];
  const ids: Record<string, string> = {};
  const resolve = (ref: string | undefined, op: number) => {
    if (ref === undefined) refuse(`Op ${op}: name the node.`);
    const id = ids[ref] ?? ref;
    const node = nodes.find((item) => item.id === id);
    if (!node) refuse(`Op ${op}: no node ${ref}.`);
    return node;
  };
  const checkAgent = (fields: WorkflowNode["fields"], op: number) => {
    const agentId = fields.agentId;
    if (typeof agentId === "string" && agentId.length > 0 && !agentIds.has(agentId))
      refuse(`Op ${op}: unknown agent ${agentId}.`);
  };
  const replace = (next: WorkflowNode) => {
    nodes = nodes.map((node) => (node.id === next.id ? next : node));
  };
  /** New nodes that the host placed, in add order, and nodes whose position the agent gave. */
  const placed: { id: string; withFrom: boolean }[] = [];
  const pinned = new Set<string>();

  ops.forEach((op, index) => {
    const n = index + 1;
    switch (op.op) {
      case "add": {
        if (!op.kind) refuse(`Op ${n}: add needs kind.`);
        if (op.ref !== undefined && ids[op.ref] !== undefined) refuse(`Op ${n}: ref ${op.ref} is already used.`);
        const id = `${op.kind}-${crypto.randomUUID()}`;
        const fields = mergeFields(newNodeFields(op.kind), op.fields);
        checkAgent(fields, n);
        const scheduled = checkedSchedule(op.schedule);
        if (scheduled && op.kind !== "trigger") refuse(`Op ${n}: only a trigger has a schedule.`);
        const node = withSchedule({ id, kind: op.kind, at: { x: 0, y: 0 }, fields }, scheduled);
        const upstream = op.from === undefined ? undefined : resolve(op.from, n);
        node.at = op.at
          ? { x: clampCoordinate(op.at.x), y: clampCoordinate(op.at.y) }
          : placeNode(nodes, node, upstream, op.branch);
        nodes.push(node);
        if (op.at) pinned.add(id);
        else placed.push({ id, withFrom: upstream !== undefined });
        if (op.ref !== undefined) ids[op.ref] = id;
        if (upstream) edges.push(newEdge(upstream, node, op.type, op.branch, n));
        return;
      }
      case "update": {
        const node = resolve(op.node, n);
        const fields = mergeFields(node.fields, op.fields);
        checkAgent(fields, n);
        const scheduled = checkedSchedule(op.schedule);
        if (scheduled && node.kind !== "trigger") refuse(`Op ${n}: only a trigger has a schedule.`);
        replace(withSchedule({ ...node, fields }, scheduled));
        return;
      }
      case "move": {
        const node = resolve(op.node, n);
        if (node.locked) refuse(`Op ${n}: node ${node.id} is locked.`);
        if (!op.at) refuse(`Op ${n}: move needs at.`);
        replace({ ...node, at: { x: clampCoordinate(op.at.x), y: clampCoordinate(op.at.y) } });
        pinned.add(node.id);
        return;
      }
      case "remove": {
        const node = resolve(op.node, n);
        if (node.locked) refuse(`Op ${n}: node ${node.id} is locked.`);
        nodes = nodes.filter((item) => item.id !== node.id);
        edges = edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
        return;
      }
      case "connect": {
        const from = resolve(op.from, n);
        const to = resolve(op.to, n);
        const edge = newEdge(from, to, op.type, op.branch, n);
        if (!edges.some((item) => item.id === edge.id)) edges.push(edge);
        return;
      }
      case "disconnect": {
        const before = edges.length;
        const from = resolve(op.from, n).id;
        const to = resolve(op.to, n).id;
        edges = edges.filter((edge) => edge.from !== from || edge.to !== to);
        if (edges.length === before) refuse(`Op ${n}: no edge from ${op.from} to ${op.to}.`);
        return;
      }
    }
  });
  // A workflow with no steps before this call, or a tidy, gets a full layout; a change to others only places its new nodes.
  const empty = graph.nodes.every((node) => ANNOTATION_KINDS.has(node.kind));
  if (tidy || empty) {
    const fixed = (node: WorkflowNode) =>
      ANNOTATION_KINDS.has(node.kind) || node.locked === true || pinned.has(node.id);
    const moving = new Set(
      nodes
        .filter((node) => !fixed(node) && (tidy || placed.some((item) => item.id === node.id)))
        .map((node) => node.id),
    );
    nodes = layoutNodes(nodes, edges, moving);
  } else nodes = arrangeInserted(nodes, edges, placed, pinned);
  return { graph: { ...graph, nodes, edges }, ids };
}

/**
 * Places again each new node that a later op connected: a node inserted before existing nodes moves
 * them and the nodes after them one column right, and a node added without from goes right of the
 * node that a later connect gave it. Locked nodes and nodes that the agent placed stay.
 */
function arrangeInserted(
  start: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  placed: readonly { id: string; withFrom: boolean }[],
  pinned: ReadonlySet<string>,
): WorkflowNode[] {
  let nodes = [...start];
  const added = new Set(placed.map((item) => item.id));
  const byId = (id: string) => nodes.find((node) => node.id === id);
  for (const { id, withFrom } of placed) {
    const node = byId(id);
    const source = edges.find((edge) => edge.to === id);
    const upstream = source ? byId(source.from) : undefined;
    if (!node || !upstream) continue;
    const later = edges.filter((edge) => edge.from === id && !added.has(edge.to)).map((edge) => edge.to);
    if (withFrom && later.length === 0) continue;
    const column = upstream.at.x + cardSize(upstream).width + COLUMN_GAP;
    const nearest = Math.min(...later.map((target) => byId(target)?.at.x ?? Number.POSITIVE_INFINITY));
    const shift = column + cardSize(node).width + COLUMN_GAP - nearest;
    if (shift > 0) {
      // The nodes after the insert, through the edges; the visited set ends a walk on a cycle.
      const moving = new Set<string>();
      const queue = [...later];
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (next === id || moving.has(next)) continue;
        moving.add(next);
        queue.push(...edges.filter((edge) => edge.from === next).map((edge) => edge.to));
      }
      nodes = nodes.map((item) =>
        moving.has(item.id) && !item.locked && !pinned.has(item.id)
          ? { ...item, at: { x: clampCoordinate(item.at.x + shift), y: item.at.y } }
          : item,
      );
    }
    const at = placeNode(nodes, node, upstream, source?.branch);
    nodes = nodes.map((item) => (item.id === id ? { ...item, at } : item));
  }
  return nodes;
}

function newEdge(
  from: WorkflowNode,
  to: WorkflowNode,
  type: WorkflowEdge["type"] | undefined,
  branch: WorkflowEdge["branch"] | undefined,
  op: number,
): WorkflowEdge {
  if (from.id === to.id) refuse(`Op ${op}: a node cannot connect to itself.`);
  const port =
    type ?? WORKFLOW_PORTS[from.kind].out.find((candidate) => WORKFLOW_PORTS[to.kind].in.includes(candidate));
  if (!port) refuse(`Op ${op}: ${from.kind} cannot connect to ${to.kind}.`);
  return {
    id: edgeId(from.id, to.id, port, branch),
    from: from.id,
    to: to.id,
    type: port,
    ...(branch ? { branch } : {}),
  };
}

const PROBLEM_TEXT: Record<string, string> = {
  annotation: "text, note and shape nodes cannot connect",
  port: "the nodes have no matching port of this type",
  "condition-branch": "an edge from a condition needs branch yes or no",
  branch: "only an edge from a condition has a branch",
  duplicate: "the edge is there twice",
};

/** The first rule that the graph breaks, as a sentence for the model, or null. */
function graphProblem(graph: WorkflowGraph): string | null {
  if (!isWorkflowGraph(graph)) return "The workflow is over a limit or has an invalid node or field.";
  const found = workflowGraphProblemAt(graph);
  if (!found) return null;
  return `Edge ${found.edge.from} -> ${found.edge.to}: ${PROBLEM_TEXT[found.problem] ?? found.problem}.`;
}

function stepLabel(node: WorkflowNode | undefined) {
  if (!node) return {};
  const field = LABEL_FIELD[node.kind];
  const value = field === undefined ? undefined : node.fields[field];
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text
    ? { kind: node.kind, label: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text }
    : { kind: node.kind };
}

/** A step of a node that the workflow no longer has gives only its node id. */
function compactRun(detail: WorkflowRunDetail, nodes: ReadonlyMap<string, WorkflowNode>) {
  return {
    runId: detail.run.id,
    number: detail.run.number,
    status: detail.run.status,
    ...(detail.run.error ? { error: detail.run.error } : {}),
    startedAt: detail.run.startedAt,
    steps: detail.steps.map((step) => ({
      nodeId: step.nodeId,
      ...stepLabel(nodes.get(step.nodeId)),
      status: step.status,
      ...(step.branch ? { branch: step.branch } : {}),
      ...(step.error ? { error: step.error } : {}),
      ...(step.output
        ? {
            output: step.output.length > OUTPUT_CHARS ? `${step.output.slice(0, OUTPUT_CHARS)}… (cut)` : step.output,
          }
        : {}),
    })),
  };
}

export const handleWorkflowTool = Effect.fn("WorkflowTools.handle")(function* (
  tool: string,
  args: unknown,
  workflows: WorkflowTools | null,
  /** The agent that calls the tool. The change event names it, so an open canvas shows its build. */
  callerId: string,
  /** The same for each delivery of one tool call. A run takes it as its key, so a repeated call starts no second run. */
  callKey: string,
  agentIds: ReadonlySet<string>,
  /** Asks the user to approve the delete of the named workflow. Each delete asks, also with Full access. */
  confirmDelete: (title: string) => Effect.Effect<boolean, ToolOperationFailed>,
) {
  if (!WORKFLOW_TOOL_NAMES.has(tool)) return null;
  if (!workflows) return yield* new ToolOperationFailed({ cause: new Error("Workflows are unavailable.") });

  /** Applies the ops on the newest revision, and once more on the graph of a conflict. */
  const save = Effect.fn("WorkflowTools.save")(function* (
    workflowId: string,
    ops: readonly WorkflowOp[],
    tidy: boolean,
  ) {
    let detail = yield* workflows.get(workflowId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const applied = yield* toolStep(() => applyWorkflowOps(detail.graph, ops, agentIds, tidy));
      const problem = graphProblem(applied.graph);
      if (problem) return yield* toolStep(() => refuse(problem));
      const result = yield* workflows.saveGraph(
        { workflowId, baseRevision: detail.revision, graph: applied.graph },
        callerId,
      );
      if (result.ok) return { revision: result.revision, ids: applied.ids };
      detail = result.conflict;
    }
    return yield* toolStep(() => refuse("The workflow changed during the edit. Read it and try again."));
  });

  const operation = Effect.gen(function* () {
    if (tool === "list_workflows") {
      yield* toolStep(() => listSchema.parse(args ?? {}));
      const summaries = yield* workflows.list();
      return openBotToolResult(
        summaries.map((summary) => ({
          workflowId: summary.id,
          title: summary.title,
          steps: summary.steps,
          ...(summary.lastRun ? { lastRun: summary.lastRun } : {}),
        })),
      );
    }
    if (tool === "read_workflow") {
      const input = yield* toolStep(() => readSchema.parse(args));
      const detail = yield* workflows.get(input.workflowId);
      return openBotToolResult({
        title: detail.summary.title,
        revision: detail.revision,
        ...compactGraph(detail.graph, input.layout === true),
        triggers: detail.triggers.map((trigger) => ({
          nodeId: trigger.nodeId,
          type: trigger.type,
          ...(trigger.nextDueAt ? { nextDueAt: trigger.nextDueAt } : {}),
          ...(trigger.webhookUrl ? { webhookUrl: trigger.webhookUrl } : {}),
        })),
      });
    }
    if (tool === "edit_workflow") {
      const input = yield* toolStep(() => editSchema.parse(args));
      const ops = input.ops ?? [];
      const tidy = input.tidy === true;
      const workflowId = input.workflowId;
      // A new workflow is made with its graph in one step, so a refused op leaves no empty workflow.
      if (workflowId === undefined) {
        if (input.title === undefined) return openBotToolFailure("A new workflow needs a title.");
        const applied = yield* toolStep(() =>
          applyWorkflowOps({ nodes: [], edges: [], strokes: [] }, ops, agentIds, tidy),
        );
        const problem = graphProblem(applied.graph);
        if (problem) return openBotToolFailure(problem);
        const created = yield* workflows.create({ title: input.title, graph: applied.graph }, callerId);
        return openBotToolResult({
          workflowId: created.summary.id,
          revision: created.revision,
          ...(Object.keys(applied.ids).length > 0 ? { ids: applied.ids } : {}),
        });
      }
      // The rename comes after the ops, so a refused edit changes nothing.
      const saved = ops.length > 0 || tidy ? yield* save(workflowId, ops, tidy) : null;
      if (input.title !== undefined) yield* workflows.rename({ workflowId, title: input.title });
      if (!saved) return openBotToolResult({ workflowId });
      return openBotToolResult({
        workflowId,
        revision: saved.revision,
        ...(Object.keys(saved.ids).length > 0 ? { ids: saved.ids } : {}),
      });
    }
    if (tool === "delete_workflow") {
      const input = yield* toolStep(() => deleteSchema.parse(args));
      const detail = yield* workflows.get(input.workflowId);
      if (!(yield* confirmDelete(detail.summary.title)))
        return openBotToolFailure("The user declined the delete. Do not try again unless they ask.");
      yield* workflows.remove(input.workflowId);
      return openBotToolResult({ removed: input.workflowId });
    }
    if (tool === "run_workflow") {
      const input = yield* toolStep(() => runSchema.parse(args));
      const detail = yield* workflows.startRun({
        workflowId: input.workflowId,
        requestId: callKey,
        ...(input.fromNodeId === undefined ? {} : { fromNodeId: input.fromNodeId }),
      });
      return openBotToolResult({ runId: detail.run.id, number: detail.run.number, status: detail.run.status });
    }
    const input = yield* toolStep(() => runsSchema.parse(args));
    const nodes = new Map((yield* workflows.get(input.workflowId)).graph.nodes.map((node) => [node.id, node]));
    if (input.runId !== undefined) {
      const detail = yield* workflows.run(input.runId);
      if (detail.run.workflowId !== input.workflowId)
        return openBotToolFailure(`No run ${input.runId} in this workflow.`);
      return openBotToolResult(compactRun(detail, nodes));
    }
    const page = yield* workflows.runs({ workflowId: input.workflowId, limit: input.limit ?? 1 });
    return openBotToolResult({ runs: page.runs.map((detail) => compactRun(detail, nodes)) });
  });

  return yield* operation.pipe(
    Effect.catchTag("WorkflowFailed", (failure) =>
      failure.cause instanceof WorkflowStoreError || failure.cause instanceof RoutineInputError
        ? Effect.succeed(openBotToolFailure(failure.cause.message))
        : Effect.fail(new ToolOperationFailed({ cause: failure.cause })),
    ),
    Effect.catchTag("ToolOperationFailed", (failure) =>
      failure.cause instanceof WorkflowEditRefused
        ? Effect.succeed(openBotToolFailure(failure.cause.message))
        : Effect.fail(failure),
    ),
  );
});
