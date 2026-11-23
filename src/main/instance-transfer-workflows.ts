import {
  type CreateWorkflowInput,
  isWorkflowGraph,
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowIdKind,
  workflowFormatIsNewer,
  workflowGraphFormat,
  workflowGraphPlaceholders,
  workflowIdFields,
  workflowIdFollowsTrigger,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { reason } from "./instance-transfer-preferences";
import { parseCreateWorkflow } from "./ipc/workflow-inputs";

export const TRANSFER_WORKFLOWS = 200;

export interface TransferWorkflow {
  title: string;
  graph: WorkflowGraph;
  format?: number;
  relink?: boolean;
}

export interface TransferWorkflowPort {
  workflows(): Effect.Effect<{ title: string; graph: WorkflowGraph }[], unknown>;
  createWorkflow(input: CreateWorkflowInput): Effect.Effect<unknown, unknown>;
}

type IdMaps = Readonly<Partial<Record<WorkflowIdKind, ReadonlyMap<string, string>>>>;

const EXPORT_CLEARS: ReadonlySet<WorkflowIdKind> = new Set(["connection", "file"]);
const IMPORT_CLEARS: ReadonlySet<WorkflowIdKind> = new Set(["file"]);
const TITLE_LIMIT = 160;

export function exportWorkflows(
  workflows: readonly { title: string; graph: WorkflowGraph }[],
  agentKeys: ReadonlyMap<string, string>,
  channelKeys: ReadonlyMap<string, string>,
): TransferWorkflow[] {
  return workflows.slice(0, TRANSFER_WORKFLOWS).map((workflow) => ({
    title: workflow.title,
    graph: remapGraph(workflow.graph, { agent: agentKeys, channel: channelKeys }, EXPORT_CLEARS),
    format: workflowGraphFormat(workflow.graph),
    ...(needsLink(workflow.graph) ? { relink: true } : {}),
  }));
}

export const importWorkflows = Effect.fn("InstanceTransfer.importWorkflows")(function* (
  values: readonly unknown[],
  port: TransferWorkflowPort,
  agentIds: ReadonlyMap<string, string>,
  channelIds: ReadonlyMap<string, string>,
  warnings: string[],
) {
  let created = 0;
  for (const value of values.slice(0, TRANSFER_WORKFLOWS)) {
    const workflow = decodeWorkflow(value);
    if (!workflow) {
      warnings.push(sourceText("error.import.transferWorkflowInvalid"));
      continue;
    }
    const graph = remapGraph(workflow.graph, { agent: agentIds, channel: channelIds }, IMPORT_CLEARS);
    const result = yield* Effect.result(
      Effect.try(() => parseCreateWorkflow({ title: workflow.title, graph, paused: true })).pipe(
        Effect.flatMap((input) => port.createWorkflow(input)),
      ),
    );
    if (Result.isFailure(result)) {
      warnings.push(
        sourceText("error.import.transferSettingSkipped", { name: workflow.title, reason: reason(result.failure) }),
      );
      continue;
    }
    created += 1;
    if (workflow.newer === "steps")
      warnings.push(sourceText("error.import.transferWorkflowNewer", { name: workflow.title }));
    if (workflow.newer === "settings")
      warnings.push(sourceText("error.import.transferWorkflowNewerSettings", { name: workflow.title }));
    if (graph.nodes.some((node) => node.kind === "trigger" && node.fields.trigger === "webhook"))
      warnings.push(sourceText("error.import.transferWorkflowWebhook", { name: workflow.title }));
    if (workflow.relink) warnings.push(sourceText("error.import.transferWorkflowConnection", { name: workflow.title }));
  }
  if (created > 0) warnings.push(sourceText("error.import.transferWorkflowPaused"));
});

function remapGraph(graph: WorkflowGraph, maps: IdMaps, clears: ReadonlySet<WorkflowIdKind>): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const fields: WorkflowFields = { ...node.fields };
      for (const field of workflowIdFields(node.kind)) {
        const value = node.fields[field.name];
        if (typeof value !== "string" || value === "" || workflowIdFollowsTrigger(field, value)) continue;
        const map = maps[field.id];
        if (map) fields[field.name] = map.get(value) ?? "";
        else if (clears.has(field.id)) fields[field.name] = "";
      }
      return { ...node, fields };
    }),
  };
}

function needsLink(graph: WorkflowGraph): boolean {
  return graph.nodes.some((node) =>
    workflowIdFields(node.kind).some((field) => {
      const value = node.fields[field.name];
      return (
        field.id === "connection" &&
        typeof value === "string" &&
        value !== "" &&
        !workflowIdFollowsTrigger(field, value)
      );
    }),
  );
}

function placeholderText(node: DynamicRecord, fields: DynamicRecord): string {
  for (const value of [fields.text, fields[WORKFLOW_STEP_NAME_FIELD], node.kind])
    if (typeof value === "string" && value.trim()) return value;
  return "";
}

function placeholderFields(node: DynamicRecord): DynamicRecord {
  const fields = isDynamicRecord(node.fields) ? node.fields : {};
  return { fields: { ...fields, text: placeholderText(node, fields) } };
}

type NewerWorkflow = "steps" | "settings" | null;

function withPlaceholders(graph: unknown): { graph: unknown; newer: NewerWorkflow } {
  if (!isDynamicRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return { graph, newer: null };
  const { nodes, edges, placeholders, newerSettings } = workflowGraphPlaceholders(
    { ...graph, nodes: graph.nodes, edges: graph.edges },
    placeholderFields,
  );
  const newer: NewerWorkflow = placeholders > 0 ? "steps" : newerSettings ? "settings" : null;
  return { graph: { ...graph, nodes, edges }, newer };
}

function decodeWorkflow(value: unknown): (TransferWorkflow & { newer: NewerWorkflow }) | null {
  if (!isDynamicRecord(value)) return null;
  const { title } = value;
  if (typeof title !== "string" || !title.trim() || title.length > TITLE_LIMIT) return null;
  const kept = withPlaceholders(value.graph);
  if (!isWorkflowGraph(kept.graph)) return null;
  return {
    title,
    graph: kept.graph,
    newer: kept.newer ?? (workflowFormatIsNewer(value.format) ? "settings" : null),
    ...(value.relink === true ? { relink: true } : {}),
  };
}
