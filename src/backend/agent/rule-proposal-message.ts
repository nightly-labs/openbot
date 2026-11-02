import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_RULE_PROPOSAL_ITEM_TYPE, type ConversationMessage } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

/** A rule as a review compares it: one line, any case, with no end stop. */
export function ruleKey(rule: string): string {
  return rule
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "")
    .toLowerCase();
}

/**
 * The system line that suggests one rule. The user accepts it into the agent's instruction file, or
 * dismisses it. The text holds the rule for a client that does not read `ruleProposal`. The texts
 * are redacted by the caller.
 */
export function ruleProposalMessage(
  reviewId: string,
  index: number,
  lesson: { rule: string; reason: string },
): ConversationMessage {
  const rule = lesson.rule.replace(/\s+/g, " ").trim().slice(0, INPUT_LIMITS.agentLearnedRule);
  return {
    id: `${reviewId}:rule-${index}`,
    turnId: reviewId,
    author: "system",
    source: "system",
    status: "completed",
    createdAt: new Date().toISOString(),
    itemType: AGENT_RULE_PROPOSAL_ITEM_TYPE,
    text: sourceText("status.agent.ruleProposal", { rule }),
    ruleProposal: { rule, reason: lesson.reason.trim().slice(0, INPUT_LIMITS.agentLearnedRule), status: "proposed" },
  };
}
