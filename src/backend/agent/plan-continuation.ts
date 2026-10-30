import type { ConversationPlan, ConversationPlanStep } from "@openbot/contracts/ipc";
import { planContinuationPrompt } from "./delivery-content";

export interface PlanContinuationOptions {
  /** The most automatic continuations of one request. */
  limit: number;
}

interface Chain {
  deliveryIds: ReadonlySet<string>;
  count: number;
  /** The plan of the last turn of the chain. A turn that sends no plan update keeps it. */
  plan: ConversationPlan;
  /** The open steps of that plan, by text and status, to see whether a turn made progress. */
  openSteps: string;
  /** The open steps of the chat's plan before the request, by text and status. */
  earlierSteps: ReadonlySet<string>;
}

function laneKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}\u0000${taskId}`;
}

const stepKey = (step: ConversationPlanStep) => JSON.stringify([step.text, step.status]);

function openSteps(plan: ConversationPlan, earlierSteps: ReadonlySet<string>): ConversationPlanStep[] {
  return plan.steps.filter((step) => step.status !== "completed" && !earlierSteps.has(stepKey(step)));
}

/**
 * Owns the in-memory chains of automatic plan continuations: for each lane (the agent's own chat or
 * one task), the deliveries of the request, the count, and the plan of the last turn. A turn that
 * ends with open steps in the agent's own plan runs once more with a short note, until the plan is
 * done, the limit is reached, or a turn makes no progress. A step that was open, with the same text
 * and status, in the plan from before the request is left from earlier work and does not count. A
 * restart forgets every chain, and the drain then settles the waiting deliveries. It never imports
 * the mailbox or the service facade.
 */
export class PlanContinuation {
  readonly #limit: number;
  readonly #chains = new Map<string, Chain>();

  constructor(options: PlanContinuationOptions) {
    this.#limit = options.limit;
  }

  get limit(): number {
    return this.#limit;
  }

  /**
   * Decides whether the turn that just ended continues. `plan` is the plan of that turn, or null when
   * the turn sent none. `earlierPlan` is the chat's last plan from before that turn; only the first
   * turn of a request reads it. Returns the number of this continuation, or null; null also ends the
   * chain.
   */
  consider(input: {
    agentId: string;
    taskId: string | null;
    deliveryIds: readonly string[];
    plan: ConversationPlan | null;
    earlierPlan: ConversationPlan | null;
  }): { count: number } | null {
    const key = laneKey(input.agentId, input.taskId);
    const previous = this.#chains.get(key);
    this.#chains.delete(key);
    const chained =
      previous !== undefined &&
      input.deliveryIds.length > 0 &&
      // A message steered into a continuation turn joins the request, so the chain keeps its count.
      input.deliveryIds.some((deliveryId) => previous.deliveryIds.has(deliveryId));
    const plan = input.plan ?? (chained ? previous.plan : null);
    if (!plan) return null;
    const earlierSteps = chained
      ? previous.earlierSteps
      : new Set(
          (input.earlierPlan?.steps ?? []).filter((step) => step.status !== "completed").map((step) => stepKey(step)),
        );
    const open = openSteps(plan, earlierSteps);
    if (open.length === 0) return null;
    const signature = JSON.stringify(open.map(stepKey));
    const count = chained ? previous.count : 0;
    if (count >= this.#limit || (chained && previous.openSteps === signature)) return null;
    this.#chains.set(key, {
      deliveryIds: new Set(input.deliveryIds),
      count: count + 1,
      plan,
      openSteps: signature,
      earlierSteps,
    });
    return { count: count + 1 };
  }

  /**
   * The note that starts the continuation of this delivery, or null when no chain waits for it:
   * after a restart, a Stop, a new chat, or when other messages wait in the lane (`othersQueued`).
   * A start that goes back to the queue, as during a compaction, claims the same note again.
   */
  claim(agentId: string, taskId: string | null, deliveryId: string, othersQueued: boolean): string | null {
    const key = laneKey(agentId, taskId);
    const chain = this.#chains.get(key);
    if (!chain?.deliveryIds.has(deliveryId) || othersQueued) {
      this.#chains.delete(key);
      return null;
    }
    return planContinuationPrompt(openSteps(chain.plan, chain.earlierSteps), chain.count, this.#limit);
  }

  /** Ends the chain of one lane, or of every lane of the agent when `taskId` is undefined. */
  cancel(agentId: string, taskId?: string | null): void {
    if (taskId !== undefined) {
      this.#chains.delete(laneKey(agentId, taskId));
      return;
    }
    for (const key of [...this.#chains.keys()])
      if (key === agentId || key.startsWith(`${agentId}\u0000`)) this.#chains.delete(key);
  }

  dispose(): void {
    this.#chains.clear();
  }
}
