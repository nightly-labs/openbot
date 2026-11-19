import type {
  WorkflowDiscordAction,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowRunStatus,
  WorkflowSlackAction,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowTelegramAction,
  WorkflowTriggerType,
  WorkflowVersionKind,
} from "@openbot/contracts/ipc";
import {
  WORKFLOW_DISCORD_ACTIONS,
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_SLACK_ACTIONS,
  WORKFLOW_TELEGRAM_ACTIONS,
  WORKFLOW_TRIGGER_TYPES,
} from "@openbot/contracts/ipc";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { type RoutineDraftKind, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import {
  GITHUB_ACTION_LABEL,
  GITHUB_EVENT_LABEL,
  GITHUB_OUTPUT_DEFAULTS,
  githubTrigger,
  SAME_REPOSITORY,
} from "./workflow-github";
import { fieldOneOf, fieldText } from "./workflow-node-fields";

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
  github: "mobile.workflow.trigger.github",
  discord: "mobile.workflow.trigger.discord",
  telegram: "mobile.workflow.trigger.telegram",
  slack: "mobile.workflow.trigger.slack",
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
  github: "mobile.workflow.trigger.githubHint",
  discord: "mobile.workflow.trigger.discordHint",
  telegram: "mobile.workflow.trigger.telegramHint",
  slack: "mobile.workflow.trigger.slackHint",
} as const satisfies Record<WorkflowTriggerType, MobileTextKey>;

export const VERSION_KIND_LABEL = {
  auto: "mobile.workflow.version.auto",
  restore: "mobile.workflow.version.restore",
  run: "mobile.workflow.version.run",
} as const satisfies Record<WorkflowVersionKind, MobileTextKey>;

export const DISCORD_ACTION_LABEL = {
  reply: "mobile.workflow.discord.action.reply",
  post: "mobile.workflow.discord.action.post",
  react: "mobile.workflow.discord.action.react",
} as const satisfies Record<WorkflowDiscordAction, MobileTextKey>;

export function discordAction(node: WorkflowNode): WorkflowDiscordAction {
  return fieldOneOf(node, "action", WORKFLOW_DISCORD_ACTIONS, "reply");
}

export const TELEGRAM_ACTION_LABEL = {
  reply: "mobile.workflow.telegram.action.reply",
  post: "mobile.workflow.telegram.action.post",
  react: "mobile.workflow.telegram.action.react",
} as const satisfies Record<WorkflowTelegramAction, MobileTextKey>;

export function telegramAction(node: WorkflowNode): WorkflowTelegramAction {
  return fieldOneOf(node, "action", WORKFLOW_TELEGRAM_ACTIONS, "reply");
}

export const SLACK_ACTION_LABEL = {
  reply: "mobile.workflow.slack.action.reply",
  post: "mobile.workflow.discord.action.post",
  react: "mobile.workflow.discord.action.react",
} as const satisfies Record<WorkflowSlackAction, MobileTextKey>;

export function slackAction(node: WorkflowNode): WorkflowSlackAction {
  return fieldOneOf(node, "action", WORKFLOW_SLACK_ACTIONS, "reply");
}

function triggerText(node: WorkflowNode, t: MobileTranslate): string {
  const type = triggerType(node);
  if (type === "github") {
    const github = githubTrigger(node);
    return github.repository
      ? t("mobile.workflow.github.summary", {
          repository: github.repositories.length > 0 ? github.repositories.join(", ") : github.repository,
          event: t(GITHUB_EVENT_LABEL[github.event]),
        })
      : t(TRIGGER_TEXT.github);
  }
  if (type === "discord" || type === "slack") return t("mobile.workflow.discord.event.mention");
  if (type === "telegram") return t("mobile.workflow.telegram.event.mention");
  if (type !== "schedule" || !node.schedule) return t(TRIGGER_TEXT[type]);
  const draft = routineScheduleToDraft(node.schedule);
  const repeat = t(REPEAT_LABEL[draft.kind]);
  return "time" in draft ? t("mobile.workflow.trigger.repeatAt", { repeat, time: draft.time }) : repeat;
}

export function isActiveRun(status: WorkflowRunStatus | null | undefined): boolean {
  return status === "running" || status === "approval" || status === "stopping";
}

export function triggerType(node: WorkflowNode): WorkflowTriggerType {
  return fieldOneOf(node, "trigger", WORKFLOW_TRIGGER_TYPES, "manual");
}

export function kindLabel(kind: WorkflowNodeKind, t: MobileTranslate): string {
  return t(KIND_LABEL[kind]);
}

export function stepLabel(node: WorkflowNode, agents: readonly MobileAgent[], t: MobileTranslate): string {
  if (node.kind === "trigger") return t(TRIGGER_LABEL[triggerType(node)]);
  if (node.kind === "agent") {
    const agent = agents.find((candidate) => candidate.id === fieldText(node, "agentId"));
    return agent ? t("mobile.workflow.kind.agentNamed", { name: agent.name }) : kindLabel(node.kind, t);
  }
  if (node.kind === "llm") {
    const model = fieldText(node, "model");
    return model ? t("mobile.workflow.kind.llmNamed", { model }) : kindLabel(node.kind, t);
  }
  if (node.kind === "image" && fieldText(node, "media") === "video") return t("mobile.workflow.kind.video");
  return kindLabel(node.kind, t);
}

function outputText(node: WorkflowNode, t: MobileTranslate): string {
  switch (fieldText(node, "target")) {
    case "channel":
      return t("mobile.workflow.output.channel");
    case "chat-channel":
      return t("mobile.workflow.output.chatChannel");
    case "file":
      return t("mobile.workflow.output.file");
    case "github": {
      const label = t(
        GITHUB_ACTION_LABEL[fieldOneOf(node, "action", WORKFLOW_GITHUB_ACTIONS, GITHUB_OUTPUT_DEFAULTS.action)],
      );
      const stored = fieldText(node, "repository");
      const repository =
        stored && stored !== SAME_REPOSITORY ? stored : t("mobile.workflow.github.output.sameRepository");
      return t("mobile.workflow.github.summary", { repository, event: label });
    }
    case "discord":
      return t("mobile.workflow.discord.outputSummary", { action: t(DISCORD_ACTION_LABEL[discordAction(node)]) });
    case "telegram":
      return t("mobile.workflow.telegram.outputSummary", { action: t(TELEGRAM_ACTION_LABEL[telegramAction(node)]) });
    case "slack":
      return t("mobile.workflow.slack.outputSummary", { action: t(SLACK_ACTION_LABEL[slackAction(node)]) });
    default:
      return t("mobile.workflow.output.notify");
  }
}

export function stepText(node: WorkflowNode, t: MobileTranslate): string {
  switch (node.kind) {
    case "trigger":
      return triggerText(node, t);
    case "agent":
      return fieldText(node, "task") || t("mobile.workflow.step.taskDefault");
    case "llm":
      return fieldText(node, "prompt") || t("mobile.workflow.step.promptDefault");
    case "condition":
      return fieldText(node, "rule") || t("mobile.workflow.step.ruleDefault");
    case "approval":
      return fieldText(node, "question") || t("mobile.workflow.step.questionDefault");
    case "prompt":
      return fieldText(node, "text") || t("mobile.workflow.step.textEmpty");
    case "output":
      return outputText(node, t);
    default:
      return t("mobile.workflow.step.computerOnly");
  }
}

export function stepProblem(node: WorkflowNode, agents: readonly MobileAgent[], t: MobileTranslate): string | null {
  if (node.kind !== "agent") return null;
  const agentId = fieldText(node, "agentId");
  if (!agentId) return t("mobile.workflow.problem.noAgent");
  if (!agents.some((agent) => agent.id === agentId)) return t("mobile.workflow.problem.agentGone");
  return null;
}

export function latestSteps(steps: readonly WorkflowStep[]): Map<string, WorkflowStep> {
  const latest = new Map<string, WorkflowStep>();
  for (const step of steps) {
    const current = latest.get(step.nodeId);
    if (!current || step.attempt >= current.attempt) latest.set(step.nodeId, step);
  }
  return latest;
}
