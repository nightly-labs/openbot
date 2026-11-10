/**
 * How a run moves through its graph, without the database: which nodes a run includes, which of
 * them can start now, the inputs each gets, and the text a step sends to an agent or a model.
 *
 * A node is due when it has no step in the run yet, or when a node before it has a newer step than
 * its own, as after a retry. A due node starts when no node before it is open or due. It runs when
 * at least one incoming edge is active, or when it has no incoming edge. An edge is active when the
 * node before it ended with an answer and, for a condition, when its branch is the condition's
 * answer. A due node with incoming edges and no active one is skipped, so a failure or the other
 * branch never leaves a run waiting.
 *
 * A join is a node with more than one edge from the nodes before it, apart from loop edges. When a
 * node before a join failed or was stopped, the join still runs on the other answers. At a model or
 * agent join, that node keeps its place in the inputs with the reason it has no answer, so the model
 * can see that a branch is missing. A node that was skipped because a node before it failed or was
 * stopped gives that reason too; a node after the branch that a condition did not choose gives none.
 * The other steps get only the answers: an output posts its input, and a condition or an approval
 * hands its input on to the nodes after it, outputs too.
 *
 * A loop edge (`workflowLoopEdges`) goes back to an earlier node. It does not hold that node back.
 * When it is active and newer than the node's own step, the node is due again with the loop edge's
 * answer as one more input: that is the next pass of the loop, and the nodes after it follow. A loop
 * has no pass limit; it ends when a condition takes the other branch, a step fails, or the run stops.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isWorkflowStepKind,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  workflowLoopEdges,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { runtimeFields } from "./workflow-graph";
import { isOpenStep, type StoredWorkflowStep } from "./workflow-run-store";

/** Node kinds and settings that this version cannot run. The canvas does not offer them. */
export function unsupportedNode(node: WorkflowNode): boolean {
  if (node.kind === "image" || node.kind === "asset") return true;
  if (node.kind === "trigger") return node.fields.trigger === "message";
  if (node.kind === "output") return node.fields.target === "file";
  return false;
}

export interface RunStart {
  triggerNodeId: string | null;
  fromNodeId: string | null;
}

/**
 * The nodes a run includes, and those of them it takes from an earlier answer instead of running.
 * - From a trigger: the nodes after the trigger, and every node they need that is not a trigger.
 * - From a node: that node and the nodes after it. A node they need that answered before gives that
 *   answer again; one that never answered runs. So does a node that only a loop edge brings back, so
 *   that the first pass starts at the node.
 * - Otherwise every step of the graph.
 */
export function runScope(
  graph: WorkflowGraph,
  start: RunStart,
  answered: ReadonlySet<string>,
): { nodes: Set<string>; reused: Set<string> } {
  const steps = new Map(graph.nodes.filter((node) => isWorkflowStepKind(node.kind)).map((node) => [node.id, node]));
  const origin = start.triggerNodeId ?? start.fromNodeId;
  if (origin === null || !steps.has(origin)) return { nodes: new Set(steps.keys()), reused: new Set() };
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const forward = graph.edges.filter((edge) => !loops.has(edge.id));
  const ahead = reach(origin, outgoing(forward));
  const after = reach(origin, outgoing(graph.edges));
  const before = incoming(graph.edges);
  const nodes = new Set(after);
  const reused = new Set(
    start.fromNodeId === null ? [] : [...after].filter((id) => !ahead.has(id) && answered.has(id)),
  );
  const pending = [...after].filter((id) => !reused.has(id));
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const edge of before.get(id) ?? []) {
      const source = steps.get(edge.from);
      if (!source || nodes.has(source.id)) continue;
      if (start.triggerNodeId !== null && source.kind === "trigger") continue;
      nodes.add(source.id);
      if (start.fromNodeId !== null && answered.has(source.id)) {
        reused.add(source.id);
        continue;
      }
      pending.push(source.id);
    }
  }
  // In graph order: a reused step written after the one of a node behind it would make that node due.
  return { nodes, reused: new Set(graphOrder(graph.nodes, forward, reused)) };
}

/**
 * The earlier answers that a run from a node can give again. An answer is out of date when its node
 * reads other fields or other inputs than in the graph that it ran with, or when such a node is
 * before it, so that an edit before the start node takes effect. A trigger gives its event again,
 * whatever its fields. When `ranWith` does not know the graph of an answer, the answer stays.
 */
export function currentAnswers(
  graph: WorkflowGraph,
  answered: ReadonlyMap<string, StoredWorkflowStep>,
  ranWith: (step: StoredWorkflowStep) => WorkflowGraph | undefined,
): Map<string, StoredWorkflowStep> {
  const changed = [...answered.values()].flatMap((step) => {
    const earlier = ranWith(step);
    return earlier && nodeChanged(step.nodeId, earlier, graph) ? [step.nodeId] : [];
  });
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const next = outgoing(graph.edges.filter((edge) => !loops.has(edge.id)));
  const stale = new Set(changed.flatMap((id) => [...reach(id, next)]));
  return new Map([...answered].filter(([id]) => !stale.has(id)));
}

function nodeChanged(id: string, earlier: WorkflowGraph, current: WorkflowGraph): boolean {
  const before = earlier.nodes.find((node) => node.id === id);
  const now = current.nodes.find((node) => node.id === id);
  if (!before || !now || before.kind !== now.kind) return true;
  return now.kind !== "trigger" && readsOf(before, earlier) !== readsOf(now, current);
}

/** What a step reads in a run: its run fields and the edges into it, in input order. */
function readsOf(node: WorkflowNode, graph: WorkflowGraph): string {
  const inputs = graph.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => [edge.from, edge.type, edge.branch ?? null]);
  return JSON.stringify([runtimeFields(node), inputs]);
}

export type WalkAction = { nodeId: string; action: "run"; inputs: string[] } | { nodeId: string; action: "skip" };

/**
 * What can happen now, in graph order. `latest` is the newest step of each node of the run. A node
 * whose newest step is open waits; a node that is not due is done.
 */
export function nextActions(
  graph: WorkflowGraph,
  scope: ReadonlySet<string>,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): WalkAction[] {
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const forward = graph.edges.filter((edge) => !loops.has(edge.id));
  const before = incoming(graph.edges);
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const reasons = { before, loops, latest };
  const due = new Set<string>();
  const actions: WalkAction[] = [];
  for (const nodeId of graphOrder(graph.nodes, forward, scope)) {
    const current = latest.get(nodeId);
    if (current && isOpenStep(current)) continue;
    const edges = (before.get(nodeId) ?? []).filter((edge) => scope.has(edge.from));
    const ahead = edges.filter((edge) => !loops.has(edge.id));
    const back = edges.filter((edge) => loops.has(edge.id));
    const newer = (edge: WorkflowEdge) => {
      const source = latest.get(edge.from);
      return source !== undefined && (current === undefined || source.sequence > current.sequence);
    };
    const nextPass = back.some((edge) => {
      const source = latest.get(edge.from);
      return source !== undefined && edgeActive(edge, source) && newer(edge);
    });
    if (current && !nextPass && !ahead.some(newer)) continue;
    due.add(nodeId);
    if (ahead.some((edge) => due.has(edge.from) || isWaiting(latest.get(edge.from)))) continue;
    // Another trigger's edge never becomes active in this run.
    const outside = (before.get(nodeId) ?? []).length > edges.length;
    const answered = edges.some((edge) => {
      const source = latest.get(edge.from);
      return source !== undefined && edgeActive(edge, source);
    });
    if (!answered && (ahead.length > 0 || outside)) {
      actions.push({ nodeId, action: "skip" });
      continue;
    }
    const join = isJoin(kinds.get(nodeId), before.get(nodeId) ?? [], loops);
    actions.push({ nodeId, action: "run", inputs: edgeInputs(join, edges, reasons) });
  }
  return actions;
}

/** The inputs of a node that runs alone: the newest answers of the nodes before it. */
export function soloInputs(
  graph: WorkflowGraph,
  nodeId: string,
  answered: ReadonlyMap<string, StoredWorkflowStep>,
): string[] {
  const kind = graph.nodes.find((node) => node.id === nodeId)?.kind;
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const before = incoming(graph.edges);
  const edges = before.get(nodeId) ?? [];
  return edgeInputs(isJoin(kind, edges, loops), edges, { before, loops, latest: answered });
}

/** The longest error that a missing answer quotes, in characters, so a long error costs few tokens. */
const MISSING_ERROR_LIMIT = 300;

/** What a missing answer reads to find its reason: the edges into each node and the newest steps. */
interface Reasons {
  before: ReadonlyMap<string, readonly WorkflowEdge[]>;
  loops: ReadonlySet<string>;
  latest: ReadonlyMap<string, StoredWorkflowStep>;
}

/**
 * A model or agent node with more than one edge from the nodes before it, apart from loop edges. It
 * counts every edge in the graph, so a run and a retry of the node agree.
 */
function isJoin(
  kind: WorkflowNode["kind"] | undefined,
  edges: readonly WorkflowEdge[],
  loops: ReadonlySet<string>,
): boolean {
  return (kind === "llm" || kind === "agent") && edges.filter((edge) => !loops.has(edge.id)).length > 1;
}

/**
 * The inputs of a node by its edges, in edge order: the answer of each active edge, and at a join,
 * the reason for each node before it that has no answer.
 */
function edgeInputs(join: boolean, edges: readonly WorkflowEdge[], reasons: Reasons): string[] {
  return edges.flatMap((edge) => {
    const source = reasons.latest.get(edge.from);
    if (!source) return [];
    if (edgeActive(edge, source)) return [source.output ?? ""];
    if (!join || reasons.loops.has(edge.id)) return [];
    const reason = missingAnswer(source, reasons, new Set());
    return reason ? [reason] : [];
  });
}

/**
 * Why a node before a join has no answer, or null when it chose to give none. A skipped node gives
 * the reason of the first node before it that failed or was stopped. A provider reads it, so the
 * words stay English, and the error is redacted.
 */
function missingAnswer(source: StoredWorkflowStep, reasons: Reasons, seen: Set<string>): string | null {
  if (source.status === "failed") return withError("No answer: this step failed.", source.error);
  if (source.status === "stopped") return withError("No answer: this step was stopped.", source.error);
  if (source.status !== "skipped" || seen.has(source.nodeId)) return null;
  seen.add(source.nodeId);
  for (const edge of reasons.before.get(source.nodeId) ?? []) {
    const earlier = reasons.latest.get(edge.from);
    if (reasons.loops.has(edge.id) || !earlier || earlier.status === "done") continue;
    const reason = missingAnswer(earlier, reasons, seen);
    if (reason) return reason.replace("No answer: this step", "No answer: a step before this one");
  }
  return null;
}

function withError(text: string, error: string | null | undefined): string {
  const clean = redactText(error?.trim() ?? "");
  if (!clean) return text;
  const characters = Array.from(clean);
  const quoted =
    characters.length > MISSING_ERROR_LIMIT ? `${characters.slice(0, MISSING_ERROR_LIMIT).join("")}…` : clean;
  return `${text} Error: ${quoted}`;
}

function edgeActive(edge: WorkflowEdge, source: StoredWorkflowStep): boolean {
  if (source.status !== "done") return false;
  return source.kind !== "condition" || edge.branch === source.branch;
}

function isWaiting(step: StoredWorkflowStep | undefined): boolean {
  return step === undefined || isOpenStep(step);
}

/** The nodes of `scope` with every node before another, by edges without a loop. */
function graphOrder(
  nodes: readonly WorkflowNode[],
  forward: readonly WorkflowEdge[],
  scope: ReadonlySet<string>,
): string[] {
  const edges = forward.filter((edge) => scope.has(edge.from) && scope.has(edge.to));
  const remaining = new Map([...scope].map((id) => [id, 0]));
  for (const edge of edges) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);
  const next = outgoing(edges);
  // The canvas order breaks ties, so a pass is the same each time.
  const ready = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    order.push(id);
    for (const edge of next.get(id) ?? []) {
      const left = (remaining.get(edge.to) ?? 1) - 1;
      remaining.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }
  return order;
}

/** The edges by the node they leave. */
function outgoing(edges: readonly WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  return edgesBy(edges, "from");
}

/** The edges by the node they enter. */
function incoming(edges: readonly WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  return edgesBy(edges, "to");
}

function edgesBy(edges: readonly WorkflowEdge[], end: "from" | "to"): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge[end]);
    if (list) list.push(edge);
    else map.set(edge[end], [edge]);
  }
  return map;
}

function reach(origin: string, next: ReadonlyMap<string, readonly WorkflowEdge[]>): Set<string> {
  const seen = new Set([origin]);
  const pending = [origin];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const edge of next.get(id) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      pending.push(edge.to);
    }
  }
  return seen;
}

/** A field as text, or "" when the node has none. */
export function fieldText(node: WorkflowNode, name: string): string {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
}

/** The inputs as one text, cut to the step limit. A provider reads it, so the words stay English. */
export function inputText(inputs: readonly string[]): string {
  const parts = inputs.map((input) => input.trim()).filter(Boolean);
  const text =
    parts.length <= 1 ? (parts[0] ?? "") : parts.map((part, index) => `Input ${index + 1}:\n\n${part}`).join("\n\n");
  return text.length > INPUT_LIMITS.workflowStepInput ? text.slice(0, INPUT_LIMITS.workflowStepInput) : text;
}

/** The message an agent step sends. */
export function agentStepText(workflowTitle: string, task: string, input: string): string {
  const parts = [`The workflow "${workflowTitle}" gives you one step.`];
  parts.push(task.trim() || "Do this step of the workflow with the input below.");
  if (input) parts.push(`--- input ---\n${input}`);
  return parts.join("\n\n");
}

/** The prompt of a model step: its own prompt, then the inputs. */
export function modelStepPrompt(system: string, prompt: string, input: string): string {
  return [system.trim(), prompt.trim(), input ? `--- input ---\n${input}` : ""].filter(Boolean).join("\n\n");
}

/** The prompt of a condition. The model must answer one word. */
export function conditionPrompt(rule: string, input: string): string {
  return [
    "You judge one condition of a workflow. Read the input, then answer with one English word: yes or no. Answer in English also when the condition or the input uses another language.",
    `Condition: ${rule.trim() || "The input is not empty."}`,
    `--- input ---\n${input || "(empty)"}`,
  ].join("\n\n");
}

/** The answer of a condition, or null when the model did not answer yes or no. "true" and "false" count too. */
export function conditionAnswer(text: string): "yes" | "no" | null {
  const word = /^[^a-z]*([a-z]+)/iu.exec(text.trim())?.[1]?.toLowerCase();
  if (word === "yes" || word === "true") return "yes";
  if (word === "no" || word === "false") return "no";
  return null;
}
