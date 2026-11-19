import { Resolver } from "node:dns/promises";
import { Effect, FiberHandle, Layer, Result, Schema } from "effect";
import type { RemoteApiConfig, SignalEntryConfig } from "./config";

const MISSES_TO_LEAVE = 2;
const LOOKUP_TIMEOUT_MILLISECONDS = 3_000;
const LOOKUP_DEADLINE = "10 seconds";

class EntryLookupError extends Schema.TaggedError<EntryLookupError>()("EntryLookupError", {}) {}

export interface SignalEntryHooks {
  readonly whileEntry: Effect.Effect<void>;
  readonly changed: (entry: boolean) => Effect.Effect<void>;
}

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

  get enabled(): boolean {
    return this.#config !== null;
  }

  get isEntry(): boolean {
    return this.#entry;
  }

  get signalId(): string | null {
    return this.#signalId;
  }

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
