import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

export const PLAN_APPROVE = sourceText("status.messaging.approve");
export const PLAN_STOP = sourceText("status.agent.planStop");
export const PLAN_MODE_OFF = "Plan mode is off. Do not edit files until the user approves the plan.";
export const PLAN_STOPPED =
  "The user stopped planning, so plan mode is off. Do not edit files yet. Wait for the user's next message.";
export const PLAN_UNANSWERED =
  "The user did not answer the plan approval, so plan mode is off. Do not edit files yet. Show the plan to the user and wait for their reply.";

export function planApprovalQuestion(planText: unknown): DynamicRecord {
  const plan = typeof planText === "string" ? planText.trim() : "";
  const limit = INPUT_LIMITS.promptQuestion;
  return {
    header: sourceText("status.agent.planApprovalHeader"),
    question: !plan
      ? sourceText("status.agent.planApprovalEmpty")
      : plan.length > limit
        ? `${plan.slice(0, limit - 1)}…`
        : plan,
    detail: sourceText("status.agent.planApprovalDetail"),
    options: [
      { label: PLAN_APPROVE, description: sourceText("status.agent.planApproveDetail") },
      { label: PLAN_STOP, description: sourceText("status.agent.planStopDetail") },
    ],
  };
}
