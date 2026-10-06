import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isString } from "@openbot/contracts/runtime-values";
import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2FileChunk,
  encodeTeamProtocolV2Frame,
  TEAM_PROTOCOL_V2_MAX_FILE_BYTES,
  TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES,
} from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Semaphore } from "effect";
import { sha256File } from "../backend/file-hash";
import { recordRestartActivity } from "../backend/restart-activity";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";

const FILE_CHUNK_BYTES = 60 * 1024;
const ACK_INTERVAL_BYTES = 1024 * 1024;
const TRANSFER_RESUME_MILLISECONDS = 10 * 60_000;

interface IncomingTransfer {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  path: string;
  file: FileHandle;
  received: number;
  lastAcknowledged: number;
}

interface OutgoingTransfer {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  /** Returns `length` bytes at `offset`. The source is memory or a file in the transfer directory. */
  read: (offset: number, length: number) => Promise<Uint8Array>;
  sha256: string;
  acknowledged: number;
  acknowledgementGeneration: number;
  lastProgressAt: number;
  cancelled: Error | null;
}

export interface ReceivedWebRtcFile {
  peerId: string;
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export class TeamWebRtcFileTransfer {
  readonly #bridge: TeamWebRtcBridge;
  readonly #writingAbort = new AbortController();
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #directory: string;
  readonly #resumeMilliseconds: number;
  readonly #acceptPeer: (peerId: string) => boolean;
  readonly #incoming = new Map<string, IncomingTransfer>();
  readonly #outgoing = new Map<string, OutgoingTransfer>();
  /** The streams that `sendStream` still writes to disk, with the bytes written so far. */
  readonly #writing = new Set<{ peerId: string; size: number }>();
  readonly #completed = new Map<string, ReceivedWebRtcFile>();
  readonly #expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #waiters = new Map<
    string,
    {
      resolve: (file: ReceivedWebRtcFile) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #frames = Semaphore.makeUnsafe(1);
  readonly #connectedPeers = new Set<string>();
  readonly #stateWaiters = new Set<() => void>();
  #stopped = false;

  constructor(
    bridge: TeamWebRtcBridge,
    directory: string,
    resumeMilliseconds = TRANSFER_RESUME_MILLISECONDS,
    acceptPeer: (peerId: string) => boolean = () => true,
  ) {
    this.#bridge = bridge;
    this.#directory = directory;
    this.#resumeMilliseconds = resumeMilliseconds;
    this.#acceptPeer = acceptPeer;
    bridge.on("data", this.#onData);
    bridge.on("disconnected", this.#onDisconnected);
  }

  setPeerAuthenticated(peerId: string, authenticated: boolean): void {
    if (authenticated) this.#connectedPeers.add(peerId);
    else this.#connectedPeers.delete(peerId);
    this.#notifyStateChange();
  }

  /** Whether a transfer is moving right now, either direction. Completed files waiting for pickup do not count. */
  hasActiveTransfers(): boolean {
    return this.#incoming.size > 0 || this.#outgoing.size > 0;
  }

  readonly send = Effect.fn("TeamFileTransfer.send")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: { name: string; mimeType: string; bytes: Uint8Array },
  ): Effect.fn.Return<string, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const { bytes } = input;
        yield* remoteDecode(() => this.#checkOutgoing(peerId, bytes.byteLength));
        return yield* this.#sendOutgoingEffect(peerId, {
          name: input.name,
          mimeType: input.mimeType,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          read: async (offset, length) => bytes.subarray(offset, offset + length),
        });
      }),
    );
  }).bind(this);

  /**
   * Sends a stream, such as a Team API response body, without holding it in memory. `file-open`
   * needs the size and the SHA-256 before the first chunk, so the stream goes to a file in the
   * transfer directory first. The chunks, also the ones sent again after a resume, come from that
   * file. The file is removed when the transfer ends.
   */

  readonly sendStream = Effect.fn("TeamFileTransfer.sendStream")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: { name: string; mimeType: string; body: AsyncIterable<Uint8Array> | Iterable<Uint8Array> },
  ): Effect.fn.Return<{ transferId: string; size: number }, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        if (this.#stopped)
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.fileTransportIsStopped")),
          });
        yield* remoteCall(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
        const path = join(this.#directory, `${randomUUID()}.outgoing`);
        let file: FileHandle | null = null;
        // The bytes on disk count against the file set limit while they are written, so parallel
        // streams cannot write more than the limit before the check.
        const pending = { peerId, size: 0 };
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => this.#writing.add(pending)),
          () =>
            Effect.gen({ self: this }, function* () {
              const hash = createHash("sha256");
              const check = (size: number) => this.#checkOutgoing(peerId, size, pending);
              yield* remoteCall(() =>
                pipeline(
                  Readable.from(input.body),
                  async function* (chunks: AsyncIterable<Uint8Array>) {
                    for await (const chunk of chunks) {
                      pending.size += chunk.byteLength;
                      check(pending.size);
                      hash.update(chunk);
                      yield chunk;
                    }
                  },
                  createWriteStream(path, { flags: "wx", mode: 0o600 }),
                  { signal: this.#writingAbort.signal },
                ),
              );
              const size = pending.size;
              const source = yield* remoteCall(() => open(path, "r"));
              file = source;
              // No `await` between this check and `#sendOutgoing`, which adds the transfer: two parallel
              // streams cannot both pass the file set limit.
              this.#writing.delete(pending);
              yield* remoteDecode(() => this.#checkOutgoing(peerId, size));
              const transferId = yield* this.#sendOutgoingEffect(peerId, {
                name: input.name,
                mimeType: input.mimeType,
                size,
                sha256: hash.digest("hex"),
                read: async (offset, length) => {
                  const bytes = new Uint8Array(length);
                  const { bytesRead } = await source.read(bytes, 0, length, offset);
                  if (bytesRead !== length) throw new Error("The outgoing WebRTC file is incomplete.");
                  return bytes;
                },
              });
              return { transferId, size };
            }),
          () =>
            Effect.gen({ self: this }, function* () {
              this.#writing.delete(pending);
              yield* remoteCall(() => (file ? file.close() : Promise.resolve())).pipe(Effect.catch(() => Effect.void));
              yield* remoteCall(() => rm(path, { force: true }));
            }),
        );
      }),
    );
  }).bind(this);

  /** `own` is the stream that asks, so its bytes on disk are not counted twice. */
  #checkOutgoing(peerId: string, size: number, own?: { peerId: string; size: number }): void {
    if (this.#stopped) throw new Error(sourceText("error.remote.fileTransportIsStopped"));
    if (size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES) throw new Error(sourceText("error.remote.fileTooLarge"));
    const activeBytes = [...this.#outgoing.values(), ...[...this.#writing].filter((stream) => stream !== own)]
      .filter((transfer) => transfer.peerId === peerId)
      .reduce((sum, transfer) => sum + transfer.size, 0);
    if (activeBytes + size > TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES) {
      throw new Error(sourceText("error.remote.fileSetTooLarge"));
    }
  }

  readonly #sendOutgoingEffect = Effect.fn("TeamFileTransfer.sendOutgoing")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    input: Pick<OutgoingTransfer, "name" | "mimeType" | "size" | "sha256" | "read">,
  ): Effect.fn.Return<string, RemoteWorkflowError> {
    const transferId = randomUUID();
    const transfer: OutgoingTransfer = {
      peerId,
      transferId,
      name: basename(input.name) || "file",
      mimeType: input.mimeType || "application/octet-stream",
      size: input.size,
      read: input.read,
      sha256: input.sha256,
      acknowledged: 0,
      acknowledgementGeneration: 0,
      lastProgressAt: Date.now(),
      cancelled: null,
    };
    this.#outgoing.set(transferKey(peerId, transferId), transfer);
    recordRestartActivity();
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#sendWithResumeEffect(transfer);
      return transferId;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#outgoing.delete(transferKey(peerId, transferId));
        }),
      ),
    );
  });

  readonly receive = Effect.fn("TeamFileTransfer.receive")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
    timeoutMs = 60_000,
  ): Effect.fn.Return<ReceivedWebRtcFile, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        const key = transferKey(peerId, transferId);
        const completed = this.#completed.get(key);
        if (completed) return completed;
        if (this.#stopped)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) });
        if (this.#waiters.has(key))
          return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file is already being received.") });
        return yield* Effect.callback<ReceivedWebRtcFile, RemoteWorkflowError>((resume) => {
          const timer = setTimeout(() => {
            this.#waiters.delete(key);
            resume(
              Effect.fail(
                new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransferTimeout")) }),
              ),
            );
          }, timeoutMs);
          timer.unref?.();
          this.#waiters.set(key, {
            timer,
            resolve: (file) => resume(Effect.succeed(file)),
            reject: (cause) => resume(Effect.fail(new RemoteWorkflowError({ cause }))),
          });
          return Effect.sync(() => {
            clearTimeout(timer);
            this.#waiters.delete(key);
          });
        });
      }),
    );
  }).bind(this);

  readonly consume = Effect.fn("TeamFileTransfer.consume")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
  ): Effect.fn.Return<{ bytes: Uint8Array; name: string; mimeType: string }, RemoteWorkflowError> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        return yield* this.useReceived(peerId, transferId, (file) =>
          remoteCall(() => readFile(file.path)).pipe(
            Effect.map((bytes) => ({ bytes: new Uint8Array(bytes), name: file.name, mimeType: file.mimeType })),
          ),
        );
      }),
    );
  }).bind(this);

  /** Lends a received file to `use`, which can stream it from disk, and removes it after `use` ends. */

  readonly useReceived = Effect.fn("TeamFileTransfer.useReceived")(function* <T, E, R>(
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string,
    use: (file: ReceivedWebRtcFile) => Effect.Effect<T, E, R>,
  ): Effect.fn.Return<T, E | RemoteWorkflowError, R> {
    return yield* this.#owned(
      Effect.gen({ self: this }, function* () {
        return yield* Effect.acquireUseRelease(this.receive(peerId, transferId), use, (file) =>
          Effect.gen({ self: this }, function* () {
            const key = transferKey(peerId, transferId);
            this.#clearExpiration(key);
            this.#completed.delete(key);
            yield* remoteCall(() => rm(file.path, { force: true }));
          }),
        );
      }),
    );
  });

  #owned<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.ensuring(
          Effect.sync(() => this.#operations.delete(done)).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  }

  readonly stop = Effect.fn("TeamFileTransfer.stop")(function* (this: TeamWebRtcFileTransfer) {
    this.#stopped = true;
    this.#writingAbort.abort();
    for (const waiter of this.#waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(sourceText("error.remote.fileTransportStopped")));
    }
    this.#waiters.clear();
    this.#notifyStateChange();
    this.#bridge.off("data", this.#onData);
    this.#bridge.off("disconnected", this.#onDisconnected);
    for (const timer of this.#expirationTimers.values()) clearTimeout(timer);
    this.#expirationTimers.clear();
    while (this.#operations.size)
      yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
    yield* Effect.forEach(
      [...this.#incoming.values()],
      (transfer) => remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded" },
    );
    yield* Effect.forEach(
      [...this.#incoming.values(), ...this.#completed.values()],
      (transfer) => remoteCall(() => rm(transfer.path, { force: true })),
      { concurrency: "unbounded" },
    );
    for (const timer of this.#expirationTimers.values()) clearTimeout(timer);
    this.#incoming.clear();
    this.#outgoing.clear();
    this.#completed.clear();
    this.#expirationTimers.clear();
  }).bind(this);

  readonly #onDisconnected = (peerId: string): void => {
    this.setPeerAuthenticated(peerId, false);
  };

  readonly #onData = (
    peerId: string,
    channel: "rpc" | "events" | "files" | "desktop",
    data: string | ArrayBuffer,
  ): void => {
    if (channel !== "files" || !this.#connectedPeers.has(peerId) || !this.#acceptPeer(peerId)) return;
    const transferId = fileTransferId(data);
    void Effect.runPromise(
      this.#owned(
        this.#frames.withPermit(
          this.#handleData(peerId, data).pipe(
            Effect.catch((error) => this.#failFrame(peerId, transferId, error.cause)),
          ),
        ),
      ),
    ).catch(() => undefined);
  };

  readonly #handleData = Effect.fn("TeamFileTransfer.handleData")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    data: string | ArrayBuffer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (isString(data)) {
      const frame = yield* remoteDecode(() => decodeTeamProtocolV2FileControlFrame(data));
      const key = transferKey(peerId, frame.transferId);
      if (frame.type === "file-open") {
        const existing = this.#incoming.get(key);
        if (existing) {
          if (existing.size !== frame.size || existing.sha256 !== frame.sha256)
            return yield* new RemoteWorkflowError({ cause: new Error("The resumed WebRTC file metadata changed.") });
          yield* this.#bridge.send(
            peerId,
            "files",
            encodeTeamProtocolV2Frame({
              version: 2,
              type: "file-ack",
              transferId: frame.transferId,
              receivedThrough: existing.received,
            }),
          );
          return;
        }
        const activeBytes = [...this.#incoming.values(), ...this.#completed.values()]
          .filter((item) => item.peerId === peerId)
          .reduce((sum, item) => sum + item.size, 0);
        if (activeBytes + frame.size > TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileSetTooLarge")) });
        yield* remoteCall(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
        const path = join(this.#directory, `${frame.transferId}.part`);
        const file = yield* remoteCall(() => open(path, "w", 0o600));
        recordRestartActivity();
        this.#incoming.set(key, {
          peerId,
          transferId: frame.transferId,
          name: frame.name,
          mimeType: frame.mimeType,
          size: frame.size,
          sha256: frame.sha256,
          path,
          file,
          received: 0,
          lastAcknowledged: 0,
        });
        this.#scheduleExpiration(key);
        yield* this.#bridge.send(
          peerId,
          "files",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-ack",
            transferId: frame.transferId,
            receivedThrough: 0,
          }),
        );
      } else if (frame.type === "file-ack") {
        const outgoing = this.#outgoing.get(key);
        if (!outgoing || frame.receivedThrough < outgoing.acknowledged || frame.receivedThrough > outgoing.size) return;
        if (frame.receivedThrough > outgoing.acknowledged) outgoing.lastProgressAt = Date.now();
        outgoing.acknowledged = frame.receivedThrough;
        outgoing.acknowledgementGeneration += 1;
        this.#notifyStateChange();
      } else if (frame.type === "file-complete") {
        const transfer = this.#incoming.get(key);
        if (!transfer || transfer.received !== transfer.size)
          return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file is incomplete.") });
        yield* remoteCall(() => transfer.file.close());
        if (
          (yield* sha256File(transfer.path).pipe(
            Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })),
          )) !== transfer.sha256
        ) {
          const error = new Error("The WebRTC file hash is invalid.");
          yield* this.#bridge
            .send(
              peerId,
              "files",
              encodeTeamProtocolV2Frame({
                version: 2,
                type: "file-cancel",
                transferId: transfer.transferId,
                reason: error.message,
              }),
            )
            .pipe(Effect.catch(() => Effect.void));
          yield* this.#cancelEffect(key, error);
          return yield* new RemoteWorkflowError({ cause: error });
        }
        this.#incoming.delete(key);
        const completed = {
          peerId,
          transferId: transfer.transferId,
          name: transfer.name,
          mimeType: transfer.mimeType,
          size: transfer.size,
          path: transfer.path,
        };
        this.#completed.set(key, completed);
        this.#scheduleExpiration(key);
        const waiter = this.#waiters.get(key);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.#waiters.delete(key);
          waiter.resolve(completed);
        }
      } else if (frame.type === "file-cancel") {
        const outgoing = this.#outgoing.get(key);
        if (outgoing) {
          outgoing.cancelled = new Error(frame.reason);
          this.#notifyStateChange();
        }
        yield* this.#cancelEffect(key, new Error(frame.reason));
      }
      return;
    }
    const chunk = yield* remoteDecode(() => decodeTeamProtocolV2FileChunk(data));
    const key = transferKey(peerId, chunk.transferId);
    const transfer = this.#incoming.get(key);
    if (!transfer || chunk.offset !== transfer.received || transfer.received + chunk.bytes.byteLength > transfer.size) {
      return yield* new RemoteWorkflowError({ cause: new Error("The WebRTC file offset is invalid.") });
    }
    yield* remoteCall(() => transfer.file.write(chunk.bytes, 0, chunk.bytes.byteLength, chunk.offset));
    transfer.received += chunk.bytes.byteLength;
    this.#scheduleExpiration(key);
    if (transfer.received === transfer.size || transfer.received - transfer.lastAcknowledged >= ACK_INTERVAL_BYTES) {
      transfer.lastAcknowledged = transfer.received;
      yield* this.#bridge.send(
        peerId,
        "files",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "file-ack",
          transferId: transfer.transferId,
          receivedThrough: transfer.received,
        }),
      );
    }
  });

  readonly #cancelEffect = Effect.fn("TeamFileTransfer.cancel")(function* (
    this: TeamWebRtcFileTransfer,
    key: string,
    error: Error,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#clearExpiration(key);
    const transfer = this.#incoming.get(key);
    if (transfer) {
      this.#incoming.delete(key);
      yield* remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void));
      yield* remoteCall(() => rm(transfer.path, { force: true }));
    }
    const completed = this.#completed.get(key);
    if (completed) {
      this.#completed.delete(key);
      yield* remoteCall(() => rm(completed.path, { force: true }));
    }
    const waiter = this.#waiters.get(key);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#waiters.delete(key);
      waiter.reject(error);
    }
  });

  readonly #failFrame = Effect.fn("TeamFileTransfer.failFrame")(function* (
    this: TeamWebRtcFileTransfer,
    peerId: string,
    transferId: string | null,
    error: unknown,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!transferId) {
      this.setPeerAuthenticated(peerId, false);
      yield* this.#bridge.disconnectPeer(peerId).pipe(Effect.catch(() => Effect.void));
      return;
    }
    const failure = error instanceof Error ? error : new Error(sourceText("error.remote.fileTransferFailed"));
    yield* this.#bridge
      .send(
        peerId,
        "files",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "file-cancel",
          transferId,
          reason: failure.message.slice(0, 512),
        }),
      )
      .pipe(Effect.catch(() => Effect.void));
    yield* this.#cancelEffect(transferKey(peerId, transferId), failure);
  });

  readonly #sendWithResumeEffect = Effect.fn("TeamFileTransfer.sendWithResume")(function* (
    this: TeamWebRtcFileTransfer,
    transfer: OutgoingTransfer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    while (Date.now() < transfer.lastProgressAt + this.#resumeMilliseconds) {
      if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
      yield* this.#waitUntilEffect(
        () => this.#connectedPeers.has(transfer.peerId),
        transfer.lastProgressAt + this.#resumeMilliseconds,
      );
      const generation = transfer.acknowledgementGeneration;
      const attempt = yield* Effect.gen({ self: this }, function* () {
        yield* this.#bridge.send(
          transfer.peerId,
          "files",
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-open",
            transferId: transfer.transferId,
            name: transfer.name,
            size: transfer.size,
            mimeType: transfer.mimeType,
            sha256: transfer.sha256,
          }),
        );
        yield* this.#waitUntilEffect(
          () =>
            Boolean(transfer.cancelled) ||
            transfer.acknowledgementGeneration > generation ||
            !this.#connectedPeers.has(transfer.peerId),
          transfer.lastProgressAt + this.#resumeMilliseconds,
        );
        if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
        if (!this.#connectedPeers.has(transfer.peerId)) return false;
        for (let offset = transfer.acknowledged; offset < transfer.size; offset += FILE_CHUNK_BYTES) {
          const bytes = yield* remoteCall(() =>
            transfer.read(offset, Math.min(transfer.size, offset + FILE_CHUNK_BYTES) - offset),
          );
          const chunk = yield* remoteDecode(() =>
            encodeTeamProtocolV2FileChunk({ transferId: transfer.transferId, offset, bytes }),
          );
          const transferable = new Uint8Array(chunk.byteLength);
          transferable.set(chunk);
          yield* this.#bridge.send(transfer.peerId, "files", transferable.buffer);
        }
        yield* this.#bridge.send(
          transfer.peerId,
          "files",
          encodeTeamProtocolV2Frame({ version: 2, type: "file-complete", transferId: transfer.transferId }),
        );
        yield* this.#waitUntilEffect(
          () =>
            Boolean(transfer.cancelled) ||
            transfer.acknowledged === transfer.size ||
            !this.#connectedPeers.has(transfer.peerId),
          transfer.lastProgressAt + this.#resumeMilliseconds,
        );
        if (transfer.cancelled) return yield* new RemoteWorkflowError({ cause: transfer.cancelled });
        return this.#connectedPeers.has(transfer.peerId);
      }).pipe(Effect.result);
      if (Result.isSuccess(attempt)) {
        if (attempt.success) return;
        continue;
      }
      if (Date.now() >= transfer.lastProgressAt + this.#resumeMilliseconds) break;
      yield* this.#waitUntilEffect(
        () => !this.#connectedPeers.has(transfer.peerId),
        Math.min(transfer.lastProgressAt + this.#resumeMilliseconds, Date.now() + 2_000),
      ).pipe(Effect.catch(() => Effect.void));
    }
    return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileResumeFailed")) });
  });

  #waitUntilEffect(predicate: () => boolean, deadline: number): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.callback((resume) => {
      if (this.#stopped) {
        resume(
          Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) })),
        );
        return;
      }
      if (predicate()) {
        resume(Effect.void);
        return;
      }
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        this.#stateWaiters.delete(check);
      };
      const check = () => {
        if (this.#stopped) {
          cleanup();
          resume(
            Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransportStopped")) })),
          );
          return;
        }
        if (!predicate()) return;
        cleanup();
        resume(Effect.void);
      };
      timer = setTimeout(
        () => {
          cleanup();
          resume(
            Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.fileTransferTimeout")) })),
          );
        },
        Math.max(1, deadline - Date.now()),
      );
      this.#stateWaiters.add(check);
      check();
      return Effect.sync(cleanup);
    });
  }

  #notifyStateChange(): void {
    for (const waiter of [...this.#stateWaiters]) waiter();
  }

  #scheduleExpiration(key: string): void {
    this.#clearExpiration(key);
    const timer = setTimeout(() => {
      this.#expirationTimers.delete(key);
      void Effect.runPromise(this.#owned(this.#frames.withPermit(this.#expire(key)))).catch(() => undefined);
    }, this.#resumeMilliseconds);
    timer.unref?.();
    this.#expirationTimers.set(key, timer);
  }

  #clearExpiration(key: string): void {
    const timer = this.#expirationTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#expirationTimers.delete(key);
  }

  readonly #expire = Effect.fn("TeamFileTransfer.expire")(function* (
    this: TeamWebRtcFileTransfer,
    key: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const error = new Error(sourceText("error.remote.fileResumeExpired"));
    const transfer = this.#incoming.get(key);
    if (transfer) {
      this.#incoming.delete(key);
      yield* remoteCall(() => transfer.file.close()).pipe(Effect.catch(() => Effect.void));
      yield* remoteCall(() => rm(transfer.path, { force: true }));
    }
    const completed = this.#completed.get(key);
    if (completed) {
      this.#completed.delete(key);
      yield* remoteCall(() => rm(completed.path, { force: true }));
    }
    const waiter = this.#waiters.get(key);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#waiters.delete(key);
      waiter.reject(error);
    }
  });
}

function transferKey(peerId: string, transferId: string): string {
  return `${peerId}\0${transferId}`;
}

function fileTransferId(data: string | ArrayBuffer): string | null {
  try {
    return isString(data)
      ? decodeTeamProtocolV2FileControlFrame(data).transferId
      : decodeTeamProtocolV2FileChunk(data).transferId;
  } catch {
    return null;
  }
}
