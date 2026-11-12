import {
  AGENT_TASK_LIMIT_DEFAULT,
  type HostTurnLimit,
  type HostTurnLimits,
  type HostTurnLimitsInput,
  isHostAgentTaskLimit,
  isHostTurnLimit,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The turn limits of this host, which an owner or admin sets in Server Settings. Null keeps each one
 * at its default, and a total of "unlimited" sets no limit: the total follows the memory of a server (no limit on a desktop computer), and an
 * agent with no limit of its own runs `AGENT_TASK_LIMIT_DEFAULT` tasks. The backend reads both at
 * each drain, so they are held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or names a value out of range reads that value as its
 * default. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class HostTurnLimitsPreferenceStore {
  readonly #path: string;
  readonly #automaticTurnLimit: () => number | null;
  #limits: HostTurnLimitsInput = { turnLimit: null, agentTaskLimit: null };
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(limits: HostTurnLimits) => void>();

  /** `automaticTurnLimit`: the limit that the memory of this computer sets, or null for no limit. */
  constructor(path: string, automaticTurnLimit: () => number | null) {
    this.#path = path;
    this.#automaticTurnLimit = automaticTurnLimit;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): HostTurnLimitsInput | null =>
          isDynamicRecord(parsed) && parsed.version === 1
            ? {
                turnLimit: isHostTurnLimit(parsed.turnLimit) ? parsed.turnLimit : null,
                agentTaskLimit: isHostAgentTaskLimit(parsed.agentTaskLimit) ? parsed.agentTaskLimit : null,
              }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#limits = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): HostTurnLimits {
    return {
      ...this.#limits,
      automaticTurnLimit: this.#automaticTurnLimit(),
      defaultAgentTaskLimit: AGENT_TASK_LIMIT_DEFAULT,
    };
  }

  /**
   * The total that an owner or admin set, "unlimited" for no limit, or null for automatic: the backend
   * then asks the memory.
   */
  turnLimit(): HostTurnLimit | null {
    return this.#limits.turnLimit;
  }

  /** The task limit of an agent that has no limit of its own. */
  agentTaskLimit(): number {
    return this.#limits.agentTaskLimit ?? AGENT_TASK_LIMIT_DEFAULT;
  }

  /** The caller reads the input with `parseHostTurnLimitsInput` first. */
  readonly set = Effect.fn("HostTurnLimitsPreference.set")(({ turnLimit, agentTaskLimit }: HostTurnLimitsInput) =>
    this.#writes
      .withPermit(
        Effect.uninterruptible(
          writePreferenceFile(this.#path, { version: 1, turnLimit, agentTaskLimit }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#limits = { turnLimit, agentTaskLimit };
              }),
            ),
          ),
        ),
      )
      .pipe(
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
