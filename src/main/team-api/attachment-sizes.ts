import { closeSync, openSync, readSync } from "node:fs";
import { IMAGE_SIZE_HEADER_BYTES, type ImageSize, imageSizeFromBytes } from "@openbot/contracts/image-size";
import type { AttachmentSizeLookup } from "@openbot/contracts/team-protocol/attachment-dimensions-v1";
import { Effect } from "effect";

const CACHE_LIMIT = 4_096;
const MISS_RETRY_MS = 30_000;

export type AttachmentPathLookup = (attachmentId: string) => string | null;

interface CachedSize {
  size: ImageSize | null;
  retryAt: number | null;
}

function readHeaderSize(path: string): ImageSize | null {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(IMAGE_SIZE_HEADER_BYTES);
    const length = readSync(descriptor, header, 0, header.length, 0);
    return imageSizeFromBytes(header.subarray(0, length));
  } finally {
    closeSync(descriptor);
  }
}

const readAttachmentSize = (pathOf: AttachmentPathLookup, attachmentId: string) =>
  Effect.try(() => {
    const path = pathOf(attachmentId);
    return path === null ? { size: null, found: false } : { size: readHeaderSize(path), found: true };
  }).pipe(Effect.orElseSucceed(() => ({ size: null, found: false })));

export function createAttachmentSizeCache(pathOf: AttachmentPathLookup, now = Date.now): AttachmentSizeLookup {
  const sizes = new Map<string, CachedSize>();
  return (attachmentId) => {
    const cached = sizes.get(attachmentId);
    if (cached && (cached.retryAt === null || now() < cached.retryAt)) return cached.size;
    const { size, found } = Effect.runSync(readAttachmentSize(pathOf, attachmentId));
    sizes.delete(attachmentId);
    sizes.set(attachmentId, { size, retryAt: found ? null : now() + MISS_RETRY_MS });
    if (sizes.size > CACHE_LIMIT) {
      const oldest = sizes.keys().next().value;
      if (oldest !== undefined) sizes.delete(oldest);
    }
    return size;
  };
}
