import { DEFAULT_REMOTE_CHAT_CONTENT_PREFERENCE, type RemoteChatContentPreference } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export class RemoteChatContentPreferenceStore {
  readonly #path: string;
  #preference: RemoteChatContentPreference = { ...DEFAULT_REMOTE_CHAT_CONTENT_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(preference: RemoteChatContentPreference) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): RemoteChatContentPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && typeof parsed.enabled === "boolean"
            ? { enabled: parsed.enabled }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): RemoteChatContentPreference {
    return { ...this.#preference };
  }

  onChange(listener: (preference: RemoteChatContentPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly set = Effect.fn("RemoteChatContentPreference.set")(function* (
    this: RemoteChatContentPreferenceStore,
    { enabled }: RemoteChatContentPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, enabled }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const changed = this.#preference.enabled !== enabled;
              this.#preference = { enabled };
              const current = this.get();
              if (changed) for (const listener of this.#listeners) listener(current);
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
