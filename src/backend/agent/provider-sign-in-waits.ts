import { EventEmitter } from "node:events";
import type { AgentStatus } from "@openbot/contracts/ipc";
import type { AgentProvider } from "../agent-client";

export interface ProviderSignInWait {
  agentId: string;
  provider: AgentProvider;
}

export class ProviderSignInWaits extends EventEmitter<{ signInWait: [wait: ProviderSignInWait] }> {
  readonly #waits = new Map<string, AgentProvider>();
  readonly #agentExists: (agentId: string) => boolean;

  constructor(agentExists: (agentId: string) => boolean) {
    super();
    this.#agentExists = agentExists;
  }

  note(agentId: string, provider: AgentProvider): void {
    if (this.#waits.get(agentId) === provider) return;
    this.#waits.set(agentId, provider);
    this.emit("signInWait", { agentId, provider });
  }

  statusChanged(status: Pick<AgentStatus, "providers">): void {
    const providers = status.providers ?? [];
    for (const [agentId, provider] of this.#waits) {
      const available = providers.some((entry) => entry.id === provider && entry.state === "available");
      if (available || !this.#agentExists(agentId)) this.#waits.delete(agentId);
    }
  }
}
