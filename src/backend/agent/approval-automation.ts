import type { AgentApproval, ApprovalAutomationPreference } from "@openbot/contracts/ipc";
import { Effect } from "effect";

export interface ApprovalAutomationPolicy {
  autoApproves(agentId: string): boolean;
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
