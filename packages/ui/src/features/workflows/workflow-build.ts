import type { WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { stableJson } from "./workflow-history";

export interface WorkflowBuild {
  key: number;
  workflowId: string;
  agentId: string;
  before: WorkflowGraph | null;
}

export interface WorkflowBuildStep {
  node: string;
  added: boolean;
  edges: string[];
}

export interface WorkflowBuildPlan {
  steps: WorkflowBuildStep[];
  rest: string[];
}

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
