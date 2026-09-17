import type { AgentApproval } from "@openbot/contracts/ipc";

/**
 * Answers one question for `AttentionRegistry`: may this approval be accepted without asking?
 *
 * The decision is deliberately not the preference itself. Two classes of action stay outside any
 * grant the user can give from an approval card, because neither is what "let this agent work"
 * means:
 *
 * - `permissions` approvals widen what the agent may reach - filesystem roots and the network - for
 *   the rest of the turn. The request that asks for a wider boundary cannot be the one that answers
 *   itself.
 * - Hosted-site mutations publish to the internet. They never reach this function: the registry
 *   surfaces them through `surfaceHostedSiteApproval`, which has no automated path at all.
 *
 * Browser takeover is a separate flow with its own gate and is likewise never asked about here.
 */
export interface ApprovalAutomationPolicy {
  /** Whether this agent's eligible approvals are answered for it. */
  autoApproves(agentId: string): boolean;
}

export const NO_APPROVAL_AUTOMATION: ApprovalAutomationPolicy = { autoApproves: () => false };

export function shouldAutoApprove(policy: ApprovalAutomationPolicy, approval: AgentApproval): boolean {
  if (approval.kind === "permissions") return false;
  return policy.autoApproves(approval.agentId);
}
