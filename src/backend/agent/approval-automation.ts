import type { AgentApproval, AgentPromptQuestion } from "@openbot/contracts/ipc";

/**
 * Answers one question for `AttentionRegistry`: may this request be handled without asking?
 *
 * A grant covers every approval kind the agent raises, `permissions` included. An agent asks to
 * widen its filesystem or network reach before it can do the ordinary work the grant was given for,
 * so holding that class back left one card for each agent that the user could not turn off.
 *
 * One class stays outside any grant: a hosted-site mutation publishes to the internet. It never
 * reaches this function, because the registry surfaces it through `surfaceHostedSiteApproval`,
 * which has no automated path at all. Browser takeover is a separate flow with its own gate and is
 * likewise never asked about here.
 */
export interface ApprovalAutomationPolicy {
  /** Whether this agent's eligible approvals and questions are answered for it. */
  autoApproves(agentId: string): boolean;
}

export const NO_APPROVAL_AUTOMATION: ApprovalAutomationPolicy = { autoApproves: () => false };

export function shouldAutoApprove(policy: ApprovalAutomationPolicy, approval: AgentApproval): boolean {
  return policy.autoApproves(approval.agentId);
}

/**
 * Whether a question this agent asked can be left to the agent itself.
 *
 * A grant says the agent may work without stopping, and a question is another stop. A granted
 * agent's questions are answered with no answer at all - every question skipped, the same shape a
 * user leaves who skips each one - so the agent chooses for itself and keeps going. Nothing is
 * invented on the user's behalf, which a free-text question could not carry anyway.
 *
 * A secret question is the exception, and asks whatever the grant says. It wants an API key or a
 * password, which exists nowhere but with the user, so skipping it would only lose the work.
 */
export function shouldAutoSkipPrompt(
  policy: ApprovalAutomationPolicy,
  agentId: string,
  questions: AgentPromptQuestion[],
): boolean {
  if (questions.some((question) => question.isSecret)) return false;
  return policy.autoApproves(agentId);
}
