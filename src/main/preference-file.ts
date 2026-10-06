import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import {
  type VersionedJsonFile,
  type WriteJsonFileOptions,
  writeJsonFileAtomically,
} from "../backend/atomic-json-file";

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
