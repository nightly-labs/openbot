import type { AgentApproval, ApprovalAutomationPreference } from "@openbot/contracts/ipc";
import { Effect } from "effect";

/**
 * Answers one question for `AttentionRegistry`: may this approval be accepted without asking? It
 * can also take a grant away, never give one: only the user gives a grant.
 *
 * A grant covers every approval kind the agent raises, `permissions` included. An agent asks to
 * widen its filesystem or network reach before it can do the ordinary work the grant was given for,
 * so holding that class back left one card for each agent that the user could not turn off.
 * Codex's consent to run an MCP tool is in the grant too. It is accepted once and never saved.
 *
 * The grant also covers built-in tool approvals and hosted-site publishing, replacement and
 * deletion. Validated mutations still run through the hosted-site coordinator.
 * Browser takeover is a separate flow with its own gate and is never asked about here.
 */
export interface ApprovalAutomationPolicy {
  /** Whether this agent's eligible approvals are answered for it. */
  autoApproves(agentId: string): boolean;
  /** Saves that this agent asks before it acts. */
  set(input: {
    agentId: string;
    autoApprove: false;
  }): Effect.Effect<ApprovalAutomationPreference, { readonly cause: unknown }>;
}

export const NO_APPROVAL_AUTOMATION: ApprovalAutomationPolicy = {
  autoApproves: () => false,
  set: () => Effect.succeed({ defaultAutoApprove: false, autoApproveOverrides: {} }),
};

export function shouldAutoApprove(policy: ApprovalAutomationPolicy, approval: Pick<AgentApproval, "agentId">): boolean {
  return policy.autoApproves(approval.agentId);
}
