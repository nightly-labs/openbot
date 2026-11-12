import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { AVATAR_MIME_TYPES, type AvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { Effect, Schema, Stream } from "effect";
import { causeHelpers } from "../effect-boundary";

const SIZE_ERROR =
  "The avatar exceeds 512 KB. Resize or compress a copy with your available tools, then retry with its path.";

class AvatarFileFailed extends Schema.TaggedError<AvatarFileFailed>()("AvatarFileFailed", {
  cause: Schema.Defect(),
}) {}

const DAMAGED_ERROR =
  "The image file is damaged or incomplete, so OpenBot cannot show it. Make a new PNG, JPEG, or WebP copy with your available tools, then retry with its path.";

const { io: avatarIo } = causeHelpers(AvatarFileFailed);

/**
 * Decodes a whole PNG or JPEG file and says whether the app can draw it. The main process gives
 * Electron's decoder; a process without Electron, such as an E2E script, has none.
 */
export type AvatarImageDecoder = (bytes: Uint8Array) => boolean;

/**
 * An image file from an agent. Its first bytes say only which format it claims: a cut or damaged
 * file keeps them, so it was saved, the tool reported success, and the app then showed the old
 * picture in its place without an error. The file is therefore decoded before it is used.
 */
export const loadAvatarFile = Effect.fn("AvatarFile.load")(function* (
  path: string,
  workspacePath: string,
  decode: AvatarImageDecoder | null,
) {
  const source = yield* readSource(resolve(workspacePath, path));
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, source));
  if (!mimeType)
    return yield* new AvatarFileFailed({ cause: new Error("Choose a valid PNG, JPEG, or WebP avatar image.") });
  if (!drawable(mimeType, source, decode)) return yield* new AvatarFileFailed({ cause: new Error(DAMAGED_ERROR) });
  return { mimeType, bytes: source };
});

/**
 * Electron cannot decode WebP, so a WebP file must at least hold the whole RIFF chunk that its
 * header gives: a cut file is shorter. Bytes after the chunk are allowed, as a browser ignores them.
 */
function drawable(mimeType: AvatarMimeType, source: Buffer, decode: AvatarImageDecoder | null): boolean {
  if (mimeType === "image/webp") return source.byteLength >= 8 + source.readUInt32LE(4);
  return decode === null || decode(source);
}

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
