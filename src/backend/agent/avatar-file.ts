import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { AVATAR_MIME_TYPES, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { Effect, Schema, Stream } from "effect";

const SIZE_ERROR =
  "The avatar exceeds 512 KB. Resize or compress a copy with your available tools, then retry with its path.";

export class AvatarFileFailed extends Schema.TaggedError<AvatarFileFailed>()("AvatarFileFailed", {
  cause: Schema.Defect(),
}) {}

export const loadAvatarFile = Effect.fn("AvatarFile.load")(function* (path: string, workspacePath: string) {
  const source = yield* readSource(resolve(workspacePath, path));
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, source));
  if (!mimeType)
    return yield* new AvatarFileFailed({ cause: new Error("Choose a valid PNG, JPEG, or WebP avatar image.") });
  return { mimeType, bytes: source };
});

const readSource = Effect.fn("AvatarFile.readSource")((path: string) =>
  Effect.acquireUseRelease(
    avatarIo(() => open(path, "r")).pipe(
      Effect.mapError(
        () =>
          new AvatarFileFailed({
            cause: new Error("OpenBot could not open the avatar file. Use an existing local image path."),
          }),
      ),
    ),
    (file) =>
      Effect.gen(function* () {
        const metadata = yield* avatarIo(() => file.stat());
        if (!metadata.isFile())
          return yield* new AvatarFileFailed({ cause: new Error("The avatar path must refer to a regular file.") });
        if (metadata.size > AVATAR_IMAGE_LIMITS.storedBytes)
          return yield* new AvatarFileFailed({ cause: new Error(SIZE_ERROR) });
        const chunks: Buffer[] = [];
        let length = 0;
        yield* Effect.acquireUseRelease(
          Effect.sync(() => file.createReadStream({ autoClose: false, end: AVATAR_IMAGE_LIMITS.storedBytes })),
          (stream) =>
            Stream.fromAsyncIterable<Buffer, AvatarFileFailed>(stream, (cause) => new AvatarFileFailed({ cause })).pipe(
              Stream.runForEach((chunk) =>
                Effect.gen(function* () {
                  length += chunk.length;
                  if (length > AVATAR_IMAGE_LIMITS.storedBytes)
                    return yield* new AvatarFileFailed({ cause: new Error(SIZE_ERROR) });
                  chunks.push(chunk);
                }),
              ),
            ),
          (stream) =>
            Effect.sync(() => {
              stream.destroy();
            }),
        );
        return Buffer.concat(chunks, length);
      }),
    (file) => avatarIo(() => file.close()),
  ),
);

function avatarIo<A>(run: () => Promise<A>): Effect.Effect<A, AvatarFileFailed> {
  return Effect.tryPromise({ try: run, catch: (cause) => new AvatarFileFailed({ cause }) });
}
