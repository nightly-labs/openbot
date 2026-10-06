import { Effect } from "effect";
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

  /** Ends every disposable generation that may reach an endpoint the user has taken out. */
  readonly stopOpenCode = Effect.fn("ProfileClients.stopOpenCode")(function* (this: ProfileClients) {
    for (const [client, generation] of this.#clients) {
      if (client.provider !== "opencode") continue;
      // The generation is cancelled as well as the client stopped. A generation still preparing its
      // workspace holds no process, so the stop reaches nothing, and its own `start()` would then
      // spawn the process with the endpoints as they were before this change.
      generation.cancelled = true;
      yield* client.stop().pipe(Effect.ignore);
    }
  }).bind(this);

  /** Every client, forgotten, for the caller to stop at shutdown. */
  release(): AgentClient[] {
    const clients = [...this.#clients.keys()];
    this.#clients.clear();
    return clients;
  }
}
