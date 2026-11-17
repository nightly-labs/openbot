import type {
  AgentSummary,
  BusyMessageMode,
  CustomMessageMode,
  CustomMessageRoutingSettings,
  SetCustomMessageRoutingInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { PreferenceFileFailure, PreferenceStore } from "./preference-file";

export const CUSTOM_MESSAGE_ROUTING_FILE = "custom-message-routing-v1.json";

const mode = Schema.Literals(["queue", "steer", "thread"]);
const preferencesSchema = Schema.Struct({
  version: Schema.Literal(1),
  mode: Schema.NullOr(mode),
  agents: Schema.Record(
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)),
    Schema.NullOr(mode),
  ),
});
type Preferences = typeof preferencesSchema.Type;
const decode = Schema.decodeUnknownOption(preferencesSchema);

export interface CustomMessageRoutingPreferenceStoreOptions {
  path: string;
  legacyDefault(): BusyMessageMode;
  agents(): readonly AgentSummary[];
}

/**
 * Owns the host's explicit Queue/Steer/Thread choice. A missing file follows released
 * settings. The third mode never enters a released agent, Team API or archive field. An explicit
 * null agent override follows the host, even if an older agent still has a stored own mode.
 */
export class CustomMessageRoutingPreferenceStore {
  readonly #options: CustomMessageRoutingPreferenceStoreOptions;
  readonly #store: PreferenceStore<Preferences>;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(options: CustomMessageRoutingPreferenceStoreOptions) {
    this.#options = options;
    this.#store = new PreferenceStore({
      path: options.path,
      defaultValue: { version: 1, mode: null, agents: {} },
      decode: (value) => {
        const result = decode(value);
        return result._tag === "Some" ? result.value : null;
      },
    });
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  mode(agentId: string): CustomMessageMode {
    const saved = this.#store.get();
    const host = saved.mode ?? this.#options.legacyDefault();
    if (Object.hasOwn(saved.agents, agentId)) return saved.agents[agentId] ?? host;
    return this.#options.agents().find((agent) => agent.id === agentId)?.busyMessageMode ?? host;
  }

  get(): CustomMessageRoutingSettings {
    const saved = this.#store.get();
    return {
      available: true,
      defaultMode: saved.mode ?? this.#options.legacyDefault(),
      agents: Object.fromEntries(
        this.#options
          .agents()
          .map((agent) => [
            agent.id,
            Object.hasOwn(saved.agents, agent.id) ? (saved.agents[agent.id] ?? null) : (agent.busyMessageMode ?? null),
          ]),
      ),
    };
  }

  readonly set = Effect.fn("CustomMessageRoutingPreferenceStore.set")(function* (
    this: CustomMessageRoutingPreferenceStore,
    input: SetCustomMessageRoutingInput,
  ) {
    return yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const current = this.#store.get();
        if (input.agentIds) {
          const known = new Set(this.#options.agents().map((agent) => agent.id));
          if (input.agentIds.some((id) => !known.has(id)))
            return yield* new PreferenceFileFailure({
              cause: new Error(sourceText("error.team.agentNotFound")),
            });
          const agents = { ...current.agents };
          for (const id of input.agentIds) agents[id] = input.mode;
          yield* this.#store.set({ ...current, agents });
        } else {
          yield* this.#store.set({ ...current, mode: input.mode });
        }
        return this.get();
      }),
    );
  });

  /** An existing Queue/Steer editor remains able to replace the host's Thread choice. */
  readonly followLegacyDefault = Effect.fn("CustomMessageRoutingPreferenceStore.followLegacyDefault")(function* (
    this: CustomMessageRoutingPreferenceStore,
  ) {
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const current = this.#store.get();
        if (current.mode !== null) yield* this.#store.set({ ...current, mode: null });
      }),
    );
  });

  /** An existing per-agent editor replaces a routing override when it changes the busy mode. */
  readonly followLegacyAgent = Effect.fn("CustomMessageRoutingPreferenceStore.followLegacyAgent")(function* (
    this: CustomMessageRoutingPreferenceStore,
    agentId: string,
  ) {
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const current = this.#store.get();
        if (!Object.hasOwn(current.agents, agentId)) return;
        const agents = { ...current.agents };
        delete agents[agentId];
        yield* this.#store.set({ ...current, agents });
      }),
    );
  });
}
