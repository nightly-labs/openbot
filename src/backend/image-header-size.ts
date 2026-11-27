import { open } from "node:fs/promises";
import { IMAGE_SIZE_HEADER_BYTES, type ImageSize, imageSizeFromBytes } from "@openbot/contracts/image-size";
import { Effect } from "effect";

const SIZE_MEMORY_LIMIT = 4_096;
export const IMAGE_HEADER_READ_CONCURRENCY = 4;

export const readImageHeaderSize = (path: string) =>
  Effect.tryPromise(async () => {
    const file = await open(path, "r");
    try {
      const header = Buffer.alloc(IMAGE_SIZE_HEADER_BYTES);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      return imageSizeFromBytes(header.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  });

export class ImageSizeMemory {
  readonly #sizes = new Map<string, ImageSize>();

  get(attachmentId: string): ImageSize | undefined {
    return this.#sizes.get(attachmentId);
  }

  remember(attachmentId: string, size: ImageSize): void {
    this.#sizes.delete(attachmentId);
    this.#sizes.set(attachmentId, size);
    if (this.#sizes.size <= SIZE_MEMORY_LIMIT) return;
    const oldest = this.#sizes.keys().next().value;
    if (oldest !== undefined) this.#sizes.delete(oldest);
  }

  readonly measure = Effect.fn("ImageSizeMemory.measure")(function* (
    this: ImageSizeMemory,
    attachments: ReadonlyArray<{ id: string; kind: string; path: string }>,
  ) {
    yield* Effect.forEach(
      attachments.filter((attachment) => attachment.kind === "image"),
      (attachment) =>
        readImageHeaderSize(attachment.path).pipe(
          Effect.tap((size) => Effect.sync(() => size && this.remember(attachment.id, size))),
          Effect.ignore,
        ),
      { concurrency: IMAGE_HEADER_READ_CONCURRENCY, discard: true },
    );
  }).bind(this);
}
