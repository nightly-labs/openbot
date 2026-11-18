/**
 * A change that an agent saved, as steps that the canvas plays one after the other: the agent's cursor
 * goes to each node that it made, changed or moved, the node shows, and then the connections that the
 * node completes. The host gives only the graph before and after the change, so the steps follow the
 * order of the nodes in the graph. A new node comes last in it, in the order of the agent's operations.
 */

import type { WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { stableJson } from "./workflow-history";

export interface WorkflowBuild {
  /** A new key plays the change, also for the same workflow. */
  key: number;
  workflowId: string;
  /** The agent that saved the change. Its cursor has its name and the colour of its avatar. */
  agentId: string;
  /** The graph before the change, or null for a workflow that the agent made. */
  before: WorkflowGraph | null;
}

export interface WorkflowBuildStep {
  node: string;
  /** A new node is hidden until its step. */
  added: boolean;
  /** The new connections that show at this step: the last of their two ends is this node. */
  edges: string[];
}

export interface WorkflowBuildPlan {
  steps: WorkflowBuildStep[];
  /** The new connections between two nodes that did not change. They show at the end. */
  rest: string[];
}

/** What the agent can change on a node: its kind, its place, its fields and its schedule. */
const look = (node: WorkflowNode) => stableJson([node.kind, node.at, node.fields, node.schedule ?? null]);

export function workflowBuildPlan(before: WorkflowGraph | null, next: WorkflowGraph): WorkflowBuildPlan {
  const old = new Map((before?.nodes ?? []).map((node) => [node.id, look(node)]));
  const oldEdges = new Set((before?.edges ?? []).map((edge) => edge.id));
  const steps: WorkflowBuildStep[] = next.nodes
    .filter((node) => old.get(node.id) !== look(node))
    .map((node) => ({ node: node.id, added: !old.has(node.id), edges: [] }));
  const order = new Map(steps.map((step, index) => [step.node, index]));
  const rest: string[] = [];
  for (const edge of next.edges) {
    if (oldEdges.has(edge.id)) continue;
    const step = steps[Math.max(order.get(edge.from) ?? -1, order.get(edge.to) ?? -1)];
    if (step) step.edges.push(edge.id);
    else rest.push(edge.id);
  }
  return { steps, rest };
}
