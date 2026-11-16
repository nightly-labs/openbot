/**
 * Case bindings for workflow runs. Shared 00/01 templates isolate answers by an immutable binding
 * on the run payload. A from-node start reuses answers from one prior matching run only — never a
 * mix of answers across runs — and never falls back to workflow-wide latestDone.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowGraph } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export const WORKFLOW_RUN_BINDING_VERSION = 1 as const;

/** Explicit product/package/owner/input bindings stored on `workflow_runs.payload`. */
export interface WorkflowRunBinding {
  v: typeof WORKFLOW_RUN_BINDING_VERSION;
  caseId: string;
  product?: string;
  package?: string;
  owner?: string;
  input?: string;
}

export type WorkflowRunBindingInput = {
  caseId: string;
  product?: string;
  package?: string;
  owner?: string;
  input?: string;
};

function isBindingId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= INPUT_LIMITS.identifier;
}

/** Reads a case binding from a stored run payload, or null when absent/legacy. */
export function workflowRunBinding(payload: string | null | undefined): WorkflowRunBinding | null {
  if (payload == null || payload === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.v !== WORKFLOW_RUN_BINDING_VERSION || !isBindingId(parsed.caseId)) return null;
  return {
    v: WORKFLOW_RUN_BINDING_VERSION,
    caseId: parsed.caseId,
    ...(isBindingId(parsed.product) ? { product: parsed.product } : {}),
    ...(isBindingId(parsed.package) ? { package: parsed.package } : {}),
    ...(isBindingId(parsed.owner) ? { owner: parsed.owner } : {}),
    ...(isString(parsed.input) && parsed.input.length > 0 && parsed.input.length <= INPUT_LIMITS.workflowStepInput
      ? { input: parsed.input }
      : {}),
  };
}

/** Encodes a binding for `workflow_runs.payload`. */
export function encodeWorkflowRunBinding(input: WorkflowRunBindingInput): string {
  if (!isBindingId(input.caseId)) throw new Error("Invalid workflow case id.");
  const binding: WorkflowRunBinding = {
    v: WORKFLOW_RUN_BINDING_VERSION,
    caseId: input.caseId,
    ...(input.product !== undefined ? { product: input.product } : {}),
    ...(input.package !== undefined ? { package: input.package } : {}),
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.input !== undefined ? { input: input.input } : {}),
  };
  if (binding.product !== undefined && !isBindingId(binding.product)) throw new Error("Invalid workflow product id.");
  if (binding.package !== undefined && !isBindingId(binding.package)) throw new Error("Invalid workflow package id.");
  if (binding.owner !== undefined && !isBindingId(binding.owner)) throw new Error("Invalid workflow owner id.");
  if (
    binding.input !== undefined &&
    (!isString(binding.input) || binding.input.length === 0 || binding.input.length > INPUT_LIMITS.workflowStepInput)
  )
    throw new Error("Invalid workflow case input.");
  return JSON.stringify(binding);
}

/** Exact immutable binding match — changed input or ids cannot inherit prior answers. */
export function bindingsEqual(left: WorkflowRunBinding, right: WorkflowRunBinding): boolean {
  return (
    left.v === right.v &&
    left.caseId === right.caseId &&
    left.product === right.product &&
    left.package === right.package &&
    left.owner === right.owner &&
    left.input === right.input
  );
}

/** Incoming dependency closure of `seeds` over `edges` (node ids only; layout ignored). */
function dependencySubgraph(seeds: ReadonlySet<string>, edges: WorkflowGraph["edges"]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to);
    if (list) list.push(edge.from);
    else incoming.set(edge.to, [edge.from]);
  }
  const scope = new Set(seeds);
  const pending = [...seeds];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const from of incoming.get(id) ?? []) {
      if (scope.has(from)) continue;
      scope.add(from);
      pending.push(from);
    }
  }
  return scope;
}

/** Incoming edge semantics that feed a node (branch/loop included; layout and edge id ignored). */
function incomingEdgeKey(edge: WorkflowGraph["edges"][number]): string {
  return `${edge.from}\0${edge.type}${edge.branch === undefined ? "" : `\0${edge.branch}`}`;
}

function sortedIncomingKeys(edges: WorkflowGraph["edges"], to: string): string[] {
  return edges
    .filter((edge) => edge.to === to)
    .map(incomingEdgeKey)
    .sort();
}

/**
 * Prior answers are reusable when every answered node and its input/dependency subgraph still match
 * semantically on the live graph: kind + fields, and the same incoming dependency/branch/loop edges.
 * Scope is the union of closures over prior and current edges so a newly added upstream edge into an
 * answered node (a→b while a and b keep the same fields) cannot reuse b's old answer. Positions,
 * strokes, and edge ids do not matter.
 */
export function graphCompatibleForReuse(
  current: WorkflowGraph,
  prior: WorkflowGraph,
  answeredNodeIds: ReadonlySet<string>,
): boolean {
  if (answeredNodeIds.size === 0) return true;
  const scope = new Set([
    ...dependencySubgraph(answeredNodeIds, prior.edges),
    ...dependencySubgraph(answeredNodeIds, current.edges),
  ]);
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const priorNodes = new Map(prior.nodes.map((node) => [node.id, node]));
  for (const nodeId of scope) {
    const live = currentNodes.get(nodeId);
    const stored = priorNodes.get(nodeId);
    if (!live || !stored || live.kind !== stored.kind) return false;
    if (JSON.stringify(live.fields) !== JSON.stringify(stored.fields)) return false;
    const priorIn = sortedIncomingKeys(prior.edges, nodeId);
    const currentIn = sortedIncomingKeys(current.edges, nodeId);
    if (priorIn.length !== currentIn.length) return false;
    for (let i = 0; i < priorIn.length; i++) if (priorIn[i] !== currentIn[i]) return false;
  }
  return true;
}
