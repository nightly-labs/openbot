import type { WorkflowGraph, WorkflowNodeSize } from "@openbot/contracts/ipc";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import {
  WORKFLOWS_GITHUB_RELAY_CAPABILITY,
  WORKFLOWS_GITHUB_RELAY_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-relay-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
import {
  WORKFLOWS_PAUSE_CAPABILITY,
  WORKFLOWS_PAUSE_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-pause-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import {
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowGitHubCatalog,
  decodeRemoteWorkflowGitHubHistory,
  decodeRemoteWorkflowGitHubOptions,
  decodeRemoteWorkflowGitHubRelay,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowPicture,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowSummary,
  decodeRemoteWorkflowVersionGraph,
  decodeRemoteWorkflowVersions,
  withGitHubRelay,
} from "@openbot/team-client/workflow-decoding";
import * as Crypto from "expo-crypto";
import type { WorkspaceRequest } from "@/features/workspace/context/host-request-actions";
import {
  loadWorkflowCreditBalance,
  loadWorkflowMediaModels,
  loadWorkflowMediaPrice,
} from "@/features/workspace/context/workflow-media-models";
import {
  hasCapability,
  requireCapability,
  type ServerCapabilities,
} from "@/features/workspace/model/server-capabilities";
import { ignoreResponse } from "@/features/workspace/model/workspace-records";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

const RUN_PAGE_SIZE = 20;

type WorkflowActions = Pick<
  MobileWorkspaceContextValue,
  | "listWorkflows"
  | "loadWorkflow"
  | "createWorkflow"
  | "renameWorkflow"
  | "setWorkflowPaused"
  | "deleteWorkflow"
  | "saveWorkflowGraph"
  | "loadWorkflowRuns"
  | "loadWorkflowRun"
  | "startWorkflowRun"
  | "stopWorkflowRun"
  | "runWorkflowStep"
  | "stopWorkflowStep"
  | "retryWorkflowStep"
  | "decideWorkflowStep"
  | "rotateWorkflowWebhookSecret"
  | "loadWorkflowVersions"
  | "loadWorkflowVersionGraph"
  | "restoreWorkflowVersion"
  | "loadWorkflowMediaModels"
  | "loadWorkflowMediaPrice"
  | "loadWorkflowCreditBalance"
  | "loadWorkflowGitHubCatalog"
  | "loadWorkflowGitHubOptions"
  | "loadWorkflowGitHubHistory"
  | "runWorkflowGitHubLastEvent"
  | "keepWorkflowPicture"
>;

export function createWorkflowActions({
  request,
  capabilities,
  loadAgentModels,
}: {
  request: WorkspaceRequest;
  capabilities: ServerCapabilities;
  loadAgentModels: MobileWorkspaceContextValue["loadAgentModels"];
}): WorkflowActions {
  const send = <T>(serverId: string, path: string, decode: (value: unknown) => T, body: TeamProtocolV2Json) => {
    requireCapability(capabilities, serverId, WORKFLOWS_CAPABILITY, "mobile.workflow.unsupported");
    return request("POST", path, decode, body, serverId);
  };
  const sendGitHub = <T>(serverId: string, path: string, decode: (value: unknown) => T, body: TeamProtocolV2Json) => {
    requireCapability(capabilities, serverId, WORKFLOWS_GITHUB_CAPABILITY, "mobile.workflow.github.unsupported");
    return send(serverId, path, decode, body);
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
    setWorkflowPaused: (input, serverId) => {
      requireCapability(capabilities, serverId, WORKFLOWS_PAUSE_CAPABILITY, "mobile.workflow.pause.unsupported");
      return send(serverId, WORKFLOWS_PAUSE_ROUTES.pause, decodeRemoteWorkflowSummary, {
        workflowId: input.workflowId,
        paused: input.paused,
      });
    },
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
    startWorkflowRun: (workflowId, serverId, fromNodeId) =>
      send(serverId, WORKFLOWS_ROUTES.startRun, decodeRemoteWorkflowRunDetail, {
        workflowId,
        requestId: Crypto.randomUUID(),
        ...(fromNodeId ? { fromNodeId } : {}),
      }),
    stopWorkflowRun: (runId, serverId) => send(serverId, WORKFLOWS_ROUTES.stopRun, ignoreResponse, { runId }),
    runWorkflowStep: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.runStep, decodeRemoteWorkflowStep, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        requestId: Crypto.randomUUID(),
      }),
    stopWorkflowStep: (stepId, serverId) => send(serverId, WORKFLOWS_ROUTES.stopStep, ignoreResponse, { stepId }),
    retryWorkflowStep: (stepId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.retryStep, decodeRemoteWorkflowStep, { stepId, requestId: Crypto.randomUUID() }),
    decideWorkflowStep: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.decide, ignoreResponse, { stepId: input.stepId, approved: input.approved }),
    rotateWorkflowWebhookSecret: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.rotateWebhookSecret, decodeRemoteWorkflowSecret, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
      }),
    loadWorkflowVersions: (workflowId, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.versions, decodeRemoteWorkflowVersions, { workflowId }),
    loadWorkflowVersionGraph: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.versionGraph, decodeRemoteWorkflowVersionGraph, {
        workflowId: input.workflowId,
        versionId: input.versionId,
      }),
    restoreWorkflowVersion: (input, serverId) =>
      send(serverId, WORKFLOWS_ROUTES.restoreVersion, decodeRemoteWorkflowDetail, {
        workflowId: input.workflowId,
        versionId: input.versionId,
      }),
    loadWorkflowMediaModels: (serverId) =>
      loadWorkflowMediaModels({ request, capabilities, loadAgentModels, serverId }),
    loadWorkflowMediaPrice: (input, serverId) => loadWorkflowMediaPrice({ request, capabilities, serverId, input }),
    loadWorkflowCreditBalance: (serverId) => loadWorkflowCreditBalance({ request, capabilities, serverId }),
    loadWorkflowGitHubCatalog: (serverId) =>
      withGitHubRelay(
        sendGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.catalog, decodeRemoteWorkflowGitHubCatalog, {}),
        hasCapability(capabilities, serverId, WORKFLOWS_GITHUB_RELAY_CAPABILITY)
          ? sendGitHub(serverId, WORKFLOWS_GITHUB_RELAY_ROUTES.status, decodeRemoteWorkflowGitHubRelay, {})
          : null,
      ),
    loadWorkflowGitHubOptions: (repository, serverId) =>
      sendGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.options, decodeRemoteWorkflowGitHubOptions, { repository }),
    loadWorkflowGitHubHistory: (workflowId, serverId) =>
      sendGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.history, decodeRemoteWorkflowGitHubHistory, { workflowId }),
    runWorkflowGitHubLastEvent: (input, serverId) =>
      sendGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.runLastEvent, decodeRemoteWorkflowRunDetail, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        requestId: Crypto.randomUUID(),
      }),
    keepWorkflowPicture: async (draftId, serverId) => {
      requireCapability(capabilities, serverId, WORKFLOWS_MEDIA_CAPABILITY, "mobile.workflow.asset.unsupported");
      const fileId = await send(serverId, WORKFLOWS_MEDIA_ROUTES.keepPicture, decodeRemoteWorkflowPicture, { draftId });
      return { fileId };
    },
  };
}

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
