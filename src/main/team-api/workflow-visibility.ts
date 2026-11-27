import {
  type AgentAccessLevel,
  canAdministerServer,
  graphAgentIds,
  type WorkflowGraph,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { WorkflowStoreError } from "../../backend/workflows/workflow-store";
import type { TeamApiAgents, TeamApiWorkflows } from "./dependencies";
import { HttpError } from "./http-error";
import { isPeerHiddenProvider } from "./provider-visibility";
import type { TeamApiRequestContext } from "./request-context";
import { requireAgentLevel } from "./request-helpers";

export type WorkflowUseLevel = Exclude<AgentAccessLevel, "none">;

export function workflowMissing(): never {
  throw new HttpError(404, sourceText("error.workflow.missing"));
}

export async function runWorkflowEffect<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  try {
    return await runCauseEffect(operation);
  } catch (error) {
    if (error instanceof WorkflowStoreError) throw new HttpError(error.code === "missing" ? 404 : 400, error.message);
    if (error instanceof RoutineInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

export interface WorkflowViewer {
  admin: boolean;
  protocol: number;
  hiddenAgentIds: ReadonlySet<string>;
}

function workflowAgentsVisible(
  viewer: WorkflowViewer,
  agentIds: readonly string[],
  known: ReadonlySet<string>,
): boolean {
  return agentIds.every((agentId) => !viewer.hiddenAgentIds.has(agentId) && (viewer.admin || known.has(agentId)));
}

export function workflowGraphVisible(
  viewer: WorkflowViewer,
  graph: WorkflowGraph,
  known: ReadonlySet<string>,
): boolean {
  return (
    workflowAgentsVisible(viewer, graphAgentIds(graph), known) &&
    graph.nodes.every((node) => !isPeerHiddenProvider(node.fields.provider, viewer.protocol))
  );
}

export function workflowVisibility(
  context: TeamApiRequestContext,
  workflows: Pick<TeamApiWorkflows, "get">,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
) {
  const admin = canAdministerServer(context.member.role);
  const viewer: WorkflowViewer = { admin, protocol: context.protocol, hiddenAgentIds };
  const listed = () => new Set(agents.listAgents().map((agent) => agent.id));
  const visibleAgents = (agentIds: readonly string[], known: ReadonlySet<string>) =>
    workflowAgentsVisible(viewer, agentIds, known);
  const visibleGraph = (graph: WorkflowGraph, known: ReadonlySet<string>) => workflowGraphVisible(viewer, graph, known);
  const requireUsable = (graph: WorkflowGraph, level: WorkflowUseLevel) => {
    if (!visibleGraph(graph, listed())) workflowMissing();
    for (const agentId of graphAgentIds(graph)) requireAgentLevel(context, agentId, level);
  };
  const visibleDetail = async (workflowId: string) => {
    const detail = await runWorkflowEffect(workflows.get(workflowId));
    if (detail.needsNewerApp || !visibleGraph(detail.graph, listed())) workflowMissing();
    return detail;
  };
  const usableDetail = async (workflowId: string, level: WorkflowUseLevel) => {
    const detail = await visibleDetail(workflowId);
    requireUsable(detail.graph, level);
    return detail;
  };
  return { admin, listed, visibleAgents, visibleGraph, requireUsable, visibleDetail, usableDetail };
}

export async function visibleWorkflowIds(
  context: TeamApiRequestContext,
  workflows: Pick<TeamApiWorkflows, "get" | "listWithGraphs"> | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  if (!workflows) return new Set();
  const viewer = { admin: canAdministerServer(context.member.role), protocol: context.protocol, hiddenAgentIds };
  return new Set((await visibleWorkflowSummaries(viewer, workflows, agents)).map((summary) => summary.id));
}

export async function visibleWorkflowSummaries(
  viewer: WorkflowViewer,
  workflows: Pick<TeamApiWorkflows, "listWithGraphs">,
  agents: Pick<TeamApiAgents, "listAgents">,
): Promise<WorkflowSummary[]> {
  const known = new Set(agents.listAgents().map((agent) => agent.id));
  const all = await runWorkflowEffect(workflows.listWithGraphs());
  return all
    .filter(({ graph, needsNewerApp }) => !needsNewerApp && workflowGraphVisible(viewer, graph, known))
    .map(({ summary }) => summary);
}

export async function workflowVisibleTo(
  viewer: WorkflowViewer,
  workflows: Pick<TeamApiWorkflows, "get">,
  agents: Pick<TeamApiAgents, "listAgents">,
  workflowId: string,
): Promise<boolean> {
  const detail = await runCauseEffect(workflows.get(workflowId));
  const known = new Set(agents.listAgents().map((agent) => agent.id));
  return !detail.needsNewerApp && workflowGraphVisible(viewer, detail.graph, known);
}
