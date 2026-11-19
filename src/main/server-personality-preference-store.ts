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

  onChange(listener: (personality: HostPersonality) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

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
