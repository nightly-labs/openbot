import { open } from "node:fs/promises";
import { IMAGE_SIZE_HEADER_BYTES, type ImageSize, imageSizeFromBytes } from "@openbot/contracts/image-size";
import type { AttachmentSizeLookup } from "@openbot/contracts/team-protocol/attachment-dimensions-v1";
import { Effect } from "effect";

const CACHE_LIMIT = 4_096;
const MISS_RETRY_MS = 30_000;

export type AttachmentPathsLookup = (attachmentIds: ReadonlySet<string>) => ReadonlyMap<string, string>;

interface CachedSize {
  size: ImageSize | null;
  retryAt: number | null;
}

const NO_PATHS: ReadonlyMap<string, string> = new Map();

const findPaths = (pathsOf: AttachmentPathsLookup, attachmentIds: ReadonlySet<string>) =>
  Effect.try(() => pathsOf(attachmentIds)).pipe(Effect.orElseSucceed(() => NO_PATHS));

const readHeaderSize = (path: string) =>
  Effect.tryPromise(async () => {
    const file = await open(path, "r");
    try {
      const header = Buffer.alloc(IMAGE_SIZE_HEADER_BYTES);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      return imageSizeFromBytes(header.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  }).pipe(Effect.orElseSucceed(() => null));

export function createAttachmentSizeCache(pathsOf: AttachmentPathsLookup, now = Date.now): AttachmentSizeLookup {
  const sizes = new Map<string, CachedSize>();
  const reading = new Set<string>();
  const remember = (attachmentId: string, entry: CachedSize) => {
    sizes.delete(attachmentId);
    sizes.set(attachmentId, entry);
    if (sizes.size <= CACHE_LIMIT) return;
    const oldest = sizes.keys().next().value;
    if (oldest !== undefined) sizes.delete(oldest);
  };
  const fill = (attachmentId: string, path: string) => {
    reading.add(attachmentId);
    void Effect.runPromise(
      readHeaderSize(path).pipe(
        Effect.tap((size) => Effect.sync(() => remember(attachmentId, { size, retryAt: null }))),
        Effect.ensuring(Effect.sync(() => reading.delete(attachmentId))),
      ),
    );
  };
  return (attachmentIds) => {
    const found = new Map<string, ImageSize>();
    const unknown = new Set<string>();
    for (const attachmentId of attachmentIds) {
      const cached = sizes.get(attachmentId);
      if (cached && (cached.retryAt === null || now() < cached.retryAt)) {
        if (cached.size) found.set(attachmentId, cached.size);
      } else if (!reading.has(attachmentId)) unknown.add(attachmentId);
    }
    if (unknown.size === 0) return found;
    const paths = Effect.runSync(findPaths(pathsOf, unknown));
    for (const attachmentId of unknown) {
      const path = paths.get(attachmentId);
      if (path === undefined) remember(attachmentId, { size: null, retryAt: now() + MISS_RETRY_MS });
      else fill(attachmentId, path);
    }
    return found;
  };
}
