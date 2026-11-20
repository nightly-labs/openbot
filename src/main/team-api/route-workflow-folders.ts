import {
  parseWorkflowFolderAction,
  type WorkflowFolderAction,
  type WorkflowFolderRefusalReason,
  type WorkflowFoldersSnapshot,
  type WorkflowGraph,
  workflowFolderActionWorkflowIds,
} from "@openbot/contracts/ipc";
import {
  WORKFLOW_FOLDERS_CAPABILITY,
  WORKFLOW_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
import { WorkflowFolderChangeRefused } from "../../backend/workflow-folders-store";
import type { TeamApiAgents, TeamApiWorkflowFolders, TeamApiWorkflows } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";
import { runWorkflowEffect, workflowMissing, workflowVisibility } from "./workflow-visibility";

const NOT_FOUND: ReadonlySet<WorkflowFolderRefusalReason> = new Set(["unknown-folder", "unknown-workflow"]);
const PATHS: ReadonlySet<string> = new Set(Object.values(WORKFLOW_FOLDERS_ROUTES));

function parseAction(body: unknown): WorkflowFolderAction {
  try {
    return parseWorkflowFolderAction(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid workflow folder action.");
  }
}

function shownPlacement(snapshot: WorkflowFoldersSnapshot, shown: ReadonlySet<string>): WorkflowFoldersSnapshot {
  return {
    ...snapshot,
    placement: Object.fromEntries(Object.entries(snapshot.placement).filter(([workflowId]) => shown.has(workflowId))),
  };
}

export async function routeWorkflowFolders(
  context: TeamApiRequestContext,
  workflows: TeamApiWorkflows | undefined,
  workflowFolders: TeamApiWorkflowFolders | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !PATHS.has(url.pathname)) return "unmatched";
  if (!workflows || !capabilities.has(WORKFLOWS_CAPABILITY))
    throw new HttpError(400, sourceText("error.workflow.serverTooOld"));
  if (!workflowFolders || !capabilities.has(WORKFLOW_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.workflowFoldersUnsupported"));
  const body = await readJson(request);
  const { listed, visibleGraph, requireUsable } = workflowVisibility(context, workflows, agents, hiddenAgentIds);
  const visibleGraphs = async () => {
    const known = listed();
    const graphs = new Map<string, WorkflowGraph>();
    for (const { summary, graph } of await runWorkflowEffect(workflows.listWithGraphs()))
      if (visibleGraph(graph, known)) graphs.set(summary.id, graph);
    return graphs;
  };
  const visible = async (snapshot: WorkflowFoldersSnapshot) =>
    json(200, shownPlacement(snapshot, new Set((await visibleGraphs()).keys())));

  if (url.pathname === WORKFLOW_FOLDERS_ROUTES.read) return visible(await runWorkflowEffect(workflowFolders.read()));
  const action = parseAction(body);
  const workflowIds = workflowFolderActionWorkflowIds(action);
  if (workflowIds.length > 0) {
    const graphs = await visibleGraphs();
    for (const workflowId of new Set(workflowIds)) {
      const graph = graphs.get(workflowId);
      if (!graph) workflowMissing();
      requireUsable(graph, "manage");
    }
  }
  try {
    return visible(await runWorkflowEffect(workflowFolders.change(action)));
  } catch (error) {
    if (error instanceof WorkflowFolderChangeRefused)
      throw new HttpError(NOT_FOUND.has(error.reason) ? 404 : 400, error.message);
    throw error;
  }
}
