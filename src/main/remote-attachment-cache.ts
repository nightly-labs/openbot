import { playableMediaKind } from "@openbot/contracts/attachment-files";
import { Deferred, Effect, Semaphore } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";

const REMOTE_ATTACHMENT_CACHE_BYTES = 64 * 1024 * 1024;
const REMOTE_ATTACHMENT_CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
const REMOTE_ATTACHMENT_CACHE_MEDIA_BYTES = REMOTE_ATTACHMENT_CACHE_BYTES;

export function canAnswerRemoteRanges(attachment: RemoteAttachment): boolean {
  return (
    playableMediaKind(attachment.mimeType) !== null &&
    attachment.bytes.byteLength <= REMOTE_ATTACHMENT_CACHE_MEDIA_BYTES
  );
}
const REMOTE_ATTACHMENT_CACHE_TTL_MS = 10 * 60_000;
const REMOTE_ATTACHMENT_PREVIEWS_PER_SERVER = 2;

export interface RemoteAttachmentCacheLimits {
  bytes: number;
  ttlMs: number;
  previewsPerServer: number;
}

const FILE_LIMITS: RemoteAttachmentCacheLimits = {
  bytes: REMOTE_ATTACHMENT_CACHE_BYTES,
  ttlMs: REMOTE_ATTACHMENT_CACHE_TTL_MS,
  previewsPerServer: REMOTE_ATTACHMENT_PREVIEWS_PER_SERVER,
};

export const REMOTE_ATTACHMENT_PREVIEW_LIMITS: RemoteAttachmentCacheLimits = {
  bytes: 48 * 1024 * 1024,
  ttlMs: 60 * 60_000,
  previewsPerServer: 6,
};

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

interface PendingDownload {
  serverId: string;
  request: Deferred.Deferred<RemoteAttachment, RemoteWorkflowError>;
  waiting: boolean;
}

interface CacheEntry {
  serverId: string;
  attachment: RemoteAttachment;
  storedAt: number;
}

export class RemoteAttachmentCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #pending = new Map<string, PendingDownload>();
  readonly #downloads = new Map<string, Semaphore.Semaphore>();
  readonly #generations = new Map<string, number>();
  #epoch = 0;
  readonly #now: () => number;
  readonly #limits: RemoteAttachmentCacheLimits;
  #bytes = 0;

  constructor(now: () => number = Date.now, limits: RemoteAttachmentCacheLimits = FILE_LIMITS) {
    this.#now = now;
    this.#limits = limits;
  }

  readonly get = Effect.fn("RemoteAttachments.get")(function* (
    this: RemoteAttachmentCache,
    serverId: string,
    attachmentId: string,
    download: () => Effect.Effect<RemoteAttachment, RemoteWorkflowError>,
    preview = false,
    queued = preview,
  ) {
    this.#removeExpired();
    const key = JSON.stringify([serverId, attachmentId]);
    const entry = this.#entries.get(key);
    if (entry) {
      this.#delete(key, entry);
      this.#entries.set(key, { ...entry, storedAt: this.#now() });
      this.#bytes += entry.attachment.bytes.byteLength;
      return entry.attachment;
    }
    const pending = this.#pending.get(key);
    if (pending && (queued || !preview || !pending.waiting)) return yield* Deferred.await(pending.request);
    const generation = this.#generation(serverId);
    if (pending) {
      pending.waiting = false;
      return yield* this.#settle(key, serverId, generation, pending.request, download(), preview);
    }
    const request = Deferred.makeUnsafe<RemoteAttachment, RemoteWorkflowError>();
    const next: PendingDownload = { serverId, request, waiting: queued };
    this.#pending.set(key, next);
    const transfer = queued
      ? Effect.raceFirst(
          this.#downloadPermits(serverId)
            .withPermit(
              Effect.suspend(() => {
                if (!next.waiting) return Effect.succeed(null);
                next.waiting = false;
                return download();
              }),
            )
            .pipe(Effect.flatMap((attachment) => (attachment === null ? Effect.never : Effect.succeed(attachment)))),
          Deferred.await(request),
        )
      : download();
    return yield* this.#settle(key, serverId, generation, request, transfer, preview);
  });

  #settle(
    key: string,
    serverId: string,
    generation: string,
    request: Deferred.Deferred<RemoteAttachment, RemoteWorkflowError>,
    transfer: Effect.Effect<RemoteAttachment, RemoteWorkflowError>,
    preview: boolean,
  ): Effect.Effect<RemoteAttachment, RemoteWorkflowError> {
    return transfer.pipe(
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
  }

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

  #downloadPermits(serverId: string): Semaphore.Semaphore {
    let permits = this.#downloads.get(serverId);
    if (!permits) {
      permits = Semaphore.makeUnsafe(this.#limits.previewsPerServer);
      this.#downloads.set(serverId, permits);
    }
    return permits;
  }

  #generation(serverId: string): string {
    return `${this.#epoch}:${this.#generations.get(serverId) ?? 0}`;
  }

  #removeExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) if (now - entry.storedAt >= this.#limits.ttlMs) this.#delete(key, entry);
  }

  #store(key: string, serverId: string, attachment: RemoteAttachment, preview = false): void {
    const size = attachment.bytes.byteLength;
    if (size > REMOTE_ATTACHMENT_CACHE_ENTRY_BYTES && !(preview && canAnswerRemoteRanges(attachment))) return;
    this.#removeExpired();
    const previous = this.#entries.get(key);
    if (previous) this.#delete(key, previous);
    for (const [oldestKey, oldest] of this.#entries) {
      if (this.#bytes + size <= this.#limits.bytes) break;
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
