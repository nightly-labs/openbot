import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { AVATAR_MIME_TYPES, type AvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { Effect, Schema, Stream } from "effect";
import { causeHelpers } from "../effect-boundary";

const SIZE_ERROR =
  "The avatar exceeds 512 KB. Resize or compress a copy with your available tools, then retry with its path. For an animated image, make an animated WebP copy so it keeps moving.";

class AvatarFileFailed extends Schema.TaggedError<AvatarFileFailed>()("AvatarFileFailed", {
  cause: Schema.Defect(),
}) {}

const DAMAGED_ERROR =
  "The image file is damaged or incomplete, so OpenBot cannot show it. Make a new PNG, JPEG, or WebP copy with your available tools, then retry with its path.";

const GIF_ERROR =
  "OpenBot stores pictures as PNG, JPEG, or WebP, not GIF. To keep the animation, make an animated WebP copy up to 512 KB with your available tools, then retry with its path. If you cannot, tell the user that the picture will be still, and that Upload image in the app's picture editor keeps a GIF animated.";

const { io: avatarIo } = causeHelpers(AvatarFileFailed);

export type AvatarImageDecoder = (bytes: Uint8Array) => boolean;

export const loadAvatarFile = Effect.fn("AvatarFile.load")(function* (
  path: string,
  workspacePath: string,
  decode: AvatarImageDecoder | null,
) {
  const source = yield* readSource(resolve(workspacePath, path));
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, source));
  if (!mimeType)
    return yield* new AvatarFileFailed({
      cause: new Error(isGif(source) ? GIF_ERROR : "Choose a valid PNG, JPEG, or WebP avatar image."),
    });
  if (!drawable(mimeType, source, decode)) return yield* new AvatarFileFailed({ cause: new Error(DAMAGED_ERROR) });
  return { mimeType, bytes: source };
});

function isGif(source: Buffer): boolean {
  return source.subarray(0, 4).toString("latin1") === "GIF8";
}

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
