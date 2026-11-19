import {
  type AgentMemoryLimitPreference,
  DEFAULT_AGENT_MEMORY_LIMIT,
  isAgentMemoryLimit,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export class AgentMemoryLimitPreferenceStore {
  readonly #path: string;
  #preference: AgentMemoryLimitPreference = { limit: DEFAULT_AGENT_MEMORY_LIMIT };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): AgentMemoryLimitPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isAgentMemoryLimit(parsed.limit)
            ? { limit: parsed.limit }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): AgentMemoryLimitPreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("AgentMemoryLimitPreference.set")(function* (
    this: AgentMemoryLimitPreferenceStore,
    { limit }: AgentMemoryLimitPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, limit }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { limit };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}

export interface AgentMemoryLimitSetting {
  get(): AgentMemoryLimitPreference;
  set(preference: AgentMemoryLimitPreference): Effect.Effect<AgentMemoryLimitPreference, PreferenceFileFailure>;
  subscribe(listener: (preference: AgentMemoryLimitPreference) => void): () => void;
}

export function reloadingAgentMemoryLimit(
  store: AgentMemoryLimitPreferenceStore,
  agents: { memoryLimitChanged(): void },
): AgentMemoryLimitSetting {
  const listeners = new Set<(preference: AgentMemoryLimitPreference) => void>();
  return {
    get: () => store.get(),
    set: (preference) =>
      store.set(preference).pipe(
        Effect.tap((saved) =>
          Effect.sync(() => {
            agents.memoryLimitChanged();
            for (const listener of listeners) listener(saved);
          }),
        ),
      ),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
