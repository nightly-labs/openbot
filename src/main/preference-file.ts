import { readFile } from "node:fs/promises";
import { Effect, Result, Schema, Semaphore } from "effect";
import {
  type VersionedJsonFile,
  type WriteJsonFileOptions,
  writeJsonFileAtomically,
} from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

export class PreferenceFileFailure extends Schema.TaggedError<PreferenceFileFailure>()("PreferenceFileFailure", {
  cause: Schema.Defect(),
}) {}

export const readPreferenceFile = Effect.fn("PreferenceFile.read")(function* <A>(
  path: string,
  decode: (value: unknown) => A,
) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => new PreferenceFileFailure({ cause }),
  });
  return yield* Effect.try({
    try: () => decode(JSON.parse(text)),
    catch: (cause) => new PreferenceFileFailure({ cause }),
  });
});

export function writePreferenceFile<A extends VersionedJsonFile>(
  path: string,
  value: A,
  options: WriteJsonFileOptions = {},
): Effect.Effect<void, PreferenceFileFailure> {
  return writeJsonFileAtomically(path, value, options).pipe(
    Effect.mapError(({ cause }) => new PreferenceFileFailure({ cause })),
  );
}

/**
 * One small version 1 preference that main holds in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or that `decode` rejects with `null` reads as the
 * default. Writes are chained for the reason `update-preference-store.ts` chains its own: an earlier
 * rename that lands last would persist the value the user just changed.
 */
export class PreferenceStore<A extends object> {
  readonly #path: string;
  readonly #decode: (parsed: unknown) => A | null;
  #value: A;
  #writes = Semaphore.makeUnsafe(1);

  constructor(options: { path: string; defaultValue: A; decode: (parsed: unknown) => A | null }) {
    this.#path = options.path;
    this.#decode = options.decode;
    this.#value = { ...options.defaultValue };
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, this.#decode));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#value = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): A {
    return { ...this.#value };
  }

  readonly set = Effect.fn("PreferenceStore.set")(function* (this: PreferenceStore<A>, value: A) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, ...value }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#value = { ...value };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
