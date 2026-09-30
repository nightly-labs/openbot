import type { QueueDelivery } from "@openbot/contracts/ipc";

export interface TurnSlotsOptions {
  /** The most turns that run at the same time, or null for no limit. */
  limit(): number | null;
  agentIds(): readonly string[];
  /** Whether the agent runs a turn, starts one, or compacts its context. Each one uses a slot. */
  isRunning(agentId: string): boolean;
  /** Whether the agent has a delivery that could start now, if a slot were free. */
  isWaiting(agentId: string): boolean;
  /** The delivery at the head of the agent's queue. */
  head(agentId: string): QueueDelivery | null;
}

/**
 * Owns the turn slot clause of the queue drain: on a hosted server only a fixed number of turns run
 * at the same time. When the slots are full, the waiting agents go by the head of their queue: a
 * message from a person first, then routine runs and teammate messages, and the oldest first in each
 * group. A delivery that waits stays queued. It never imports the service.
 *
 * No slot waits on another slot: a teammate request ends the turn that sends it, and the answer
 * arrives as a new delivery.
 */
export class TurnSlots {
  readonly #options: TurnSlotsOptions;

  constructor(options: TurnSlotsOptions) {
    this.#options = options;
  }

  mayStart(agentId: string): boolean {
    const limit = this.#options.limit();
    if (limit === null) return true;
    const agentIds = this.#options.agentIds();
    const free = limit - agentIds.filter((id) => this.#options.isRunning(id)).length;
    if (free <= 0) return false;
    const head = this.#options.head(agentId);
    if (!head) return true;
    let ahead = 0;
    for (const other of agentIds) {
      if (other === agentId || this.#options.isRunning(other) || !this.#options.isWaiting(other)) continue;
      const otherHead = this.#options.head(other);
      if (otherHead && startsBefore(otherHead, other, head, agentId)) ahead += 1;
    }
    return ahead < free;
  }
}

function startsBefore(left: QueueDelivery, leftAgentId: string, right: QueueDelivery, rightAgentId: string): boolean {
  const leftPerson = left.sender.kind === "user";
  const rightPerson = right.sender.kind === "user";
  if (leftPerson !== rightPerson) return leftPerson;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt;
  return leftAgentId < rightAgentId;
}
