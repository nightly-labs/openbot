import {
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowFileExportProblem,
  type WorkflowFileImportProblem,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { KIND_LABEL } from "./WorkflowAddMenu";

const LISTED_FIELDS = 6;

type StepNode = Pick<WorkflowNode, "id" | "kind" | "fields">;

const FIELD_LABEL: Readonly<Record<string, AppTextKey>> = {
  [WORKFLOW_STEP_NAME_FIELD]: "workflow.node.name",
  prompt: "workflow.prompt.title",
  system: "workflow.llm.system",
  task: "workflow.agent.task",
  rule: "workflow.condition.rule",
  question: "workflow.approval.question",
  title: "workflow.output.notifyTitleRow",
  message: "workflow.output.message",
  path: "workflow.output.path",
  text: "workflow.text.title",
};

const APP_LABEL: Readonly<Record<string, AppTextKey>> = {
  discord: "workflow.trigger.type.discord",
  slack: "workflow.trigger.type.slack",
  telegram: "workflow.trigger.type.telegram",
  github: "workflow.trigger.type.github",
};

export function workflowStepLabel(t: AppTranslate, node: Pick<WorkflowNode, "kind" | "fields">): string {
  const name = node.fields[WORKFLOW_STEP_NAME_FIELD];
  return (typeof name === "string" && name.trim()) || t(KIND_LABEL[node.kind]);
}

export function workflowAppLabel(t: AppTranslate, app: string): string {
  const key = APP_LABEL[app];
  return key ? t(key) : app;
}

function stepText(t: AppTranslate, nodes: readonly StepNode[], id: string, fallback: string): string {
  const node = nodes.find((candidate) => candidate.id === id);
  return node ? workflowStepLabel(t, node) : fallback;
}

function fieldText(t: AppTranslate, field: string): string {
  const key = FIELD_LABEL[field];
  return key ? t(key) : field;
}

export function workflowExportProblemText(
  t: AppTranslate,
  problem: WorkflowFileExportProblem,
  nodes: readonly StepNode[],
): string {
  if (problem.kind === "secret") {
    const listed = problem.fields.slice(0, LISTED_FIELDS).map((field) =>
      field.node
        ? t("workflow.file.export.field", {
            step: stepText(t, nodes, field.node, field.step),
            field: fieldText(t, field.field),
          })
        : fieldText(t, field.field),
    );
    const more = problem.fields.length - listed.length;
    if (more > 0) listed.push(t("workflow.canvas.status.more", { count: more }));
    return t("workflow.file.export.secret", { fields: listed.join(", ") });
  }
  if (problem.kind === "asset-missing")
    return t("workflow.file.export.assetMissing", { step: stepText(t, nodes, problem.node, problem.step) });
  if (problem.kind === "asset-too-large")
    return t("workflow.file.export.assetTooLarge", { step: stepText(t, nodes, problem.node, problem.step) });
  return t("workflow.file.export.tooLarge");
}

export function workflowImportProblemText(t: AppTranslate, problem: WorkflowFileImportProblem): string {
  if (problem.kind === "not-file") return t("workflow.file.import.notFile");
  if (problem.kind === "invalid") return t("workflow.file.import.invalid");
  const version = problem.minAppVersion
    ? t("workflow.file.import.newer", { version: problem.minAppVersion })
    : t("workflow.file.import.newerUnknown");
  if (problem.steps.length === 0) return version;
  const listed = problem.steps.slice(0, LISTED_FIELDS);
  const more = problem.steps.length - listed.length;
  if (more > 0) listed.push(t("workflow.canvas.status.more", { count: more }));
  return `${version} ${t("workflow.file.import.newerSteps", { steps: listed.join(", ") })}`;
}
