import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { type VersionedJsonFile, type WriteJsonFileOptions, writeFileAtomically } from "../backend/atomic-json-file";

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
  return writeFileAtomically(path, `${JSON.stringify(value)}\n`, options).pipe(
    Effect.mapError(({ cause }) => new PreferenceFileFailure({ cause })),
  );
}
