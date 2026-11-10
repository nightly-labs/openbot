// The workflows of the server in an instance transfer file, with the server settings. A workflow
// names agents, channels and messaging connections by id. The file names an agent or a channel by its
// key in the file, and the import puts the id of its copy there. A step whose agent or channel is not
// in the file is left empty, as a new step is. A messaging connection and a webhook address belong to
// the other computer: the import leaves them empty and asks the user to choose them again.

import { isWorkflowGraph, type WorkflowGraph, type WorkflowNode } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { reason } from "./instance-transfer-preferences";

/** The most workflows a file carries. */
export const TRANSFER_WORKFLOWS = 200;

export interface TransferWorkflow {
  title: string;
  graph: WorkflowGraph;
  /** The export left a messaging connection empty: the user chooses it again. */
  relink?: boolean;
}

export interface TransferWorkflowPort {
  workflows(): Effect.Effect<TransferWorkflow[], unknown>;
  createWorkflow(input: TransferWorkflow): Effect.Effect<unknown, unknown>;
}

/** The workflows as the file keeps them. */
export function exportWorkflows(
  workflows: readonly TransferWorkflow[],
  agentKeys: ReadonlyMap<string, string>,
  channelKeys: ReadonlyMap<string, string>,
): TransferWorkflow[] {
  return workflows.slice(0, TRANSFER_WORKFLOWS).map((workflow) => ({
    title: workflow.title,
    graph: remapGraph(workflow.graph, agentKeys, channelKeys, true),
    ...(workflow.graph.nodes.some(hasConnection) ? { relink: true } : {}),
  }));
}

/** Adds the workflows of the file. One that this computer refuses is a warning. */
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

/**
 * The graph with each agent and channel id passed through `ids`. An id with no entry becomes empty.
 * On export, a messaging connection becomes empty too; "trigger" names the trigger's own and stays.
 */
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
      if (clearConnections && hasConnection(node)) fields.connectionId = "";
      return { ...node, fields };
    }),
  };
}

function hasConnection(node: WorkflowNode): boolean {
  const value = node.fields.connectionId;
  return typeof value === "string" && value !== "" && value !== "trigger";
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
