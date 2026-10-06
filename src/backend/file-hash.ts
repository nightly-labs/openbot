import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Effect, Schema, Stream } from "effect";

class FileHashFailure extends Schema.TaggedError<FileHashFailure>()("FileHashFailure", {
  cause: Schema.Defect(),
}) {}

/** Reads a file as a stream and releases it on completion or interruption. */
export const sha256File = Effect.fn("FileHash.sha256")(function* (path: string) {
  const hash = createHash("sha256");
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createReadStream(path)),
    (stream) =>
      Stream.fromAsyncIterable(stream, (cause) => new FileHashFailure({ cause })).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            hash.update(chunk);
          }),
        ),
      ),
    (stream) =>
      Effect.sync(() => {
        stream.destroy();
      }),
  );
  return hash.digest("hex");
});
