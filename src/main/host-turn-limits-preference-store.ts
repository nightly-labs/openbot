import {
  AGENT_TASK_LIMIT_DEFAULT,
  type HostTurnLimit,
  type HostTurnLimits,
  type HostTurnLimitsInput,
  isHostAgentTaskLimit,
  isHostTurnLimit,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

export class HostTurnLimitsPreferenceStore {
  readonly #store: PreferenceStore<HostTurnLimitsInput>;
  readonly #automaticTurnLimit: () => number | null;
  readonly #listeners = new Set<(limits: HostTurnLimits) => void>();

  constructor(path: string, automaticTurnLimit: () => number | null) {
    this.#store = new PreferenceStore<HostTurnLimitsInput>({
      path,
      defaultValue: { turnLimit: null, agentTaskLimit: null },
      decode: (parsed) =>
        isDynamicRecord(parsed) && parsed.version === 1
          ? {
              turnLimit: isHostTurnLimit(parsed.turnLimit) ? parsed.turnLimit : null,
              agentTaskLimit: isHostAgentTaskLimit(parsed.agentTaskLimit) ? parsed.agentTaskLimit : null,
            }
          : null,
    });
    this.#automaticTurnLimit = automaticTurnLimit;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  get(): HostTurnLimits {
    const { turnLimit, agentTaskLimit } = this.#store.get();
    return {
      turnLimit,
      agentTaskLimit,
      automaticTurnLimit: this.#automaticTurnLimit(),
      defaultAgentTaskLimit: AGENT_TASK_LIMIT_DEFAULT,
    };
  }

  turnLimit(): HostTurnLimit | null {
    return this.#store.get().turnLimit;
  }

  agentTaskLimit(): number {
    return this.#store.get().agentTaskLimit ?? AGENT_TASK_LIMIT_DEFAULT;
  }

  readonly set = Effect.fn("HostTurnLimitsPreference.set")(({ turnLimit, agentTaskLimit }: HostTurnLimitsInput) =>
    this.#store.set({ turnLimit, agentTaskLimit }).pipe(
      Effect.map(() => {
        const saved = this.get();
        for (const listener of this.#listeners) listener(saved);
        return saved;
      }),
    ),
  );

  onChange(listener: (limits: HostTurnLimits) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
