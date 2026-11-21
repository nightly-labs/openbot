import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const CONVERSATION_PLAN_ITEM_TYPE = "plan";

export const CONVERSATION_PLAN_STEP_STATUSES = ["pending", "inProgress", "completed"] as const;
export type ConversationPlanStepStatus = (typeof CONVERSATION_PLAN_STEP_STATUSES)[number];

export interface ConversationPlanStep {
  id: string;
  text: string;
  activeText?: string;
  status: ConversationPlanStepStatus;
}

export interface ConversationPlan {
  explanation: string | null;
  steps: ConversationPlanStep[];
}

export const CONVERSATION_PLAN_STEP_LIMIT = 100;
const STEP_TEXT_LIMIT = INPUT_LIMITS.promptQuestion;
const EXPLANATION_LIMIT = INPUT_LIMITS.promptQuestion;

export function isConversationPlan(value: unknown): value is ConversationPlan {
  return (
    isDynamicRecord(value) &&
    (value.explanation === null || isBoundedString(value.explanation, EXPLANATION_LIMIT)) &&
    Array.isArray(value.steps) &&
    value.steps.length <= CONVERSATION_PLAN_STEP_LIMIT &&
    value.steps.every(isConversationPlanStep)
  );
}

function isConversationPlanStep(value: unknown): value is ConversationPlanStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.text, STEP_TEXT_LIMIT) &&
    (value.activeText === undefined || isBoundedString(value.activeText, STEP_TEXT_LIMIT)) &&
    isOneOf(CONVERSATION_PLAN_STEP_STATUSES, value.status)
  );
}

export function clampConversationPlan(plan: ConversationPlan): ConversationPlan | null {
  const steps: ConversationPlanStep[] = [];
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (steps.length >= CONVERSATION_PLAN_STEP_LIMIT) break;
    const text = clampText(step.text);
    if (!text) continue;
    let id = clampText(step.id).slice(0, INPUT_LIMITS.identifier) || String(steps.length);
    if (!isIdentifier(id) || ids.has(id)) id = `step-${steps.length}`;
    ids.add(id);
    const activeText = step.activeText === undefined ? "" : clampText(step.activeText);
    const status = isOneOf(CONVERSATION_PLAN_STEP_STATUSES, step.status) ? step.status : "pending";
    steps.push({ id, text, ...(activeText ? { activeText } : {}), status });
  }
  if (!steps.length) return null;
  const explanation = plan.explanation === null ? "" : clampText(plan.explanation);
  return { explanation: explanation || null, steps };
}

function clampText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, STEP_TEXT_LIMIT);
}

export function conversationPlanText(plan: ConversationPlan): string {
  const lines = plan.steps.map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.text}`);
  return plan.explanation ? `${plan.explanation}\n\n${lines.join("\n")}` : lines.join("\n");
}

const CHECKLIST_LINE = /^- \[( |x)\] (.+)$/u;

export function parseConversationPlanText(text: string): ConversationPlan | null {
  const lines = text.split("\n");
  const firstStep = lines.findIndex((line) => CHECKLIST_LINE.test(line));
  if (firstStep < 0) return null;
  const steps: ConversationPlanStep[] = [];
  for (const line of lines.slice(firstStep)) {
    const match = CHECKLIST_LINE.exec(line);
    if (!match) return null;
    steps.push({ id: String(steps.length), text: match[2] ?? "", status: match[1] === "x" ? "completed" : "pending" });
  }
  const explanation = lines.slice(0, firstStep).join("\n").trim();
  return clampConversationPlan({ explanation: explanation || null, steps });
}

export interface ConversationPlanRow {
  id: string;
  turnId: string | undefined;
  agent: string | null;
  plan: boolean;
}

export function replacedConversationPlans(rows: readonly ConversationPlanRow[]): ReadonlySet<string> {
  const replaced = new Set<string>();
  const laterTurns = new Map<string, Set<string>>();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row?.turnId || row.agent === null) continue;
    const turns = laterTurns.get(row.agent) ?? new Set<string>();
    if (row.plan && (turns.size > 1 || (turns.size === 1 && !turns.has(row.turnId)))) replaced.add(row.id);
    laterTurns.set(row.agent, turns.add(row.turnId));
  }
  return replaced;
}
