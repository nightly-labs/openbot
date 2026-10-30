import type {
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowTriggerType,
} from "@openbot/contracts/ipc";
import { WORKFLOW_TRIGGER_TYPES } from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { type RoutineDraftKind, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

const KIND_LABEL = {
  trigger: "mobile.workflow.kind.trigger",
  agent: "mobile.workflow.kind.agent",
  llm: "mobile.workflow.kind.llm",
  condition: "mobile.workflow.kind.condition",
  approval: "mobile.workflow.kind.approval",
  output: "mobile.workflow.kind.output",
  prompt: "mobile.workflow.kind.prompt",
  image: "mobile.workflow.kind.image",
  asset: "mobile.workflow.kind.asset",
  text: "mobile.workflow.kind.note",
  note: "mobile.workflow.kind.note",
  shape: "mobile.workflow.kind.note",
} as const satisfies Record<WorkflowNodeKind, MobileTextKey>;

const TRIGGER_LABEL = {
  manual: "mobile.workflow.trigger.manual",
  schedule: "mobile.workflow.trigger.schedule",
  webhook: "mobile.workflow.trigger.webhook",
  message: "mobile.workflow.trigger.message",
} as const satisfies Record<WorkflowTriggerType, MobileTextKey>;

export const RUN_STATUS_LABEL = {
  running: "mobile.workflow.status.running",
  approval: "mobile.workflow.status.approval",
  stopping: "mobile.workflow.status.stopping",
  done: "mobile.workflow.status.done",
  failed: "mobile.workflow.status.failed",
  stopped: "mobile.workflow.status.stopped",
} as const satisfies Record<WorkflowRunStatus, MobileTextKey>;

export const STEP_STATUS_LABEL = {
  running: "mobile.workflow.status.running",
  approval: "mobile.workflow.status.approval",
  done: "mobile.workflow.status.done",
  failed: "mobile.workflow.status.failed",
  stopped: "mobile.workflow.status.stopped",
  skipped: "mobile.workflow.status.skipped",
} as const satisfies Record<WorkflowStepStatus, MobileTextKey>;

const REPEAT_LABEL = {
  once: "mobile.agent.record.repeat.once",
  hourly: "mobile.agent.record.repeat.hourly",
  daily: "mobile.agent.record.repeat.daily",
  weekly: "mobile.agent.record.repeat.weekly",
  monthly: "mobile.agent.record.repeat.monthly",
  yearly: "mobile.agent.record.repeat.yearly",
  custom: "mobile.agent.trigger.custom",
} as const satisfies Record<RoutineDraftKind, MobileTextKey>;

const TRIGGER_TEXT = {
  manual: "mobile.workflow.trigger.manualHint",
  schedule: "mobile.workflow.trigger.scheduleHint",
  webhook: "mobile.workflow.trigger.webhookHint",
  message: "mobile.workflow.trigger.messageHint",
} as const satisfies Record<WorkflowTriggerType, MobileTextKey>;

/** When a trigger starts the workflow: how often and at what time for a schedule, such as "Daily · 09:00". */
function triggerText(node: WorkflowNode, t: MobileTranslate): string {
  const type = triggerType(node);
  if (type !== "schedule" || !node.schedule) return t(TRIGGER_TEXT[type]);
  const draft = routineScheduleToDraft(node.schedule);
  const repeat = t(REPEAT_LABEL[draft.kind]);
  return "time" in draft ? t("mobile.workflow.trigger.repeatAt", { repeat, time: draft.time }) : repeat;
}

/** A run that goes on: the drawer and the list show it as active. */
export function isActiveRun(status: WorkflowRunStatus | null | undefined): boolean {
  return status === "running" || status === "approval" || status === "stopping";
}

const text = (node: WorkflowNode, name: string): string => {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
};

/** The trigger type of a trigger node. A missing type is manual, as the host reads it. */
export function triggerType(node: WorkflowNode): WorkflowTriggerType {
  const value = node.fields.trigger;
  return typeof value === "string" && isOneOf(WORKFLOW_TRIGGER_TYPES, value) ? value : "manual";
}

export function kindLabel(kind: WorkflowNodeKind, t: MobileTranslate): string {
  return t(KIND_LABEL[kind]);
}

/** The first line of a step: its kind, with the agent or model that it uses. */
export function stepLabel(node: WorkflowNode, agents: readonly MobileAgent[], t: MobileTranslate): string {
  if (node.kind === "trigger") return t(TRIGGER_LABEL[triggerType(node)]);
  if (node.kind === "agent") {
    const agent = agents.find((candidate) => candidate.id === text(node, "agentId"));
    return agent ? t("mobile.workflow.kind.agentNamed", { name: agent.name }) : kindLabel(node.kind, t);
  }
  if (node.kind === "llm") {
    const model = text(node, "model");
    return model ? t("mobile.workflow.kind.llmNamed", { model }) : kindLabel(node.kind, t);
  }
  return kindLabel(node.kind, t);
}

/** The second line of a step: what it does, or the default that the host uses when it is empty. */
export function stepText(node: WorkflowNode, t: MobileTranslate): string {
  switch (node.kind) {
    case "trigger":
      return triggerText(node, t);
    case "agent":
      return text(node, "task") || t("mobile.workflow.step.taskDefault");
    case "llm":
      return text(node, "prompt") || t("mobile.workflow.step.promptDefault");
    case "condition":
      return text(node, "rule") || t("mobile.workflow.step.ruleDefault");
    case "approval":
      return text(node, "question") || t("mobile.workflow.step.questionDefault");
    case "prompt":
      return text(node, "text") || t("mobile.workflow.step.textEmpty");
    case "output":
      return text(node, "target") === "channel"
        ? t("mobile.workflow.output.channel")
        : text(node, "target") === "file"
          ? t("mobile.workflow.output.file")
          : t("mobile.workflow.output.notify");
    default:
      return t("mobile.workflow.step.computerOnly");
  }
}

/** What stops a step from running, or null. The host fails an agent step that has no agent. */
export function stepProblem(node: WorkflowNode, agents: readonly MobileAgent[], t: MobileTranslate): string | null {
  if (node.kind !== "agent") return null;
  const agentId = text(node, "agentId");
  if (!agentId) return t("mobile.workflow.problem.noAgent");
  if (!agents.some((agent) => agent.id === agentId)) return t("mobile.workflow.problem.agentGone");
  return null;
}

/** The newest attempt of each node of a run. A retry is a new attempt of the same node. */
export function latestSteps(steps: readonly WorkflowStep[]): Map<string, WorkflowStep> {
  const latest = new Map<string, WorkflowStep>();
  for (const step of steps) {
    const current = latest.get(step.nodeId);
    if (!current || step.attempt >= current.attempt) latest.set(step.nodeId, step);
  }
  return latest;
}
