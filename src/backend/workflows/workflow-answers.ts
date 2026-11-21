import {
  canGiveWorkflowAnswer,
  checkWorkflowAnswer,
  lastJsonObject,
  parseWorkflowAnswerSpec,
  plainAnswer,
  WORKFLOW_ANSWER_FIELD,
  type WorkflowAnswer,
  type WorkflowAnswerField,
  type WorkflowAnswerValueProblem,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
  workflowAnswerFixText,
  workflowAnswerInstruction,
  workflowAnswerLines,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { ReceivedWebhookEvent } from "../routine-store";
import type { StoredWorkflowStep } from "./workflow-run-store";

const PASS_THROUGH_KINDS: ReadonlySet<WorkflowNode["kind"]> = new Set(["condition", "approval"]);

export function answerFields(fields: WorkflowFields | null | undefined): WorkflowAnswerField[] {
  const spec = fields?.[WORKFLOW_ANSWER_FIELD];
  return typeof spec === "string" && spec.trim() ? parseWorkflowAnswerSpec(spec).fields : [];
}

export function nodeAnswerFields(node: WorkflowNode): WorkflowAnswerField[] {
  return canGiveWorkflowAnswer(node) ? answerFields(node.fields) : [];
}

function answerSources(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const sources: WorkflowNode[] = [];
  const seen = new Set<string>([nodeId]);
  const visit = (id: string) => {
    for (const edge of graph.edges) {
      if (edge.to !== id || edge.type !== "text" || seen.has(edge.from)) continue;
      seen.add(edge.from);
      const source = nodes.get(edge.from);
      if (!source) continue;
      if (nodeAnswerFields(source).length > 0) sources.push(source);
      else if (PASS_THROUGH_KINDS.has(source.kind)) visit(source.id);
    }
  };
  visit(nodeId);
  return sources;
}

function givenAnswer(node: WorkflowNode, output: string): WorkflowAnswer {
  const record = lastJsonObject(output);
  if (!record) return {};
  if (node.kind !== "trigger") return plainAnswer(record);
  return isDynamicRecord(record.data) ? plainAnswer(record.data) : {};
}

export function stepAnswer(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): WorkflowAnswer {
  const given = answerSources(graph, nodeId)
    .flatMap((node) => {
      const step = latest.get(node.id);
      return step?.status === "done" && step.output ? [{ node, step, output: step.output }] : [];
    })
    .sort((left, right) => left.step.sequence - right.step.sequence);
  return Object.assign({}, ...given.map(({ node, output }) => givenAnswer(node, output)));
}

export function readableAnswerInputs(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
  inputs: readonly string[],
): string[] {
  const given = new Map(
    answerSources(graph, nodeId).flatMap((node) => {
      const output = latest.get(node.id)?.output;
      return output && node.kind !== "trigger" ? [[output.trim(), givenAnswer(node, output)] as const] : [];
    }),
  );
  if (given.size === 0) return [...inputs];
  return inputs.map((input) => {
    const answer = given.get(input.trim());
    return answer ? workflowAnswerLines(answer) : input;
  });
}

export function modelAnswerAsk(fields: readonly WorkflowAnswerField[]): string {
  return `Answer with only one JSON object, with no other text, with these fields:\n${workflowAnswerInstruction(fields)}`;
}

export function agentAnswerAsk(fields: readonly WorkflowAnswerField[]): string {
  return `End your reply with one JSON object with these fields:\n${workflowAnswerInstruction(fields)}`;
}

export function answerFixAsk(
  fields: readonly WorkflowAnswerField[],
  problems: readonly WorkflowAnswerValueProblem[],
): string {
  return `Your answer did not fit: ${workflowAnswerFixText(problems)}. Send only the corrected JSON object with these fields:\n${workflowAnswerInstruction(fields)}`;
}

export type ReadAnswer = { output: string } | { problems: WorkflowAnswerValueProblem[] };

export function readAnswer(fields: readonly WorkflowAnswerField[], text: string): ReadAnswer {
  const { answer, problems } = checkWorkflowAnswer(fields, lastJsonObject(text) ?? {});
  return problems.length > 0 ? { problems } : { output: JSON.stringify(answer) };
}

export function answerProblemNames(problems: readonly WorkflowAnswerValueProblem[]): string {
  return problems.map((problem) => problem.name).join(", ");
}

export function webhookAnswerEvent(
  trigger: WorkflowNode,
  event: ReceivedWebhookEvent,
): { event: ReceivedWebhookEvent } | { problems: WorkflowAnswerValueProblem[] } {
  const fields = nodeAnswerFields(trigger);
  if (fields.length === 0) return { event };
  const { answer, problems } = checkWorkflowAnswer(fields, event.data);
  if (problems.length > 0) return { problems };
  const data = Object.fromEntries(
    Object.entries(answer).map(([name, value]) => [name, typeof value === "object" ? [...value] : value]),
  );
  return { event: { ...event, data } };
}
