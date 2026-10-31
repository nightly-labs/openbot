import { Resolver } from "node:dns/promises";
import { Effect, FiberHandle, Layer, Result, Schema } from "effect";
import type { RemoteApiConfig, SignalEntryConfig } from "./config";

// This machine leaves the entry after this number of answers in a row without its address. One wrong
// answer does not move traffic. One answer with its address makes it the entry again.
const MISSES_TO_LEAVE = 2;
// The resolver tries each server two times with this timeout. The deadline stops a lookup that hangs.
const LOOKUP_TIMEOUT_MILLISECONDS = 3_000;
const LOOKUP_DEADLINE = "10 seconds";

class EntryLookupError extends Schema.TaggedError<EntryLookupError>()("EntryLookupError", {}) {}

export interface SignalEntryHooks {
  /** Runs while this machine is the entry. Signal interrupts it when the machine leaves the entry. */
  readonly whileEntry: Effect.Effect<void>;
  /** Runs after each change: after `whileEntry` starts, and before it stops. */
  readonly changed: (entry: boolean) => Effect.Effect<void>;
}

/**
 * Whether this Signal is the entry: the machine that `SIGNAL_ENTRY_HOST` (`signal.openbot.run`) names.
 * The entry takes the tickets without a `signal` claim (released hosts and their clients, `ingress`
 * sockets) and the bots. A load balancer in failover mode moves the name when the entry machine stops.
 *
 * Signal resolves the name every 30 seconds. An answer with `SIGNAL_PUBLIC_IPV4` makes this machine the
 * entry; two answers in a row without it end the entry. A failed lookup keeps the state. Without the
 * two settings, this machine is always the entry.
 */
export class SignalEntry {
  readonly #config: SignalEntryConfig | null;
  readonly #signalId: string | null;
  readonly #resolver: Resolver;
  #entry = true;
  #misses = 0;

  constructor(config: Pick<RemoteApiConfig, "entry" | "signalId">) {
    this.#config = config.entry;
    this.#signalId = config.signalId;
    this.#resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MILLISECONDS, tries: 2 });
    if (config.entry?.dnsServer) this.#resolver.setServers([config.entry.dnsServer]);
  }

  /** Whether the entry rule is on: `SIGNAL_ENTRY_HOST` and `SIGNAL_PUBLIC_IPV4` are set. */
  get enabled(): boolean {
    return this.#config !== null;
  }

  get isEntry(): boolean {
    return this.#entry;
  }

  /** `SIGNAL_ID`, for the metric label. */
  get signalId(): string | null {
    return this.#signalId;
  }

  /**
   * Resolves the entry name once before the layer is ready, so that Signal listens and starts the
   * Discord Gateway with a known state. That first answer decides alone, because there is no state to
   * keep yet. A first lookup that fails keeps the start state: entry. Then the layer resolves the name
   * after each interval until it closes.
   */
  watch(hooks: SignalEntryHooks): Layer.Layer<never> {
    const config = this.#config;
    return Layer.effectDiscard(
      Effect.gen({ self: this }, function* () {
        const handle = yield* FiberHandle.make<void>();
        const start = FiberHandle.run(handle, hooks.whileEntry, { onlyIfMissing: true });
        if (!config) {
          yield* start;
          return;
        }
        const first = yield* this.#lookup(config);
        if (Result.isSuccess(first)) {
          this.#entry = first.success.includes(config.publicIpv4);
          this.#misses = this.#entry ? 0 : 1;
        }
        console.log(
          this.#entry
            ? "OpenBot Signal is the entry."
            : `OpenBot Signal is not the entry: ${config.host} names another machine.`,
        );
        if (this.#entry) yield* start;
        const check = Effect.gen({ self: this }, function* () {
          const answer = yield* this.#lookup(config);
          if (Result.isFailure(answer)) return;
          const listed = answer.success.includes(config.publicIpv4);
          this.#misses = listed ? 0 : this.#misses + 1;
          const entry = listed || (this.#entry && this.#misses < MISSES_TO_LEAVE);
          if (entry === this.#entry) return;
          this.#entry = entry;
          console.log(entry ? "OpenBot Signal is the entry again." : "OpenBot Signal is no longer the entry.");
          if (entry) {
            yield* start;
            yield* hooks.changed(true);
          } else {
            yield* hooks.changed(false);
            yield* FiberHandle.clear(handle);
          }
        });
        yield* Effect.forkScoped(check.pipe(Effect.delay(config.checkIntervalMilliseconds), Effect.forever));
      }),
    );
  }

  /** The IPv4 addresses of the entry name. The result holds a failure, which keeps the state. */
  #lookup(config: SignalEntryConfig) {
    return Effect.tryPromise({
      try: () => this.#resolver.resolve4(config.host),
      catch: () => new EntryLookupError(),
    }).pipe(
      Effect.timeoutOrElse({ duration: LOOKUP_DEADLINE, orElse: () => Effect.fail(new EntryLookupError()) }),
      Effect.result,
    );
  }
}
