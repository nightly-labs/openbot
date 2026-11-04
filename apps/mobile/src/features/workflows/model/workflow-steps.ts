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
import { isOneOf } from "@openbot/contracts/runtime-values";
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

/** Why the host kept a version, as the desktop version list says it. */
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

/** The action of a Discord output, as the host reads it: a reply when it has none. */
export function discordAction(node: WorkflowNode): WorkflowDiscordAction {
  const value = node.fields.action;
  return typeof value === "string" && isOneOf(WORKFLOW_DISCORD_ACTIONS, value) ? value : "reply";
}

export const TELEGRAM_ACTION_LABEL = {
  reply: "mobile.workflow.telegram.action.reply",
  post: "mobile.workflow.telegram.action.post",
  react: "mobile.workflow.telegram.action.react",
} as const satisfies Record<WorkflowTelegramAction, MobileTextKey>;

/** The action of a Telegram output, as the host reads it: a reply when it has none. */
export function telegramAction(node: WorkflowNode): WorkflowTelegramAction {
  const value = node.fields.action;
  return typeof value === "string" && isOneOf(WORKFLOW_TELEGRAM_ACTIONS, value) ? value : "reply";
}

const SLACK_ACTION_LABEL = {
  reply: "mobile.workflow.slack.action.reply",
  post: "mobile.workflow.discord.action.post",
  react: "mobile.workflow.discord.action.react",
} as const satisfies Record<WorkflowSlackAction, MobileTextKey>;

/** The action of a Slack output, as the host reads it: a reply in the thread when it has none. */
function slackAction(node: WorkflowNode): WorkflowSlackAction {
  const value = node.fields.action;
  return typeof value === "string" && isOneOf(WORKFLOW_SLACK_ACTIONS, value) ? value : "reply";
}

/**
 * When a trigger starts the workflow: how often and at what time for a schedule, such as "Daily · 09:00",
 * and the repository and the event of a GitHub trigger.
 */
function triggerText(node: WorkflowNode, t: MobileTranslate): string {
  const type = triggerType(node);
  if (type === "github") {
    const github = githubTrigger(node);
    return github.repository
      ? t("mobile.workflow.github.summary", {
          repository: github.repository,
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

/** Where an output sends its result, and what a GitHub, Discord, Telegram or Slack output does there. */
function outputText(node: WorkflowNode, t: MobileTranslate): string {
  switch (text(node, "target")) {
    case "channel":
      return t("mobile.workflow.output.channel");
    case "file":
      return t("mobile.workflow.output.file");
    case "github": {
      const action = text(node, "action");
      const label = t(
        GITHUB_ACTION_LABEL[isOneOf(WORKFLOW_GITHUB_ACTIONS, action) ? action : GITHUB_OUTPUT_DEFAULTS.action],
      );
      const stored = text(node, "repository");
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
      return outputText(node, t);
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
