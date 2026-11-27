import type { ImageSize } from "@openbot/contracts/image-size";
import type { AttachmentSizeLookup } from "@openbot/contracts/team-protocol/attachment-dimensions-v1";
import { Effect } from "effect";
import { readImageHeaderSize } from "../../backend/image-header-size";

const CACHE_LIMIT = 4_096;
const MISS_RETRY_MS = 30_000;

export interface AttachmentSizeSources {
  known: (attachmentIds: ReadonlySet<string>) => ReadonlyMap<string, ImageSize>;
  paths: (attachmentIds: ReadonlySet<string>) => ReadonlyMap<string, string>;
}

interface CachedSize {
  size: ImageSize | null;
  retryAt: number | null;
}

function lookup<T>(
  read: (attachmentIds: ReadonlySet<string>) => ReadonlyMap<string, T>,
  attachmentIds: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  return Effect.runSync(
    Effect.try(() => read(attachmentIds)).pipe(Effect.orElseSucceed((): ReadonlyMap<string, T> => new Map())),
  );
}

export function createAttachmentSizeCache(sources: AttachmentSizeSources, now = Date.now): AttachmentSizeLookup {
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
      readImageHeaderSize(path).pipe(
        Effect.tap((size) => Effect.sync(() => remember(attachmentId, { size, retryAt: null }))),
        Effect.ensuring(Effect.sync(() => reading.delete(attachmentId))),
      ),
    );
  };
  return (attachmentIds) => {
    const found = new Map(lookup(sources.known, attachmentIds));
    const unknown = new Set<string>();
    for (const attachmentId of attachmentIds) {
      if (found.has(attachmentId)) continue;
      const cached = sizes.get(attachmentId);
      if (cached && (cached.retryAt === null || now() < cached.retryAt)) {
        if (cached.size) found.set(attachmentId, cached.size);
      } else if (!reading.has(attachmentId)) unknown.add(attachmentId);
    }
    if (unknown.size === 0) return found;
    const paths = lookup(sources.paths, unknown);
    for (const attachmentId of unknown) {
      const path = paths.get(attachmentId);
      if (path === undefined) remember(attachmentId, { size: null, retryAt: now() + MISS_RETRY_MS });
      else fill(attachmentId, path);
    }
    return found;
  };
}
