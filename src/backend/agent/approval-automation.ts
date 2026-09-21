import type { AgentApproval } from "@openbot/contracts/ipc";

/**
 * Answers one question for `AttentionRegistry`: may this approval be accepted without asking?
 *
 * A grant covers every approval kind the agent raises, `permissions` included. An agent asks to
 * widen its filesystem or network reach before it can do the ordinary work the grant was given for,
 * so holding that class back left one card for each agent that the user could not turn off.
 *
 * Hosted-site publishing, replacement and deletion use the same grant. Their validated mutations
 * still run through the hosted-site coordinator so results and activity markers are preserved.
 * Browser takeover is a separate flow with its own gate and is never asked about here.
 */
export interface ApprovalAutomationPolicy {
  /** Whether this agent's eligible approvals are answered for it. */
  autoApproves(agentId: string): boolean;
}

export const NO_APPROVAL_AUTOMATION: ApprovalAutomationPolicy = { autoApproves: () => false };

export function shouldAutoApprove(policy: ApprovalAutomationPolicy, approval: AgentApproval): boolean {
  return policy.autoApproves(approval.agentId);
}
