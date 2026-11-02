import type { WorkflowGraph, WorkflowNodeSize } from "@openbot/contracts/ipc";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import {
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowSummary,
} from "@openbot/team-client/workflow-decoding";
import * as Crypto from "expo-crypto";
import type { WorkspaceRequest } from "@/features/workspace/context/host-request-actions";
import { requireCapability, type ServerCapabilities } from "@/features/workspace/model/server-capabilities";
import { ignoreResponse } from "@/features/workspace/model/workspace-records";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

/** The runs that one page of the Runs list reads. */
const RUN_PAGE_SIZE = 20;

type WorkflowActions = Pick<
  MobileWorkspaceContextValue,
  | "listWorkflows"
  | "loadWorkflow"
  | "createWorkflow"
  | "renameWorkflow"
  | "deleteWorkflow"
  | "saveWorkflowGraph"
  | "loadWorkflowRuns"
  | "loadWorkflowRun"
  | "startWorkflowRun"
  | "stopWorkflowRun"
  | "retryWorkflowStep"
  | "decideWorkflowStep"
  | "rotateWorkflowWebhookSecret"
>;

/**
 * The workflows of a host, through the `workflows-v1` routes. The host checks the level of the member
 * on each agent of a workflow, so these actions do not check roles.
 */
export function createWorkflowActions({
  request,
  capabilities,
}: {
  request: WorkspaceRequest;
  capabilities: ServerCapabilities;
}): WorkflowActions {
  const send = <T>(serverId: string, path: string, decode: (value: unknown) => T, body: TeamProtocolV2Json) => {
    requireCapability(capabilities, serverId, WORKFLOWS_CAPABILITY, "mobile.workflow.unsupported");
    return request("POST", path, decode, body, serverId);
  };
  return {
    listWorkflows: (serverId) => send(serverId, WORKFLOWS_ROUTES.list, decodeRemoteWorkflowList, {}),
    loadWorkflow: (workflowId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.get, decodeRemoteWorkflowDetail, { workflowId }),
    createWorkflow: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.create, decodeRemoteWorkflowDetail, {
        title: input.title,
        ...(input.graph ? { graph: graphJson(input.graph) } : {}),
      }),
    renameWorkflow: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.rename, decodeRemoteWorkflowSummary, {
        workflowId: input.workflowId,
        title: input.title,
      }),
    deleteWorkflow: (workflowId, serverId) => send(serverId, WORKFLOWS_ROUTES.delete, ignoreResponse, { workflowId }),
    saveWorkflowGraph: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.saveGraph, decodeRemoteWorkflowSaveResult, {
        workflowId: input.workflowId,
        baseRevision: input.baseRevision,
        graph: graphJson(input.graph),
      }),
    loadWorkflowRuns: (workflowId, serverId, before) =>
      send(serverId, WORKFLOWS_ROUTES.runs, decodeRemoteWorkflowRunPage, {
        workflowId,
        limit: RUN_PAGE_SIZE,
        ...(before ? { before } : {}),
      }),
    loadWorkflowRun: (runId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.run, decodeRemoteWorkflowRunDetail, { runId }),
    // Each press is a new request: a repeat of the same request would start the run only once.
    startWorkflowRun: (workflowId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.startRun, decodeRemoteWorkflowRunDetail, {
        workflowId,
        requestId: Crypto.randomUUID(),
      }),
    stopWorkflowRun: (runId, serverId) => send(serverId, WORKFLOWS_ROUTES.stopRun, ignoreResponse, { runId }),
    retryWorkflowStep: (stepId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.retryStep, decodeRemoteWorkflowStep, { stepId, requestId: Crypto.randomUUID() }),
    decideWorkflowStep: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.decide, ignoreResponse, { stepId: input.stepId, approved: input.approved }),
    rotateWorkflowWebhookSecret: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.rotateWebhookSecret, decodeRemoteWorkflowSecret, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
      }),
  };
}

/** A graph as the request body carries it. Each optional field goes only when it is set. */
function graphJson(graph: WorkflowGraph): TeamProtocolV2Json {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      at: { x: node.at.x, y: node.at.y },
      fields: { ...node.fields },
      ...(node.size ? { size: sizeJson(node.size) } : {}),
      ...(node.locked === undefined ? {} : { locked: node.locked }),
      ...(node.schedule ? { schedule: node.schedule } : {}),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      ...(edge.branch ? { branch: edge.branch } : {}),
    })),
    strokes: graph.strokes.map((stroke) => ({
      id: stroke.id,
      brush: stroke.brush,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  };
}

function sizeJson(size: WorkflowNodeSize): TeamProtocolV2Json {
  return {
    ...(size.width === undefined ? {} : { width: size.width }),
    ...(size.height === undefined ? {} : { height: size.height }),
    ...(size.font === undefined ? {} : { font: size.font }),
  };
}
