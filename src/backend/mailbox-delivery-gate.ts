/** Prevents delivery insertion across asynchronous agent deletion and attachment preparation. */
export class MailboxDeliveryGate {
  readonly #blockedAgents = new Set<string>();
  readonly #versions = new Map<string, number>();

  block(agentId: string): () => void {
    this.#blockedAgents.add(agentId);
    this.#versions.set(agentId, (this.#versions.get(agentId) ?? 0) + 1);
    return () => this.#blockedAgents.delete(agentId);
  }

  prepare(agentIds: string[]): () => void {
    const versions = agentIds.map((id) => this.#versions.get(id) ?? 0);
    const validate = () => {
      if (
        agentIds.some((id, index) => this.#blockedAgents.has(id) || (this.#versions.get(id) ?? 0) !== versions[index])
      ) {
        throw new Error("The recipient is being deleted. Retry after deletion finishes.");
      }
    };
    validate();
    return validate;
  }
}
