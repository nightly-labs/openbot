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

/**
 * The turn limits of this host, which an owner or admin sets in Server Settings. Null keeps each one
 * at its default, and a total of "unlimited" sets no limit: the total follows the memory of a server
 * (no limit on a desktop computer), and an agent with no limit of its own runs
 * `AGENT_TASK_LIMIT_DEFAULT` tasks. The backend reads both at each drain, so they are held in memory
 * after `load`.
 *
 * A file that is missing or unreadable as JSON reads as the defaults, and a value out of range reads
 * as its default.
 */
export class HostTurnLimitsPreferenceStore {
  readonly #store: PreferenceStore<HostTurnLimitsInput>;
  readonly #automaticTurnLimit: () => number | null;
  readonly #listeners = new Set<(limits: HostTurnLimits) => void>();

  /** `automaticTurnLimit`: the limit that the memory of this computer sets, or null for no limit. */
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

  /**
   * The total that an owner or admin set, "unlimited" for no limit, or null for automatic: the backend
   * then asks the memory.
   */
  turnLimit(): HostTurnLimit | null {
    return this.#store.get().turnLimit;
  }

  /** The task limit of an agent that has no limit of its own. */
  agentTaskLimit(): number {
    return this.#store.get().agentTaskLimit ?? AGENT_TASK_LIMIT_DEFAULT;
  }

  /** The caller reads the input with `parseHostTurnLimitsInput` first. */
  readonly set = Effect.fn("HostTurnLimitsPreference.set")(({ turnLimit, agentTaskLimit }: HostTurnLimitsInput) =>
    this.#store.set({ turnLimit, agentTaskLimit }).pipe(
      Effect.map(() => {
        const saved = this.get();
        for (const listener of this.#listeners) listener(saved);
        return saved;
      }),
    ),
  );

  /** Called after each save, so the backend starts the turns that a higher limit lets start. */
  onChange(listener: (limits: HostTurnLimits) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
