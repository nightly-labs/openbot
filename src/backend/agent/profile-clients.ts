import type { AgentClient } from "../agent-client";

/** How many disposable generations may run at once. */
const PROFILE_CLIENT_LIMIT = 3;

/**
 * Owns every disposable client that is generating, with the record that ends its generation: a
 * profile draft, and a channel lead's text. A client alone is not enough to stop the work: it may
 * not hold a process yet.
 *
 * It never imports the agent service facade.
 */
export class ProfileClients {
  readonly #clients = new Map<AgentClient, { cancelled: boolean }>();

  /** Whether a new profile generation must wait. */
  busy(): boolean {
    return this.#clients.size >= PROFILE_CLIENT_LIMIT;
  }

  /** Runs one generation on `client`, and forgets the client when it ends. */
  async run<T>(client: AgentClient, generate: (cancelled: () => boolean) => Promise<T>): Promise<T> {
    const generation = { cancelled: false };
    this.#clients.set(client, generation);
    try {
      return await generate(() => generation.cancelled);
    } finally {
      this.#clients.delete(client);
    }
  }

  /** Ends every disposable generation that may reach an endpoint the user has taken out. */
  stopOpenCode(): void {
    for (const [client, generation] of this.#clients) {
      if (client.provider !== "opencode") continue;
      // The generation is cancelled as well as the client stopped. A generation still preparing its
      // workspace holds no process, so the stop reaches nothing, and its own `start()` would then
      // spawn the process with the endpoints as they were before this change.
      generation.cancelled = true;
      void client.stop().catch(() => undefined);
    }
  }

  /** Every client, forgotten, for the caller to stop at shutdown. */
  release(): AgentClient[] {
    const clients = [...this.#clients.keys()];
    this.#clients.clear();
    return clients;
  }
}
