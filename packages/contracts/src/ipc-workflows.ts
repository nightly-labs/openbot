import { INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { isRoutineSchedule, type RoutineSchedule } from "./ipc-routines";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Workflows: a canvas of nodes that a trigger starts. Any agent can be any step, and a step hands its
 * output on along the edges. A workflow belongs to a server, not to an agent. These IPC types also
 * cross the Team API through the frozen `workflows-v1` codec, so a field added here needs a new
 * capability before a joined client may read it.
 */

export const WORKFLOW_NODE_KINDS = [
  "text",
  "prompt",
  "asset",
  "llm",
  "agent",
  "image",
  "trigger",
  "condition",
  "approval",
  "output",
  "note",
  "shape",
] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** Nodes for people: a run never goes through them. */
export const WORKFLOW_ANNOTATION_KINDS = ["text", "note", "shape"] as const satisfies readonly WorkflowNodeKind[];

export function isWorkflowStepKind(kind: WorkflowNodeKind): boolean {
  return !isOneOf(WORKFLOW_ANNOTATION_KINDS, kind);
}

export const WORKFLOW_PORT_TYPES = ["text", "image", "file"] as const;
export type WorkflowPortType = (typeof WORKFLOW_PORT_TYPES)[number];

export const WORKFLOW_BRANCHES = ["yes", "no"] as const;
export type WorkflowBranch = (typeof WORKFLOW_BRANCHES)[number];

export const WORKFLOW_TRIGGER_TYPES = ["manual", "schedule", "webhook", "message"] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const WORKFLOW_OUTPUT_TARGETS = ["notify", "channel", "file"] as const;
export type WorkflowOutputTarget = (typeof WORKFLOW_OUTPUT_TARGETS)[number];

/** A value that a node keeps: a text, a choice, a number or a switch. */
export type WorkflowFieldValue = string | number | boolean;

/**
 * The fields of a node, by name. The host reads only the names its runtime needs:
 * - trigger: `trigger` (a `WorkflowTriggerType`) and `timezone`; the schedule is `WorkflowNode.schedule`.
 * - agent: `agentId`, `task`.
 * - llm: `provider`, `model`, `effort`, `prompt`, `system`.
 * - condition: `rule`, the yes-or-no question about its input.
 * - approval: `question`.
 * - output: `target` (a `WorkflowOutputTarget`); for `channel`, `connectionId` and `placeId`.
 * - prompt: `text`.
 * Every other field is view state, such as a colour or a font, and the host keeps it as it is.
 */
export type WorkflowFields = Record<string, WorkflowFieldValue>;

export interface WorkflowPoint {
  x: number;
  y: number;
}

/** A size the user set. A missing side keeps the default size of the node. */
export interface WorkflowNodeSize {
  width?: number;
  height?: number;
  /** The font size of a text node that the user scaled, in world pixels. */
  font?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  at: WorkflowPoint;
  size?: WorkflowNodeSize;
  locked?: boolean;
  fields: WorkflowFields;
  /** When a schedule trigger fires. Only a trigger node has one. */
  schedule?: RoutineSchedule;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  type: WorkflowPortType;
  /** The branch of a condition that the edge leaves from. */
  branch?: WorkflowBranch;
}

/** A line drawn on the canvas. */
export interface WorkflowStroke {
  id: string;
  brush: string;
  color: string;
  width: number;
  points: WorkflowPoint[];
}

/** Everything that a save writes. Nodes are in stack order: the last one is drawn on top. */
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  strokes: WorkflowStroke[];
}

/**
 * The edges that go back to an earlier step and so close a loop. The host runs them as the next
 * pass of the loop and the canvas draws them as loops, so both must pick the same edges. A walk goes
 * depth first from the nodes that no edge enters, then from the rest, each in canvas order; an edge
 * to a node that the walk is still inside is a loop edge. Without the loop edges, the graph has no
 * loop.
 */
export function workflowLoopEdges(
  nodes: readonly { id: string }[],
  edges: readonly { id: string; from: string; to: string }[],
): Set<string> {
  const next = new Map<string, { id: string; to: string }[]>();
  const entered = new Set<string>();
  for (const edge of edges) {
    const list = next.get(edge.from);
    if (list) list.push(edge);
    else next.set(edge.from, [edge]);
    entered.add(edge.to);
  }
  const loops = new Set<string>();
  const done = new Set<string>();
  const open = new Set<string>();
  const starts = [...nodes.filter((node) => !entered.has(node.id)), ...nodes.filter((node) => entered.has(node.id))];
  // Without recursion: a long chain must not reach the stack limit.
  for (const { id: start } of starts) {
    if (done.has(start)) continue;
    const stack = [{ id: start, index: 0 }];
    open.add(start);
    for (let top = stack.at(-1); top; top = stack.at(-1)) {
      const edge = next.get(top.id)?.[top.index];
      if (!edge) {
        stack.pop();
        open.delete(top.id);
        done.add(top.id);
        continue;
      }
      top.index += 1;
      if (open.has(edge.to)) loops.add(edge.id);
      else if (!done.has(edge.to)) {
        open.add(edge.to);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return loops;
}

export type WorkflowGraphProblem = "annotation" | "port" | "branch" | "condition-branch" | "duplicate";

const ALL_PORTS = ["text", "image", "file"] as const satisfies readonly WorkflowPortType[];

/**
 * The port types each step kind takes in and sends out. The host refuses a graph with another edge,
 * and the desktop canvas and the mobile editor offer only these, so the three read the same table.
 */
export const WORKFLOW_PORTS: Readonly<
  Record<WorkflowNodeKind, { in: readonly WorkflowPortType[]; out: readonly WorkflowPortType[] }>
> = {
  trigger: { in: [], out: ["text"] },
  prompt: { in: [], out: ["text"] },
  asset: { in: [], out: ALL_PORTS },
  llm: { in: ALL_PORTS, out: ["text"] },
  agent: { in: ALL_PORTS, out: ["text"] },
  image: { in: ["text", "image"], out: ["image"] },
  condition: { in: ["text"], out: ["text"] },
  approval: { in: ["text"], out: ["text"] },
  output: { in: ALL_PORTS, out: [] },
  text: { in: [], out: [] },
  note: { in: [], out: [] },
  shape: { in: [], out: [] },
};

/** Why one edge cannot be in a workflow that runs, or null when it can. */
export function workflowEdgeProblem(
  from: WorkflowNode,
  to: WorkflowNode,
  edge: WorkflowEdge,
): WorkflowGraphProblem | null {
  if (!isWorkflowStepKind(from.kind) || !isWorkflowStepKind(to.kind)) return "annotation";
  if (!WORKFLOW_PORTS[from.kind].out.includes(edge.type) || !WORKFLOW_PORTS[to.kind].in.includes(edge.type))
    return "port";
  if (from.kind === "condition") return edge.branch === undefined ? "condition-branch" : null;
  return edge.branch === undefined ? null : "branch";
}

/**
 * The first edge that stops the graph from running, with the reason, or null when it can run. A loop
 * is allowed: the run takes its edge back as the next pass (`workflowLoopEdges`). The shape and the
 * limits of a graph are `isWorkflowGraph`'s.
 */
export function workflowGraphProblemAt(
  graph: WorkflowGraph,
): { problem: WorkflowGraphProblem; edge: WorkflowEdge } | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    // `isWorkflowGraph` already holds every edge to two nodes of the graph.
    if (!from || !to) return { problem: "port", edge };
    const problem = workflowEdgeProblem(from, to, edge);
    if (problem) return { problem, edge };
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.type}\u0000${edge.branch ?? ""}`;
    if (seen.has(key)) return { problem: "duplicate", edge };
    seen.add(key);
  }
  return null;
}

/** Why the graph is not a workflow that can run, or null when it is. */
export function workflowGraphProblem(graph: WorkflowGraph): WorkflowGraphProblem | null {
  return workflowGraphProblemAt(graph)?.problem ?? null;
}

/** The agent of an agent node, or null for another kind or an agent node with no agent yet. */
export function nodeAgentId(node: WorkflowNode): string | null {
  const agentId = node.fields.agentId;
  return node.kind === "agent" && typeof agentId === "string" && agentId.length > 0 ? agentId : null;
}

/** The agent of each agent node of the graph. */
export function graphAgentIds(graph: WorkflowGraph): string[] {
  return graph.nodes.flatMap((node) => nodeAgentId(node) ?? []);
}

export const WORKFLOW_RUN_STATUSES = ["running", "approval", "stopping", "done", "failed", "stopped"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = ["running", "approval", "done", "failed", "stopped", "skipped"] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_RUN_SOURCES = ["manual", "schedule", "webhook"] as const;
export type WorkflowRunSource = (typeof WORKFLOW_RUN_SOURCES)[number];

export const WORKFLOW_VERSION_KINDS = ["auto", "restore", "run"] as const;
export type WorkflowVersionKind = (typeof WORKFLOW_VERSION_KINDS)[number];
/** A save adds an `auto` version when the newest version is older than this. */
export const WORKFLOW_AUTO_VERSION_INTERVAL_MS = 5 * 60_000;
/** The versions that a workflow keeps. A new version removes the oldest. */
export const WORKFLOW_MAX_VERSIONS = 50;

export interface WorkflowSummary {
  id: string;
  title: string;
  /** The nodes that a run goes through. */
  steps: number;
  updatedAt: string;
  lastRun: { status: WorkflowRunStatus; at: string } | null;
}

/** What the host knows about one trigger node: when it fires next, and its webhook address. */
export interface WorkflowTriggerState {
  nodeId: string;
  type: WorkflowTriggerType;
  /** Null while the trigger is not a schedule, or has no next time. */
  nextDueAt: string | null;
  /** Null until the relay gives the webhook an address. */
  webhookUrl: string | null;
}

export interface WorkflowDetail {
  summary: WorkflowSummary;
  graph: WorkflowGraph;
  /** Goes up by one on each save. A save from an older revision is a conflict. */
  revision: number;
  triggers: WorkflowTriggerState[];
  /**
   * Set by the client when the host sent a node kind or a port type that this app does not know.
   * The app shows such a node as a locked note and must not save the graph, as the save would drop it.
   */
  needsNewerApp?: true;
}

export interface WorkflowVersion {
  id: string;
  at: string;
  kind: WorkflowVersionKind;
  revision: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  number: number;
  /** Null for a manual run of the whole workflow. */
  triggerNodeId: string | null;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** One try of one node. A step that runs alone, outside a run, has no `runId`. */
export interface WorkflowStep {
  id: string;
  workflowId: string;
  runId: string | null;
  nodeId: string;
  attempt: number;
  agentId: string | null;
  status: WorkflowStepStatus;
  output: string | null;
  /** The answer of a condition. */
  branch: WorkflowBranch | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowStep[];
}

/** Runs newest first. The first page also carries the newest steps that ran alone. */
export interface WorkflowRunPage {
  runs: WorkflowRunDetail[];
  soloSteps: WorkflowStep[];
  /** Pass as `before` to read older runs; null on the last page. */
  nextBefore: string | null;
}

export interface CreateWorkflowInput {
  title: string;
  graph?: WorkflowGraph;
}

export interface RenameWorkflowInput {
  workflowId: string;
  title: string;
}

export interface SaveWorkflowGraphInput {
  workflowId: string;
  baseRevision: number;
  graph: WorkflowGraph;
}

export type WorkflowSaveResult = { ok: true; revision: number } | { ok: false; conflict: WorkflowDetail };

export interface WorkflowVersionInput {
  workflowId: string;
  versionId: string;
}

export interface StartWorkflowRunInput {
  workflowId: string;
  /** Repeats of one request start one run. */
  requestId: string;
  /** Runs this node and what comes after it, with the newest results of the steps before it. */
  fromNodeId?: string;
}

export interface RunWorkflowStepInput {
  workflowId: string;
  nodeId: string;
  requestId: string;
}

export interface RetryWorkflowStepInput {
  stepId: string;
  requestId: string;
}

export interface DecideWorkflowStepInput {
  stepId: string;
  approved: boolean;
}

export interface WorkflowRunsInput {
  workflowId: string;
  before?: string;
  limit: number;
}

export interface WorkflowTriggerInput {
  workflowId: string;
  nodeId: string;
}

/** A new webhook secret. The host shows it once and keeps only its ciphertext. */
export interface WorkflowWebhookSecret {
  secret: string;
}

/** The largest coordinate a node may take; far beyond any canvas a person would build. */
export const WORKFLOW_MAX_COORDINATE = 1_000_000;
const MAX_SIZE = 100_000;
const FIELD_NAME = 64;
/** `<started at>|<run id>`, as `WorkflowRunPage.nextBefore` gives it. */
const RUN_CURSOR = 64;

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= WORKFLOW_MAX_COORDINATE;
}

function isPoint(value: unknown): value is WorkflowPoint {
  return isDynamicRecord(value) && isCoordinate(value.x) && isCoordinate(value.y);
}

function isOptionalSize(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value > 0 && value <= MAX_SIZE);
}

function isNodeSize(value: unknown): value is WorkflowNodeSize {
  return (
    isDynamicRecord(value) && isOptionalSize(value.width) && isOptionalSize(value.height) && isOptionalSize(value.font)
  );
}

function isFieldValue(value: unknown): value is WorkflowFieldValue {
  return isBoolean(value) || isFiniteNumber(value) || isBoundedString(value, INPUT_LIMITS.workflowNodeText);
}

function isFields(value: unknown): value is WorkflowFields {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= INPUT_LIMITS.workflowNodeFields &&
    entries.every(([name, field]) => name.length > 0 && name.length <= FIELD_NAME && isFieldValue(field))
  );
}

export function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(WORKFLOW_NODE_KINDS, value.kind) &&
    isPoint(value.at) &&
    (value.size === undefined || isNodeSize(value.size)) &&
    (value.locked === undefined || isBoolean(value.locked)) &&
    isFields(value.fields) &&
    (value.schedule === undefined || (value.kind === "trigger" && isRoutineSchedule(value.schedule)))
  );
}

export function isWorkflowEdge(value: unknown): value is WorkflowEdge {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.from) &&
    isIdentifier(value.to) &&
    value.from !== value.to &&
    isOneOf(WORKFLOW_PORT_TYPES, value.type) &&
    (value.branch === undefined || isOneOf(WORKFLOW_BRANCHES, value.branch))
  );
}

function isStroke(value: unknown): value is WorkflowStroke {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.brush) &&
    isIdentifier(value.color) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    value.width <= MAX_SIZE &&
    Array.isArray(value.points) &&
    value.points.length <= INPUT_LIMITS.workflowStrokePoints &&
    value.points.every(isPoint)
  );
}

function uniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/**
 * The shape of a graph and its limits. Each edge must join two nodes of the graph. Rules that need
 * the meaning of the nodes, such as branch edges, are the host's.
 */
export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > INPUT_LIMITS.workflowNodes ||
    !value.nodes.every(isWorkflowNode) ||
    !Array.isArray(value.edges) ||
    value.edges.length > INPUT_LIMITS.workflowEdges ||
    !value.edges.every(isWorkflowEdge) ||
    !Array.isArray(value.strokes) ||
    value.strokes.length > INPUT_LIMITS.workflowStrokes ||
    !value.strokes.every(isStroke)
  )
    return false;
  const nodes = new Set(value.nodes.map((node) => node.id));
  return (
    nodes.size === value.nodes.length &&
    uniqueIds(value.edges) &&
    uniqueIds(value.strokes) &&
    value.edges.every((edge) => nodes.has(edge.from) && nodes.has(edge.to))
  );
}

function isTitle(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.workflowTitle) && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRevision(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isTitle(value.title) &&
    isRevision(value.steps) &&
    isString(value.updatedAt) &&
    (value.lastRun === null ||
      (isDynamicRecord(value.lastRun) &&
        isOneOf(WORKFLOW_RUN_STATUSES, value.lastRun.status) &&
        isString(value.lastRun.at)))
  );
}

function isTriggerState(value: unknown): value is WorkflowTriggerState {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.nodeId) &&
    isOneOf(WORKFLOW_TRIGGER_TYPES, value.type) &&
    isNullableString(value.nextDueAt) &&
    isNullableString(value.webhookUrl)
  );
}

export function isWorkflowDetail(value: unknown): value is WorkflowDetail {
  return (
    isDynamicRecord(value) &&
    isWorkflowSummary(value.summary) &&
    isWorkflowGraph(value.graph) &&
    isRevision(value.revision) &&
    Array.isArray(value.triggers) &&
    value.triggers.every(isTriggerState) &&
    (value.needsNewerApp === undefined || value.needsNewerApp === true)
  );
}

export function isWorkflowSaveResult(value: unknown): value is WorkflowSaveResult {
  if (!isDynamicRecord(value)) return false;
  return value.ok === true ? isRevision(value.revision) : value.ok === false && isWorkflowDetail(value.conflict);
}

export function isWorkflowVersion(value: unknown): value is WorkflowVersion {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isString(value.at) &&
    isOneOf(WORKFLOW_VERSION_KINDS, value.kind) &&
    isRevision(value.revision)
  );
}

export function isWorkflowRun(value: unknown): value is WorkflowRun {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.workflowId) &&
    integerInRange(value.number, 1, Number.MAX_SAFE_INTEGER) &&
    (value.triggerNodeId === null || isIdentifier(value.triggerNodeId)) &&
    isOneOf(WORKFLOW_RUN_SOURCES, value.source) &&
    isOneOf(WORKFLOW_RUN_STATUSES, value.status) &&
    isNullableString(value.error) &&
    isString(value.startedAt) &&
    isNullableString(value.endedAt)
  );
}

export function isWorkflowStep(value: unknown): value is WorkflowStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.workflowId) &&
    (value.runId === null || isIdentifier(value.runId)) &&
    isIdentifier(value.nodeId) &&
    integerInRange(value.attempt, 1, Number.MAX_SAFE_INTEGER) &&
    (value.agentId === null || isIdentifier(value.agentId)) &&
    isOneOf(WORKFLOW_STEP_STATUSES, value.status) &&
    isNullableString(value.output) &&
    (value.branch === null || isOneOf(WORKFLOW_BRANCHES, value.branch)) &&
    isNullableString(value.error) &&
    isNullableString(value.startedAt) &&
    isNullableString(value.endedAt)
  );
}

export function isWorkflowRunDetail(value: unknown): value is WorkflowRunDetail {
  return (
    isDynamicRecord(value) &&
    isWorkflowRun(value.run) &&
    Array.isArray(value.steps) &&
    value.steps.every(isWorkflowStep)
  );
}

export function isWorkflowRunPage(value: unknown): value is WorkflowRunPage {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.runs) &&
    value.runs.every(isWorkflowRunDetail) &&
    Array.isArray(value.soloSteps) &&
    value.soloSteps.every(isWorkflowStep) &&
    isNullableString(value.nextBefore)
  );
}

export function isCreateWorkflowInput(value: unknown): value is CreateWorkflowInput {
  return isDynamicRecord(value) && isTitle(value.title) && (value.graph === undefined || isWorkflowGraph(value.graph));
}

export function isRenameWorkflowInput(value: unknown): value is RenameWorkflowInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isTitle(value.title);
}

export function isSaveWorkflowGraphInput(value: unknown): value is SaveWorkflowGraphInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isRevision(value.baseRevision) &&
    isWorkflowGraph(value.graph)
  );
}

export function isWorkflowVersionInput(value: unknown): value is WorkflowVersionInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isIdentifier(value.versionId);
}

export function isStartWorkflowRunInput(value: unknown): value is StartWorkflowRunInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.requestId) &&
    (value.fromNodeId === undefined || isIdentifier(value.fromNodeId))
  );
}

export function isRunWorkflowStepInput(value: unknown): value is RunWorkflowStepInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.nodeId) &&
    isIdentifier(value.requestId)
  );
}

export function isRetryWorkflowStepInput(value: unknown): value is RetryWorkflowStepInput {
  return isDynamicRecord(value) && isIdentifier(value.stepId) && isIdentifier(value.requestId);
}

export function isDecideWorkflowStepInput(value: unknown): value is DecideWorkflowStepInput {
  return isDynamicRecord(value) && isIdentifier(value.stepId) && isBoolean(value.approved);
}

export function isWorkflowRunsInput(value: unknown): value is WorkflowRunsInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    (value.before === undefined || (isBoundedString(value.before, RUN_CURSOR) && value.before.length > 0)) &&
    integerInRange(value.limit, 1, INPUT_LIMITS.workflowRunsPage)
  );
}

export function isWorkflowTriggerInput(value: unknown): value is WorkflowTriggerInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isIdentifier(value.nodeId);
}

export function isWorkflowWebhookSecret(value: unknown): value is WorkflowWebhookSecret {
  return isDynamicRecord(value) && isBoundedString(value.secret, INPUT_LIMITS.identifier) && value.secret.length > 0;
}
