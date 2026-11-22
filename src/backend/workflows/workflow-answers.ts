import {
  checkWorkflowAnswer,
  lastJsonObject,
  nodeAnswerProblems,
  parseWorkflowAnswerSpec,
  WORKFLOW_ANSWER_FIELD,
  type WorkflowAnswer,
  type WorkflowAnswerField,
  type WorkflowAnswerProblem,
  type WorkflowAnswerSource,
  type WorkflowAnswerValueProblem,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
  workflowAnswerFieldsOf,
  workflowAnswerFixText,
  workflowAnswerInstruction,
  workflowAnswerLines,
  workflowAnswerProblemName,
  workflowAnswerSources,
  workflowAnswerTemplateText,
  workflowAnswerValueText,
  workflowNodeAnswerNames,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
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

export type TemplateReader = "model" | "person";

export function templateValues(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
  reader: TemplateReader = "model",
): Map<string, string> {
  const values = new Map<string, string>();
  for (const { fields } of workflowAnswerSources(graph, nodeId)) for (const field of fields) values.set(field.name, "");
  for (const { source, answer } of givenAnswers(graph, nodeId, latest))
    for (const field of source.fields) {
      if (!Object.hasOwn(answer, field.name)) continue;
      const value = answer[field.name];
      values.set(
        field.name,
        reader === "person" ? workflowAnswerValueText(value) : workflowAnswerTemplateText(field, value),
      );
    }
  return values;
}

const SAVE_ONLY_PROBLEMS: ReadonlySet<WorkflowAnswerProblem["code"]> = new Set(["check", "path", "repeated"]);

export type AnswerGap = { kind: "setup" | "source"; names: string };

export function stepAnswerGap(
  graph: WorkflowGraph,
  node: WorkflowNode,
  endedWithoutAnswer: (nodeId: string) => boolean,
): AnswerGap | null {
  const sources = workflowAnswerSources(graph, node.id);
  const typed = sources.length > 0;
  const problems = nodeAnswerProblems(graph, node).filter(
    (problem) => !SAVE_ONLY_PROBLEMS.has(problem.code) && (typed || problem.code !== "template"),
  );
  if (problems.length > 0)
    return { kind: "setup", names: [...new Set(problems.map(workflowAnswerProblemName))].join(", ") };
  const used = workflowNodeAnswerNames(node);
  if (used.length === 0) return null;
  const lost = used.filter((name) => {
    const giving = sources.flatMap((source) => {
      const field = source.fields.find((candidate) => candidate.name === name);
      return field ? [{ source, field }] : [];
    });
    return (
      giving.length > 0 &&
      giving.some(({ field }) => !field.optional) &&
      giving.every(({ source }) => endedWithoutAnswer(source.node.id))
    );
  });
  return lost.length > 0 ? { kind: "source", names: lost.join(", ") } : null;
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

export function workflowAnswerJsonSchema(fields: readonly WorkflowAnswerField[]): DynamicRecord {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field.name, answerValueSchema(field)])),
    required: fields.filter((field) => !field.optional).map((field) => field.name),
    additionalProperties: false,
  };
}

function answerValueSchema(field: WorkflowAnswerField): DynamicRecord {
  switch (field.type) {
    case "text":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "integer":
      return { type: "integer" };
    case "yes/no":
      return { type: "boolean" };
    case "list":
      return { type: "array", items: { type: "string" } };
    case "choice":
      return { type: "string", enum: [...field.labels] };
  }
}

export const WORKFLOW_ANSWER_TOOL = "workflow_answer";

export function agentAnswerAsk(fields: readonly WorkflowAnswerField[]): string {
  return `Give your answer with the openbot.${WORKFLOW_ANSWER_TOOL} tool, as {"answer":{…}}, with these fields:\n${workflowAnswerInstruction(fields)}\nWhen it is not in your tool list, run it with openbot.tool_call. It checks the fields at once; when it tells you a problem, correct the answer and call it again. When you cannot call it, end your reply with the same JSON object.`;
}

export function toolAnswerFixAsk(
  fields: readonly WorkflowAnswerField[],
  problems: readonly WorkflowAnswerValueProblem[],
): string {
  return `The answer did not fit: ${workflowAnswerFixText(problems)}. Call ${WORKFLOW_ANSWER_TOOL} again with the corrected answer, with these fields:\n${workflowAnswerInstruction(fields)}`;
}

export function answerFixAsk(
  fields: readonly WorkflowAnswerField[],
  problems: readonly WorkflowAnswerValueProblem[],
): string {
  return `Your answer did not fit: ${workflowAnswerFixText(problems)}. Send only the corrected JSON object with these fields:\n${workflowAnswerInstruction(fields)}`;
}

export type ReadAnswer = { output: string } | { problems: WorkflowAnswerValueProblem[] };

export function readAnswer(fields: readonly WorkflowAnswerField[], text: string): ReadAnswer {
  const record = lastJsonObject(text);
  if (!record) return { problems: [{ name: fields.map((field) => field.name).join(", "), problem: "json" }] };
  return readGivenAnswer(fields, record);
}

export function readGivenAnswer(fields: readonly WorkflowAnswerField[], value: unknown): ReadAnswer {
  const { answer, problems } = checkWorkflowAnswer(fields, value, "refuse");
  return problems.length > 0 ? { problems } : { output: JSON.stringify(answer) };
}

export function runInputProblems(trigger: WorkflowNode, input: string): WorkflowAnswerValueProblem[] {
  const fields = workflowAnswerFieldsOf(trigger);
  if (fields.length === 0) return [];
  const record = lastJsonObject(input);
  if (!record) return [{ name: fields.map((field) => field.name).join(", "), problem: "json" }];
  const given = Object.hasOwn(record, "data") ? record.data : record;
  return checkWorkflowAnswer(fields, given, "refuseMiscased").problems;
}

export function withRunAnswerSpec(node: WorkflowNode, runNode: WorkflowNode | undefined): WorkflowNode {
  if (!runNode || runNode.kind !== node.kind) return node;
  const spec = runNode.fields[WORKFLOW_ANSWER_FIELD];
  const fields = Object.fromEntries(Object.entries(node.fields).filter(([name]) => name !== WORKFLOW_ANSWER_FIELD));
  return { ...node, fields: spec === undefined ? fields : { ...fields, [WORKFLOW_ANSWER_FIELD]: spec } };
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
  const { answer, problems } = checkWorkflowAnswer(fields, event.data, "refuseMiscased");
  if (problems.length > 0) return { problems };
  const data = Object.fromEntries(
    Object.entries(answer).map(([name, value]) => [name, typeof value === "object" ? [...value] : value]),
  );
  return { event: { ...event, data } };
}
