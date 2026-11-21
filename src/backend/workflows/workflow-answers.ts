import {
  checkWorkflowAnswer,
  lastJsonObject,
  parseWorkflowAnswerSpec,
  WORKFLOW_ANSWER_FIELD,
  type WorkflowAnswer,
  type WorkflowAnswerField,
  type WorkflowAnswerSource,
  type WorkflowAnswerValueProblem,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
  workflowAnswerFieldsOf,
  workflowAnswerFixText,
  workflowAnswerInstruction,
  workflowAnswerLines,
  workflowAnswerSources,
  workflowAnswerValueText,
} from "@openbot/contracts/ipc";
import type { ReceivedWebhookEvent } from "../routine-store";
import type { StoredWorkflowStep } from "./workflow-run-store";

export function answerFields(fields: WorkflowFields | null | undefined): WorkflowAnswerField[] {
  const spec = fields?.[WORKFLOW_ANSWER_FIELD];
  return typeof spec === "string" && spec.trim() ? parseWorkflowAnswerSpec(spec).fields : [];
}

function givenAnswer({ node, fields }: WorkflowAnswerSource, output: string): WorkflowAnswer {
  const record = lastJsonObject(output);
  if (!record) return {};
  const given = node.kind === "trigger" && Object.hasOwn(record, "data") ? record.data : record;
  return checkWorkflowAnswer(fields, given).answer;
}

type GivenAnswer = { source: WorkflowAnswerSource; answer: WorkflowAnswer };

function givenAnswers(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): GivenAnswer[] {
  return workflowAnswerSources(graph, nodeId)
    .flatMap((source) => {
      const step = latest.get(source.node.id);
      return step?.status === "done" && step.output ? [{ source, step, output: step.output }] : [];
    })
    .sort((left, right) => left.step.sequence - right.step.sequence)
    .map(({ source, output }) => ({ source, answer: givenAnswer(source, output) }));
}

export function stepAnswer(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): WorkflowAnswer {
  return Object.fromEntries(givenAnswers(graph, nodeId, latest).flatMap(({ answer }) => Object.entries(answer)));
}

const QUOTED_TYPES: ReadonlySet<WorkflowAnswerField["type"]> = new Set(["text", "list"]);

export function templateValues(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const { fields } of workflowAnswerSources(graph, nodeId)) for (const field of fields) values.set(field.name, "");
  for (const { source, answer } of givenAnswers(graph, nodeId, latest))
    for (const field of source.fields) {
      if (!Object.hasOwn(answer, field.name)) continue;
      const text = workflowAnswerValueText(answer[field.name]);
      values.set(field.name, QUOTED_TYPES.has(field.type) ? JSON.stringify(text) : text);
    }
  return values;
}

export function readableAnswerInputs(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
  inputs: readonly string[],
): string[] {
  const given = new Map(
    workflowAnswerSources(graph, nodeId).flatMap((source) => {
      const output = latest.get(source.node.id)?.output;
      return output && source.node.kind !== "trigger" ? [[output.trim(), givenAnswer(source, output)] as const] : [];
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
  const fields = workflowAnswerFieldsOf(trigger);
  if (fields.length === 0) return { event };
  const { answer, problems } = checkWorkflowAnswer(fields, event.data);
  if (problems.length > 0) return { problems };
  const data = Object.fromEntries(
    Object.entries(answer).map(([name, value]) => [name, typeof value === "object" ? [...value] : value]),
  );
  return { event: { ...event, data } };
}
