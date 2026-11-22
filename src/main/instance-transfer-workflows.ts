import {
  isWorkflowGraph,
  WORKFLOW_UNLINKED_CONNECTION,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { reason } from "./instance-transfer-preferences";

export const TRANSFER_WORKFLOWS = 200;

export interface TransferWorkflow {
  title: string;
  graph: WorkflowGraph;
  relink?: boolean;
}

export interface TransferWorkflowPort {
  workflows(): Effect.Effect<TransferWorkflow[], unknown>;
  createWorkflow(input: TransferWorkflow): Effect.Effect<unknown, unknown>;
}

export function exportWorkflows(
  workflows: readonly TransferWorkflow[],
  agentKeys: ReadonlyMap<string, string>,
  channelKeys: ReadonlyMap<string, string>,
): TransferWorkflow[] {
  return workflows.slice(0, TRANSFER_WORKFLOWS).map((workflow) => ({
    title: workflow.title,
    graph: remapGraph(workflow.graph, agentKeys, channelKeys, true),
    ...(workflow.graph.nodes.some(needsLink) ? { relink: true } : {}),
  }));
}

export const importWorkflows = Effect.fn("InstanceTransfer.importWorkflows")(function* (
  values: readonly unknown[],
  port: TransferWorkflowPort,
  agentIds: ReadonlyMap<string, string>,
  channelIds: ReadonlyMap<string, string>,
  warnings: string[],
) {
  for (const value of values.slice(0, TRANSFER_WORKFLOWS)) {
    const workflow = decodeWorkflow(value);
    if (!workflow) {
      warnings.push(sourceText("error.import.transferWorkflowInvalid"));
      continue;
    }
    const graph = remapGraph(workflow.graph, agentIds, channelIds, false);
    const created = yield* Effect.result(port.createWorkflow({ title: workflow.title, graph }));
    if (Result.isFailure(created)) {
      warnings.push(
        sourceText("error.import.transferSettingSkipped", { name: workflow.title, reason: reason(created.failure) }),
      );
      continue;
    }
    if (graph.nodes.some(isWebhookTrigger))
      warnings.push(sourceText("error.import.transferWorkflowWebhook", { name: workflow.title }));
    if (workflow.relink) warnings.push(sourceText("error.import.transferWorkflowConnection", { name: workflow.title }));
  }
});

function remapGraph(
  graph: WorkflowGraph,
  agentIds: ReadonlyMap<string, string>,
  channelIds: ReadonlyMap<string, string>,
  clearConnections: boolean,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const fields = { ...node.fields };
      if (node.kind === "agent" && typeof fields.agentId === "string")
        fields.agentId = agentIds.get(fields.agentId) ?? "";
      if (node.kind === "output" && fields.target === "chat-channel" && typeof fields.channelId === "string")
        fields.channelId = channelIds.get(fields.channelId) ?? "";
      return { ...node, fields: clearConnections && hasConnection(node) ? unlinked(fields) : fields };
    }),
  };
}

function unlinked(fields: WorkflowFields): WorkflowFields {
  return {
    ...fields,
    connectionId: WORKFLOW_UNLINKED_CONNECTION,
    ...("placeId" in fields ? { placeId: "" } : {}),
    ...("roles" in fields ? { roles: "" } : {}),
  };
}

function hasConnection(node: WorkflowNode): boolean {
  const value = node.fields.connectionId;
  return typeof value === "string" && value !== "" && value !== "trigger" && value !== WORKFLOW_UNLINKED_CONNECTION;
}

function needsLink(node: WorkflowNode): boolean {
  return hasConnection(node) || node.fields.connectionId === WORKFLOW_UNLINKED_CONNECTION;
}

function isWebhookTrigger(node: WorkflowNode): boolean {
  return node.kind === "trigger" && node.fields.trigger === "webhook";
}

function decodeWorkflow(value: unknown): TransferWorkflow | null {
  if (typeof value !== "object" || value === null || !("title" in value) || !("graph" in value)) return null;
  const { title, graph } = value;
  if (typeof title !== "string" || !title.trim() || title.length > 160 || !isWorkflowGraph(graph)) return null;
  return { title, graph, ...("relink" in value && value.relink === true ? { relink: true } : {}) };
}
