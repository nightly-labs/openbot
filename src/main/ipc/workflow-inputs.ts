// The payloads of the workflow endpoints. Only a malformed payload fails here, so the text stays
// English; a graph that is too large is the one exception that a person can cause.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type CreateWorkflowInput,
  type DecideWorkflowStepInput,
  isCreateWorkflowInput,
  isDecideWorkflowStepInput,
  isRenameWorkflowInput,
  isRetryWorkflowStepInput,
  isRunWorkflowStepInput,
  isSaveWorkflowGraphInput,
  isStartWorkflowRunInput,
  isWorkflowRunsInput,
  isWorkflowTriggerInput,
  isWorkflowVersionInput,
  type RenameWorkflowInput,
  type RetryWorkflowStepInput,
  type RunWorkflowStepInput,
  type SaveWorkflowGraphInput,
  type StartWorkflowRunInput,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeSize,
  type WorkflowPoint,
  type WorkflowRunsInput,
  type WorkflowTriggerInput,
  type WorkflowVersionInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { requireString } from "./validation";

const point = ({ x, y }: WorkflowPoint): WorkflowPoint => ({ x, y });

function knownSize({ width, height, font }: WorkflowNodeSize): WorkflowNodeSize {
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(font === undefined ? {} : { font }),
  };
}

function knownNode(node: WorkflowNode): WorkflowNode {
  return {
    id: node.id,
    kind: node.kind,
    at: point(node.at),
    ...(node.size === undefined ? {} : { size: knownSize(node.size) }),
    ...(node.locked === undefined ? {} : { locked: node.locked }),
    fields: { ...node.fields },
    ...(node.schedule === undefined ? {} : { schedule: node.schedule }),
  };
}

function knownEdge(edge: WorkflowEdge): WorkflowEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    ...(edge.branch === undefined ? {} : { branch: edge.branch }),
  };
}

/**
 * The graph with only the keys that the contract names, so the strokes and the run versions that the
 * host keeps as JSON hold no other data. A graph larger than one frame can carry is refused.
 */
function knownGraph(graph: WorkflowGraph): WorkflowGraph {
  const known: WorkflowGraph = {
    nodes: graph.nodes.map(knownNode),
    edges: graph.edges.map(knownEdge),
    strokes: graph.strokes.map((stroke) => ({
      id: stroke.id,
      brush: stroke.brush,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points.map(point),
    })),
  };
  if (Buffer.byteLength(JSON.stringify(known)) > INPUT_LIMITS.workflowGraphBytes)
    throw new Error(sourceText("error.workflow.tooLarge"));
  return known;
}

export function parseWorkflowId(value: unknown): string {
  return requireString(value, "workflowId", INPUT_LIMITS.identifier);
}

export function parseWorkflowStepId(value: unknown): string {
  return requireString(value, "stepId", INPUT_LIMITS.identifier);
}

export function parseWorkflowRunId(value: unknown): string {
  return requireString(value, "runId", INPUT_LIMITS.identifier);
}

export function parseCreateWorkflow(value: unknown): CreateWorkflowInput {
  if (!isCreateWorkflowInput(value)) throw new Error("Invalid workflow.");
  return { title: value.title, ...(value.graph === undefined ? {} : { graph: knownGraph(value.graph) }) };
}

export function parseRenameWorkflow(value: unknown): RenameWorkflowInput {
  if (!isRenameWorkflowInput(value)) throw new Error("Invalid workflow title.");
  return { workflowId: value.workflowId, title: value.title };
}

export function parseSaveWorkflowGraph(value: unknown): SaveWorkflowGraphInput {
  if (!isSaveWorkflowGraphInput(value)) throw new Error("Invalid workflow graph.");
  return { workflowId: value.workflowId, baseRevision: value.baseRevision, graph: knownGraph(value.graph) };
}

export function parseWorkflowVersion(value: unknown): WorkflowVersionInput {
  if (!isWorkflowVersionInput(value)) throw new Error("Invalid workflow version.");
  return { workflowId: value.workflowId, versionId: value.versionId };
}

export function parseStartWorkflowRun(value: unknown): StartWorkflowRunInput {
  if (!isStartWorkflowRunInput(value)) throw new Error("Invalid workflow run.");
  return {
    workflowId: value.workflowId,
    requestId: value.requestId,
    ...(value.fromNodeId === undefined ? {} : { fromNodeId: value.fromNodeId }),
  };
}

export function parseRunWorkflowStep(value: unknown): RunWorkflowStepInput {
  if (!isRunWorkflowStepInput(value)) throw new Error("Invalid workflow step.");
  return { workflowId: value.workflowId, nodeId: value.nodeId, requestId: value.requestId };
}

export function parseRetryWorkflowStep(value: unknown): RetryWorkflowStepInput {
  if (!isRetryWorkflowStepInput(value)) throw new Error("Invalid workflow step.");
  return { stepId: value.stepId, requestId: value.requestId };
}

export function parseDecideWorkflowStep(value: unknown): DecideWorkflowStepInput {
  if (!isDecideWorkflowStepInput(value)) throw new Error("Invalid workflow decision.");
  return { stepId: value.stepId, approved: value.approved };
}

export function parseWorkflowRuns(value: unknown): WorkflowRunsInput {
  if (!isWorkflowRunsInput(value)) throw new Error("Invalid workflow runs request.");
  return {
    workflowId: value.workflowId,
    limit: value.limit,
    ...(value.before === undefined ? {} : { before: value.before }),
  };
}

export function parseWorkflowTrigger(value: unknown): WorkflowTriggerInput {
  if (!isWorkflowTriggerInput(value)) throw new Error("Invalid workflow trigger.");
  return { workflowId: value.workflowId, nodeId: value.nodeId };
}
