import {
  DEFAULT_RESPONSE_STYLE,
  type HostPersonality,
  isResponseStyle,
  type ResponseStyle,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The server personality: how the server's agents talk while they work. The prompt of each agent and
 * the chat of each client follow it.
 *
 * A file that is missing, unreadable as JSON, or names an unknown style reads as the default,
 * `natural`. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class ServerPersonalityPreferenceStore {
  readonly #path: string;
  #responseStyle: ResponseStyle = DEFAULT_RESPONSE_STYLE;
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(personality: HostPersonality) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(
          this.#path,
          (parsed): ResponseStyle =>
            isDynamicRecord(parsed) && parsed.version === 1 && isResponseStyle(parsed.responseStyle)
              ? parsed.responseStyle
              : DEFAULT_RESPONSE_STYLE,
        ),
      );
      if (Result.isSuccess(loaded)) this.#responseStyle = loaded.success;
      else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): HostPersonality {
    return { responseStyle: this.#responseStyle };
  }

  responseStyle(): ResponseStyle {
    return this.#responseStyle;
  }

  /** Calls `listener` after each saved change. Returns the function that removes it. */
  onChange(listener: (personality: HostPersonality) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The caller reads the value with `parseServerPersonality` first. */
  readonly set = Effect.fn("ServerPersonalityPreference.set")((personality: HostPersonality) =>
    this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, responseStyle: personality.responseStyle }).pipe(
          Effect.map(() => {
            const changed = this.#responseStyle !== personality.responseStyle;
            this.#responseStyle = personality.responseStyle;
            const current = this.get();
            if (changed) for (const listener of this.#listeners) listener(current);
            return current;
          }),
        ),
      ),
    ),
  );
}

export function parseServerPersonality(value: unknown): HostPersonality {
  if (!isDynamicRecord(value) || !isResponseStyle(value.responseStyle))
    throw new Error(sourceText("error.host.personalityInvalid"));
  return { responseStyle: value.responseStyle };
}
