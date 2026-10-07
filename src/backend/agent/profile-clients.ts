import { Effect } from "effect";
import type { AgentClient } from "../agent-client";
import type { ChannelOperationError } from "../channel-effects";

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
  readonly #clients = new Map<AgentClient, { cancelled: boolean; active: boolean }>();
  readonly #waiters = new Set<() => void>();

  constructor(readonly released: () => Effect.Effect<void, ChannelOperationError> = () => Effect.void) {}

  count(): number {
    return this.#clients.size;
  }

  /** Whether a new profile generation must wait. */
  busy(): boolean {
    return this.#clients.size >= PROFILE_CLIENT_LIMIT;
  }

  /** Runs one generation on `client`, and forgets the client when it ends. */
  run<A, E, R>(
    client: AgentClient,
    generate: (cancelled: () => boolean) => Effect.Effect<A, E, R>,
    signal?: AbortSignal,
  ): Effect.Effect<A, E | ChannelOperationError, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const generation = { cancelled: false, active: false };
        const abort = () => {
          generation.cancelled = true;
          for (const wake of this.#waiters) wake();
          this.#waiters.clear();
        };
        this.#clients.set(client, generation);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        return { generation, abort };
      }),
      ({ generation }) =>
        Effect.gen({ self: this }, function* () {
          while (
            !generation.cancelled &&
            [...this.#clients.values()].filter((entry) => entry.active).length >= PROFILE_CLIENT_LIMIT
          ) {
            yield* Effect.callback<void>((resume) => {
              const wake = () => resume(Effect.void);
              this.#waiters.add(wake);
              return Effect.sync(() => {
                this.#waiters.delete(wake);
              });
            });
          }
          generation.active = true;
          return yield* generate(() => generation.cancelled);
        }),
      ({ abort }) =>
        Effect.gen({ self: this }, function* () {
          signal?.removeEventListener("abort", abort);
          this.#clients.delete(client);
          for (const wake of this.#waiters) wake();
          this.#waiters.clear();
          yield* this.released();
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
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
  }).bind(this);

  /** Every client, forgotten, for the caller to stop at shutdown. */
  release(): AgentClient[] {
    const clients = [...this.#clients.keys()];
    for (const generation of this.#clients.values()) generation.cancelled = true;
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
    this.#clients.clear();
    return clients;
  }
}
