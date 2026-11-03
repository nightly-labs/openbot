import type { AgentEvent, QueueDelivery } from "@openbot/contracts/ipc";

type CompletedTurn = Extract<AgentEvent, { type: "turn-completed" }>;

/** Matches one spoken send to its exact queue delivery, even when events beat its receipt. */
export class VoiceReplyTracker {
  #deliveryId: string | undefined;
  #turnId: string | undefined;
  #continuedTurnId: string | undefined;
  #queued = false;
  #finished = false;
  readonly #turns = new Map<string, string>();
  readonly #completed = new Map<string, CompletedTurn>();
  constructor(readonly callbacks: { completed(event: CompletedTurn): void; cancelled(): void }) {}

  get turnId(): string | undefined {
    return this.#turnId;
  }

  acknowledge(deliveryId: string): void {
    if (this.#finished) return;
    this.#deliveryId = deliveryId;
    this.#resolve();
  }

  adoptTurn(turnId: string): void {
    if (!this.#finished && !this.#turnId) {
      this.#turnId = turnId;
      this.#resolve();
    }
  }

  queue(deliveries: readonly QueueDelivery[]): void {
    if (this.#finished) return;
    const own = deliveries.find((delivery) => delivery.id === this.#deliveryId);
    if (
      (own && ["failed", "cancelled", "interrupted"].includes(own.status)) ||
      (!own && this.#deliveryId && this.#queued && !this.#turnId)
    ) {
      this.#finished = true;
      this.callbacks.cancelled();
      return;
    }
    if (own) this.#queued = true;
    for (const delivery of deliveries) {
      if (
        delivery.turnId &&
        delivery.turnId !== this.#continuedTurnId &&
        ["running", "completed"].includes(delivery.status) &&
        delivery.sender.kind === "user"
      )
        this.#turns.set(delivery.id, delivery.turnId);
    }
    this.#resolve();
  }

  complete(event: CompletedTurn): void {
    if (this.#finished) return;
    if (this.#turnId !== event.turnId) {
      if (!this.#turnId) {
        this.#completed.set(event.turnId, event);
        if (this.#completed.size > 32) {
          const oldest = this.#completed.keys().next().value;
          if (oldest) this.#completed.delete(oldest);
        }
      }
      return;
    }
    if (event.status === "completed" && event.continues) {
      this.#continuedTurnId = event.turnId;
      this.#turnId = undefined;
      this.#turns.clear();
      this.#completed.clear();
      return;
    }
    this.#finished = true;
    this.callbacks.completed(event);
  }

  #resolve(): void {
    if (!this.#turnId && this.#deliveryId) this.#turnId = this.#turns.get(this.#deliveryId);
    const ended = this.#turnId ? this.#completed.get(this.#turnId) : undefined;
    if (ended) this.complete(ended);
  }
}
