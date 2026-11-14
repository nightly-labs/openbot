import { playableMediaKind } from "@openbot/contracts/attachment-files";
import { Deferred, Effect, Semaphore } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";

// Remote attachments that this computer already downloaded, held in memory for a short time.
//
// A chat image reaches the renderer through `openbot-remote-attachment`, which answers `no-store`,
// so each render downloaded the file from the host again. An attachment id names bytes that do not
// change, so a copy is safe to use again. The copy stays in memory only, within a byte budget and a
// time limit: the host can delete a file, and a removed server must not leave its files behind.

const REMOTE_ATTACHMENT_CACHE_BYTES = 64 * 1024 * 1024;
const REMOTE_ATTACHMENT_CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
// A video or audio file that plays in the chat can use the whole budget. Its player asks for the file
// again from each byte offset, and each miss downloads the whole file from the host again (#8521).
const REMOTE_ATTACHMENT_CACHE_MEDIA_BYTES = REMOTE_ATTACHMENT_CACHE_BYTES;

/**
 * True for a video or audio preview that the cache keeps, so that each byte range request of its player
 * reads the cache. A larger file, or a file of another type, gets the whole file for each request as before:
 * a range answer would make the player ask again many times, and each request would download the file again.
 */
export function canAnswerRemoteRanges(attachment: RemoteAttachment): boolean {
  return (
    playableMediaKind(attachment.mimeType) !== null &&
    attachment.bytes.byteLength <= REMOTE_ATTACHMENT_CACHE_MEDIA_BYTES
  );
}
const REMOTE_ATTACHMENT_CACHE_TTL_MS = 10 * 60_000;
// Previews that download at the same time from one server. The host answers a download only after its
// last byte, and all transfers share one ordered data channel. Eight gallery images that started
// together showed nothing until all of them arrived. Two images of 1.5 MB also stay under the channel's
// 4 MB send buffer, where the host stops and sends again from the last acknowledgement.
const REMOTE_ATTACHMENT_PREVIEWS_PER_SERVER = 2;

/** The user stopped the download. The open or the save that waited for it does nothing. */
export class AttachmentDownloadStopped extends Error {
  constructor() {
    super("The download was stopped.");
    this.name = "AttachmentDownloadStopped";
  }
}

export interface RemoteAttachment {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

interface CacheEntry {
  serverId: string;
  attachment: RemoteAttachment;
  storedAt: number;
}

export class RemoteAttachmentCache {
  // A `Map` iterates in insertion order, so the first entry is the least recently used.
  readonly #entries = new Map<string, CacheEntry>();
  readonly #pending = new Map<
    string,
    { serverId: string; request: Deferred.Deferred<RemoteAttachment, RemoteWorkflowError> }
  >();
  readonly #downloads = new Map<string, Semaphore.Semaphore>();
  // A download that started before `forget` or `clear` must not store its result after it.
  readonly #generations = new Map<string, number>();
  #epoch = 0;
  readonly #now: () => number;
  #bytes = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  readonly get = Effect.fn("RemoteAttachments.get")(function* (
    this: RemoteAttachmentCache,
    serverId: string,
    attachmentId: string,
    download: () => Effect.Effect<RemoteAttachment, RemoteWorkflowError>,
    // A file that the user opens or saves can be 100 MB, so it must not take a preview's place.
    preview = false,
  ) {
    this.#removeExpired();
    const key = JSON.stringify([serverId, attachmentId]);
    const entry = this.#entries.get(key);
    if (entry) {
      this.#delete(key, entry);
      this.#entries.set(key, entry);
      this.#bytes += entry.attachment.bytes.byteLength;
      return entry.attachment;
    }
    const pending = this.#pending.get(key);
    if (pending) return yield* Deferred.await(pending.request);
    const generation = this.#generation(serverId);
    const request = Deferred.makeUnsafe<RemoteAttachment, RemoteWorkflowError>();
    this.#pending.set(key, { serverId, request });
    const transfer = preview ? this.#downloadPermits(serverId).withPermit(download()) : download();
    return yield* transfer.pipe(
      Effect.tap((attachment) =>
        Effect.sync(() => {
          if (this.#generation(serverId) === generation) this.#store(key, serverId, attachment, preview);
        }),
      ),
      Effect.onExit((exit) => Deferred.done(request, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#pending.get(key)?.request === request) this.#pending.delete(key);
        }),
      ),
    );
  });

  /**
   * Keeps the bytes of a file that this computer sends to the host, so its preview does not download
   * the same bytes back. Call it before the upload starts: a `forget` or a `clear` during the upload
   * drops the bytes, as it drops a download that started before it.
   */
  holdUpload(serverId: string): (attachmentId: string, attachment: RemoteAttachment) => void {
    const generation = this.#generation(serverId);
    return (attachmentId, attachment) => {
      if (this.#generation(serverId) === generation)
        this.#store(JSON.stringify([serverId, attachmentId]), serverId, attachment);
    };
  }

  forget(serverId: string): void {
    this.#generations.set(serverId, (this.#generations.get(serverId) ?? 0) + 1);
    for (const [key, entry] of this.#entries) if (entry.serverId === serverId) this.#delete(key, entry);
    for (const [key, pending] of this.#pending) if (pending.serverId === serverId) this.#pending.delete(key);
  }

  clear(): void {
    this.#epoch += 1;
    this.#entries.clear();
    this.#pending.clear();
    this.#bytes = 0;
  }

  // Kept after `forget` and `clear`: a download that still runs holds a permit of its server.
  #downloadPermits(serverId: string): Semaphore.Semaphore {
    let permits = this.#downloads.get(serverId);
    if (!permits) {
      permits = Semaphore.makeUnsafe(REMOTE_ATTACHMENT_PREVIEWS_PER_SERVER);
      this.#downloads.set(serverId, permits);
    }
    return permits;
  }

  #generation(serverId: string): string {
    return `${this.#epoch}:${this.#generations.get(serverId) ?? 0}`;
  }

  // A use moves an entry to the end without a new `storedAt`, so an expired entry can be anywhere.
  #removeExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries)
      if (now - entry.storedAt >= REMOTE_ATTACHMENT_CACHE_TTL_MS) this.#delete(key, entry);
  }

  #store(key: string, serverId: string, attachment: RemoteAttachment, preview = false): void {
    const size = attachment.bytes.byteLength;
    if (size > REMOTE_ATTACHMENT_CACHE_ENTRY_BYTES && !(preview && canAnswerRemoteRanges(attachment))) return;
    this.#removeExpired();
    const previous = this.#entries.get(key);
    if (previous) this.#delete(key, previous);
    for (const [oldestKey, oldest] of this.#entries) {
      if (this.#bytes + size <= REMOTE_ATTACHMENT_CACHE_BYTES) break;
      this.#delete(oldestKey, oldest);
    }
    this.#entries.set(key, { serverId, attachment, storedAt: this.#now() });
    this.#bytes += size;
  }

  #delete(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#bytes -= entry.attachment.bytes.byteLength;
  }
}
