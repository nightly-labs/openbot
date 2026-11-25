import { isCustomProviderHarness } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentClient } from "../agent-client";

const PROFILE_CLIENT_LIMIT = 3;

export class ProfileClients {
  readonly #clients = new Map<AgentClient, { cancelled: boolean }>();

  busy(): boolean {
    return this.#clients.size >= PROFILE_CLIENT_LIMIT;
  }

  hasSpare(): boolean {
    return this.#clients.size < PROFILE_CLIENT_LIMIT - 1;
  }

  usesProvider(provider: AgentClient["provider"]): boolean {
    return [...this.#clients.keys()].some((client) => client.provider === provider);
  }

  run<A, E, R>(
    client: AgentClient,
    generate: (cancelled: () => boolean) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const generation = { cancelled: false };
        this.#clients.set(client, generation);
        return generation;
      }),
      (generation) => generate(() => generation.cancelled),
      () =>
        Effect.sync(() => {
          this.#clients.delete(client);
        }),
    );
  }

  readonly stopEndpointClients = Effect.fn("ProfileClients.stopEndpointClients")(function* (this: ProfileClients) {
    for (const [client, generation] of this.#clients) {
      if (!isCustomProviderHarness(client.provider)) continue;
      generation.cancelled = true;
      yield* client.stop().pipe(Effect.ignore);
    }
  }).bind(this);

  release(): AgentClient[] {
    const clients = [...this.#clients.keys()];
    this.#clients.clear();
    return clients;
  }
}
