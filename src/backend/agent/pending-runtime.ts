import type { AgentModelId, AgentPendingRuntime, AgentProviderId, AgentReasoningEffort } from "@openbot/contracts/ipc";

/** The provider, model and effort an agent runs after an update. */
export interface NextRuntime {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

/** The part of an update that decides whether its queued change keeps an account. */
export interface PendingRuntimeUpdate {
  providerAccountId?: string | null | undefined;
  leaveUsageLimit?: boolean | undefined;
}

/** The agent before the update. */
export interface PendingRuntimeAgent {
  pendingRuntime?: AgentPendingRuntime | undefined;
}

/** Why an automatic move or a queued change is applied, as `AgentService` names it. */
export type PendingRuntimeMove = "return" | "provider-error" | "next-turn";

/**
 * The queued change an update leaves behind: `undefined` leaves the stored one alone, `null` ends
 * it, and a value replaces it.
 *
 * An update that names no account does not throw away a queued account switch. A model or effort
 * sweep lands now, and the account still waits for the next turn, because a running turn keeps the
 * sessions of the account it started in. The sweep carries that account into the queued change it
 * leaves behind, with the model and effort the agent runs from now on. The account is dropped when
 * it belongs to the provider the agent leaves, and when the update names an account itself: that
 * one is what the agent gets next.
 */
export function pendingRuntimeAfterUpdate(input: {
  update: PendingRuntimeUpdate;
  previous: PendingRuntimeAgent;
  next: NextRuntime;
  /** The update names a provider, a model, an effort or an account. */
  runtime: boolean;
  /** A person or an agent asked for the change, so a handover waits for the next turn. */
  queueWhileBusy: boolean;
  /** The update itself moves the agent to another provider, account or custom agent. */
  handover: boolean;
  move?: PendingRuntimeMove | null | undefined;
}): AgentPendingRuntime | null | undefined {
  if (!input.runtime || !(input.queueWhileBusy || input.handover)) return undefined;
  if (input.move != null || input.update.leaveUsageLimit) return null;
  if (input.update.providerAccountId !== undefined) return null;
  const queued = input.previous.pendingRuntime;
  const accountId = queued?.providerAccountId;
  if (queued === undefined || accountId === undefined || queued.provider !== input.next.provider) return null;
  return {
    provider: input.next.provider,
    model: input.next.model,
    reasoningEffort: input.next.reasoningEffort,
    providerAccountId: accountId,
  };
}
